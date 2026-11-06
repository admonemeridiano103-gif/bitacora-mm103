/**
 * ============================================================================
 * LECTURAS DE MEDIDORES DE AGUA Y GAS — Bitácora MM103 (nov 2026)
 * ----------------------------------------------------------------------------
 * La tableta escanea el QR del medidor, toma la foto, lee el número sin
 * internet y lo guarda en su bandeja. Cuando hay señal se sube aquí:
 *   - MEDIDORES            padrón (449 medidores) con la última lectura vigente
 *   - LECTURAS_MEDIDORES   una fila por lectura, con foto en Drive y datos del OCR
 * Cualquier usuario con sesión activa puede registrar lecturas.
 * ============================================================================
 */

var HOJA_MEDIDORES = 'MEDIDORES';
var HOJA_LECTURAS_MED = 'LECTURAS_MEDIDORES';
var CARPETA_FOTOS_MEDIDORES = 'MM103 Lecturas de medidores';
var COLS_MEDIDORES = ['torre', 'unidad', 'sistema', 'tipo', 'ultima_lectura', 'fecha_ultima', 'promedio_mensual', 'maximo_mensual', 'enteros', 'decimales', 'activo'];
var COLS_LECTURAS_MED = ['lectura_id', 'periodo', 'fecha_hora', 'torre', 'unidad', 'tipo', 'lectura', 'lectura_anterior', 'consumo', 'alerta',
  'ocr_valor', 'ocr_confianza', 'ocr_metodo', 'corregida_a_mano', 'nota', 'foto_url', 'recorte_url', 'registrado_por', 'id_usuario', 'op_id'];

/** Ejecutar UNA vez desde el editor: crea las dos hojas con encabezados (no borra nada si ya existen). */
function crearHojasLecturasMedidores() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  [[HOJA_MEDIDORES, COLS_MEDIDORES], [HOJA_LECTURAS_MED, COLS_LECTURAS_MED]].forEach(function (par) {
    var h = ss.getSheetByName(par[0]);
    if (!h) { h = ss.insertSheet(par[0]); h.getRange(1, 1, 1, par[1].length).setValues([par[1]]).setFontWeight('bold'); h.setFrozenRows(1); }
  });
  return 'Listo: ' + HOJA_MEDIDORES + ' y ' + HOJA_LECTURAS_MED;
}

function leerTablaSimple_(nombre) {
  var h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!h) throw new Error('Falta la hoja ' + nombre + '. Ejecuta crearHojasLecturasMedidores().');
  var v = h.getDataRange().getValues(), enc = v.shift();
  return { hoja: h, enc: enc, filas: v.map(function (f) { var o = {}; enc.forEach(function (k, i) { o[k] = f[i]; }); return o; }) };
}

/** Padrón para la tableta (se guarda en caché local y funciona sin internet). */
function obtenerPadronMedidores(token) {
  requiereSesion_(token);
  var cache = CacheService.getScriptCache(), c = cache.get('PADRON_MED');
  if (c) return JSON.parse(c);
  var t = leerTablaSimple_(HOJA_MEDIDORES), tz = Session.getScriptTimeZone();
  var lista = t.filas.filter(function (o) { return o.unidad && String(o.activo).toUpperCase() !== 'FALSE'; }).map(function (o) {
    return {
      torre: o.torre, unidad: String(o.unidad), sistema: o.sistema, tipo: o.tipo,
      ultima: o.ultima_lectura === '' ? null : Number(o.ultima_lectura),
      fecha: o.fecha_ultima instanceof Date ? Utilities.formatDate(o.fecha_ultima, tz, 'dd/MM/yyyy') : String(o.fecha_ultima || ''),
      prom: Number(o.promedio_mensual) || 0, max: Number(o.maximo_mensual) || 0,
      enteros: Number(o.enteros) || 5, decimales: o.decimales === '' ? (o.tipo === 'GAS' ? 2 : 0) : Number(o.decimales)
    };
  });
  var r = { ok: true, medidores: lista, generado: new Date().toISOString() };
  try { cache.put('PADRON_MED', JSON.stringify(r), 300); } catch (e) {}
  return r;
}

/** Guarda una lectura. d = {unidad, tipo, lectura, anterior, alerta, nota, ocr:{valor,confianza,metodo}, foto:{base64,mime}, recorte:{base64,mime}} */
function registrarLecturaMedidor(token, d) {
  var usuario = requiereSesion_(token);
  d = d || {};
  var lectura = Number(d.lectura);
  if (!d.unidad || !d.tipo) throw new Error('Falta el medidor (unidad y tipo).');
  if (isNaN(lectura) || lectura < 0) throw new Error('La lectura no es un número válido.');
  var candado = LockService.getScriptLock(); candado.waitLock(20000);
  try {
    var med = leerTablaSimple_(HOJA_MEDIDORES), idx = -1;
    for (var i = 0; i < med.filas.length; i++) if (String(med.filas[i].unidad) === String(d.unidad) && med.filas[i].tipo === d.tipo) { idx = i; break; }
    if (idx < 0) throw new Error('El medidor ' + d.unidad + ' (' + d.tipo + ') no está en el padrón.');
    var m = med.filas[idx], anterior = m.ultima_lectura === '' ? null : Number(m.ultima_lectura);
    // la tableta manda la lectura anterior que vio (si se repite la toma en el mismo mes, no se compara contra sí misma)
    if (d.anterior != null && d.anterior !== '' && !isNaN(Number(d.anterior))) anterior = Number(d.anterior);
    var ahora = new Date(), tz = Session.getScriptTimeZone(), periodo = Utilities.formatDate(ahora, tz, 'yyyy-MM');
    var id = 'LM-' + Utilities.formatDate(ahora, tz, 'yyyyMMdd-HHmmss') + '-' + String(d.unidad).replace(/\s/g, '') + '-' + d.tipo;
    var carpeta = carpetaFotosMedidores_(periodo);
    function subir(f, sufijo) {
      if (!f || !f.base64) return '';
      var b64 = String(f.base64).replace(/^data:[^,]+,/, '');
      var archivo = carpeta.createFile(Utilities.newBlob(Utilities.base64Decode(b64), f.mime || 'image/jpeg', id + sufijo + '.jpg'));
      return archivo.getUrl();
    }
    var fotoUrl = subir(d.foto, ''), recorteUrl = subir(d.recorte, '-numeros');
    var consumo = anterior == null ? '' : Math.round((lectura - anterior) * 1000) / 1000;
    var ocr = d.ocr || {};
    var fila = {
      lectura_id: id, periodo: periodo, fecha_hora: ahora, torre: m.torre, unidad: m.unidad, tipo: m.tipo, lectura: lectura,
      lectura_anterior: anterior == null ? '' : anterior, consumo: consumo, alerta: d.alerta || '',
      ocr_valor: ocr.valor == null ? '' : ocr.valor, ocr_confianza: ocr.confianza == null ? '' : ocr.confianza, ocr_metodo: ocr.metodo || '',
      corregida_a_mano: ocr.valor != null && Number(ocr.valor) !== lectura ? 'SÍ' : '', nota: d.nota || '',
      foto_url: fotoUrl, recorte_url: recorteUrl, registrado_por: usuario.nombre_completo || usuario.id_usuario, id_usuario: usuario.id_usuario,
      op_id: d.opId || ''
    };
    var lec = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_LECTURAS_MED);
    var enc = lec.getRange(1, 1, 1, lec.getLastColumn()).getValues()[0];
    lec.appendRow(enc.map(function (k) { return fila.hasOwnProperty(k) ? fila[k] : ''; }));
    // actualiza la última lectura vigente del padrón
    var cU = med.enc.indexOf('ultima_lectura') + 1, cF = med.enc.indexOf('fecha_ultima') + 1;
    med.hoja.getRange(idx + 2, cU).setValue(lectura);
    med.hoja.getRange(idx + 2, cF).setValue(ahora);
    CacheService.getScriptCache().remove('PADRON_MED');
    try {
      registrarAuditoria_(usuario.id_usuario, usuario.correo, 'LECTURA_MEDIDOR', HOJA_LECTURAS_MED, id,
        anterior == null ? '' : String(anterior), lectura + (d.alerta ? ' — ' + d.alerta : ''));
    } catch (e) { console.warn('Auditoría lectura: ' + e); }
    return { ok: true, lectura_id: id, consumo: consumo, foto_url: fotoUrl };
  } finally {
    candado.releaseLock();
  }
}

/** Lecturas tomadas en el periodo (para ver avance desde otra tableta). */
function listarLecturasMedidoresPeriodo(token, periodo) {
  requiereSesion_(token);
  var tz = Session.getScriptTimeZone();
  periodo = periodo || Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  var t = leerTablaSimple_(HOJA_LECTURAS_MED);
  return { ok: true, periodo: periodo, lecturas: t.filas.filter(function (o) { return o.periodo === periodo; }).map(function (o) {
    return { unidad: String(o.unidad), tipo: o.tipo, lectura: o.lectura, consumo: o.consumo, alerta: o.alerta, por: o.registrado_por,
      fecha: o.fecha_hora instanceof Date ? Utilities.formatDate(o.fecha_hora, tz, 'dd/MM HH:mm') : String(o.fecha_hora) };
  }) };
}

function carpetaFotosMedidores_(periodo) {
  var raiz, it = DriveApp.getFoldersByName(CARPETA_FOTOS_MEDIDORES);
  raiz = it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA_FOTOS_MEDIDORES);
  var sub = raiz.getFoldersByName(periodo);
  return sub.hasNext() ? sub.next() : raiz.createFolder(periodo);
}
