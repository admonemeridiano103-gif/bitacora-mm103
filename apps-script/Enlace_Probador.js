/**
 * ENLACE CON "PROBADOR OCR MEDIDORES" (Fase 2, experimento de solo lectura)
 * Abre la hoja de datos del Probador y cuenta filas por tabla. NO escribe nada.
 * Ejecutar a mano desde el editor: experimentoEnlaceProbador(). El resultado queda en Registro de ejecución.
 */
var PROBADOR_SHEET_ID = '1eaqB0TXHblsG5iCqBTd7FBUGWtxG-srEB0B9VoUDu-o';
var PROBADOR_URL_POR_DEFECTO = 'https://script.google.com/macros/s/AKfycbwbIxbRDfycLXiKFqulvHrltowyImQQP7WrhNPjFKpT3B8CcZTgfcF8zAxfOyEB97bI/exec';
var PROBADOR_TABLAS = ['Usuarios', 'Medidores', 'Periodos', 'Lecturas', 'CierreImportes', 'CierreMontos', 'CierreEstado', 'CierreProrrogas', 'CierreSolicitudes', 'Bitacora'];

function experimentoEnlaceProbador() {
  var res = { cuenta: Session.getEffectiveUser().getEmail() || '(no visible)', ok: false, tablas: {}, muestra: {} };
  try {
    var ss = SpreadsheetApp.openById(PROBADOR_SHEET_ID);
    res.hoja = ss.getName();
    PROBADOR_TABLAS.forEach(function (n) {
      var sh = ss.getSheetByName(n);
      if (!sh) { res.tablas[n] = 'NO EXISTE'; return; }
      var filas = Math.max(0, sh.getLastRow() - 1);
      res.tablas[n] = filas;
      if (filas > 0 && (n === 'Lecturas' || n === 'CierreEstado' || n === 'CierreProrrogas')) {
        var cols = sh.getLastColumn();
        var enc = sh.getRange(1, 1, 1, cols).getValues()[0];
        var ult = sh.getRange(sh.getLastRow(), 1, 1, cols).getValues()[0];
        var o = {}; enc.forEach(function (c, i) { if (c !== 'Email' && c !== 'FotoId') o[c] = String(ult[i]).slice(0, 40); });
        res.muestra[n] = o;
      }
    });
    res.ok = true;
  } catch (e) {
    res.error = String(e && e.message ? e.message : e);
  }
  var txt = JSON.stringify(res, null, 2);
  Logger.log(txt);
  return txt;
}

/* ---------------------------------------------------------------------------------------------
 * Pantalla "Lecturas y gas (Probador)": enlace + resumen de solo lectura.
 * La direccion del Probador se guarda en Propiedades del script (PROBADOR_URL) con
 * configurarEnlaceProbador('https://...'), ejecutado una vez desde el editor.
 * --------------------------------------------------------------------------------------------- */
function configurarEnlaceProbador(url) {
  url = String(url || '').trim();
  if (!/^https:\/\//.test(url)) throw new Error('La direccion debe empezar con https://');
  PropertiesService.getScriptProperties().setProperty('PROBADOR_URL', url);
  CacheService.getScriptCache().remove('PROBADOR_RESUMEN');
  return 'Enlace guardado: ' + url;
}

function filasProbador_(ss, nombre) {
  var sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), enc = v[0];
  return v.slice(1).map(function (r) { var o = {}; enc.forEach(function (c, i) { o[c] = r[i]; }); return o; });
}

function contarPor_(filas, campo) {
  var m = {}; filas.forEach(function (f) { var k = String(f[campo] || '(vacio)'); m[k] = (m[k] || 0) + 1; }); return m;
}

/** Resumen sin datos personales (sin correos ni fotos). Cache de 5 minutos. */
function obtenerResumenProbador(token) {
  requierePermiso_(token, PERMISOS.CONTROL_CIERRE_GAS);
  return resumenProbador_();
}

/** Parte sin sesion, para probarla desde el editor. */
function resumenProbador_() {
  var url = PropertiesService.getScriptProperties().getProperty('PROBADOR_URL') || PROBADOR_URL_POR_DEFECTO;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('PROBADOR_RESUMEN');
  if (hit) { var o = JSON.parse(hit); o.url = url; return o; }
  var res = { url: url, ok: false };
  try {
    var ss = SpreadsheetApp.openById(PROBADOR_SHEET_ID);
    var periodos = filasProbador_(ss, 'Periodos');
    var lecturas = filasProbador_(ss, 'Lecturas');
    var estado = filasProbador_(ss, 'CierreEstado');
    var prorrogas = filasProbador_(ss, 'CierreProrrogas');
    var ultimo = periodos.length ? periodos[periodos.length - 1] : null;
    var delPeriodo = ultimo ? lecturas.filter(function (l) { return l.PeriodoId === ultimo.PeriodoId; }) : lecturas;
    res.periodo = ultimo ? { servicio: ultimo.Servicio, mes: String(ultimo.Mes), estado: ultimo.Estado } : null;
    res.lecturas = { total: delPeriodo.length, por_servicio: contarPor_(delPeriodo, 'Servicio'), por_estado: contarPor_(delPeriodo, 'Estado') };
    res.gas = { unidades: estado.length, por_estado: contarPor_(estado.filter(function (e) { return e.Servicio === 'gas'; }), 'Estado') };
    res.prorrogas = contarPor_(prorrogas, 'Estado');
    res.ok = true;
    cache.put('PROBADOR_RESUMEN', JSON.stringify(res), 300);
  } catch (e) {
    res.error = 'No se pudo leer el Probador: ' + String(e && e.message ? e.message : e);
  }
  return res;
}

/**
 * Gas pendiente según el Probador (solo lectura). Replica `evaluar_` de su Cierre.js solo para gas:
 * solicitud del propietario > adeudo >= umbral sin prórroga > abrir; pendiente si el estado físico no coincide.
 * t = { Medidores, CierreMontos, CierreEstado, CierreProrrogas, CierreSolicitudes, CierreImportes } (filas como objetos).
 * Sin montos ni propietarios: es lo que ve el técnico.
 */
function gasEvaluarProbador_(t, hoy) {
  var grupos = {};
  t.Medidores.forEach(function (m) {
    if (m.Servicio !== 'gas') return;
    var cod = m.Estado === 'comparte' && m.UsaMedidorDe ? String(m.UsaMedidorDe) : String(m.Codigo);
    var clave = m.Torre + '|' + cod;
    var g = grupos[clave] || (grupos[clave] = { torre: String(m.Torre), codigo: cod, nombre: '' });
    if (String(m.Codigo) === cod) g.nombre = String(m.Nombre || '');
  });
  var ult = t.CierreImportes.length ? t.CierreImportes[t.CierreImportes.length - 1] : null;
  var umbral = ult && Number(ult.Umbral) > 0 ? Number(ult.Umbral) : 200; // shortcut: el umbral real vive en el Probador; se toma del último importe
  var monto = {}, estadoDe = {};
  t.CierreMontos.forEach(function (m) { monto[m.Unidad] = Number(m.Monto) || 0; });
  t.CierreEstado.forEach(function (e) { if (e.Servicio === 'gas') estadoDe[e.Unidad] = e; });
  var lista = [];
  Object.keys(grupos).forEach(function (clave) {
    var g = grupos[clave], sol = null;
    t.CierreSolicitudes.forEach(function (s) {
      if (s.Estado !== 'activa' || s.Servicio !== 'gas' || s.Unidad !== clave || String(s.Fecha) > hoy) return;
      if (!sol || String(s.Fecha) + String(s.CreadaEn) > String(sol.Fecha) + String(sol.CreadaEn)) sol = s;
    });
    var prorroga = t.CierreProrrogas.some(function (p) { return p.Estado === 'vigente' && p.Unidad === clave && String(p.Hasta) >= hoy; });
    var cerrar = false;
    if (sol && sol.Accion === 'cerrar') cerrar = true;
    else if ((monto[clave] || 0) >= umbral && !prorroga) cerrar = true;
    var est = estadoDe[clave], fisico = est && est.Estado ? est.Estado : '';
    if (fisico === (cerrar ? 'CERRADO' : 'ABIERTO')) return;
    lista.push({ clave: clave, torre: g.torre, departamento: g.codigo + (g.nombre ? ' ' + g.nombre : ''), accion: cerrar ? 'Cerrar' : 'Abrir' });
  });
  return lista.sort(gasOrdenar_);
}

/** Lee el Probador y devuelve el gas pendiente de hoy. Caché de 60 s (salvo fresco=true). Lanza error si no se puede leer. */
function gasPendientesProbador_(hoy, fresco) {
  var cache = CacheService.getScriptCache(), hit = fresco ? null : cache.get('PROBADOR_GAS_PEND');
  if (hit) return JSON.parse(hit);
  var t = {};
  try {
    var ss = SpreadsheetApp.openById(PROBADOR_SHEET_ID);
    ['Medidores', 'CierreMontos', 'CierreEstado', 'CierreProrrogas', 'CierreSolicitudes', 'CierreImportes'].forEach(function (n) { t[n] = filasProbador_(ss, n); });
  } catch (e) {
    throw new Error('No se pudo leer la app de Lectura y cierre de servicios: ' + String(e && e.message ? e.message : e));
  }
  var lista = gasEvaluarProbador_(t, hoy);
  cache.put('PROBADOR_GAS_PEND', JSON.stringify(lista), 60);
  return lista;
}

/** Agrega una fila al final de una hoja del Probador (texto plano, igual que su agregarFilas_). */
function anexarFilaProbador_(sh, fila) {
  var inicio = sh.getLastRow() + 1, max = sh.getMaxRows();
  if (max < inicio) {
    sh.insertRowsAfter(max, inicio - max);
    sh.getRange(max + 1, 1, inicio - max, fila.length).setNumberFormat('@');
  }
  sh.getRange(inicio, 1, 1, fila.length).setValues([fila]);
}

/**
 * Registra en el Probador que una unidad de gas quedó CERRADA o ABIERTA (equivale a su cierreMarcar): actualiza
 * CierreEstado y deja la huella en su hoja Bitacora, a nombre del técnico de la Bitácora. El Probador solo acepta
 * llamadas con token de Google de cada persona, así que aquí se escribe directo en su hoja.
 */
function marcarGasProbador_(clave, estado, usuario, nota, detalle) {
  if (estado !== 'CERRADO' && estado !== 'ABIERTO') throw new Error('El estado debe ser CERRADO o ABIERTO.');
  var ss = SpreadsheetApp.openById(PROBADOR_SHEET_ID);
  var shE = ss.getSheetByName('CierreEstado'), shB = ss.getSheetByName('Bitacora');
  if (!shE || !shB) throw new Error('No se encontró CierreEstado o Bitacora en la hoja del Probador.');
  var ts = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd HH:mm:ss');
  var correo = String(usuario.correo || '').trim().toLowerCase(), nombre = String(usuario.nombre_completo || correo);
  nota = String(nota || '').substring(0, 300);
  var vals = shE.getDataRange().getValues(), fila = 0;
  for (var i = 1; i < vals.length; i++) { if (vals[i][0] === 'gas' && String(vals[i][1]) === clave) { fila = i + 1; break; } }
  if (fila) shE.getRange(fila, 3, 1, 5).setValues([[estado, ts, correo, nombre, nota]]); // conserva el Comentario (columna 8)
  else anexarFilaProbador_(shE, ['gas', clave, estado, ts, correo, nombre, nota, '']);
  anexarFilaProbador_(shB, [Utilities.getUuid().substring(0, 8), ts, correo, nombre, String(usuario.rol || ''), 'cierre_marcar', '', 'gas|' + clave,
    JSON.stringify(detalle || {})]);
  CacheService.getScriptCache().remove('PROBADOR_GAS_PEND');
  CacheService.getScriptCache().remove('PROBADOR_RESUMEN');
}

function probarResumenProbador() { var r = resumenProbador_(); Logger.log(JSON.stringify(r, null, 1)); return r.ok; }

/** Compara correos de la Bitacora contra la hoja Usuarios del Probador (solo lectura). */
function compararUsuariosProbador() {
  var buscar = ['meridiano054@gmail.com', 'tecnicomantenimiento573@gmail.com', 'conciergem103@gmail.com'];
  var filas = filasProbador_(SpreadsheetApp.openById(PROBADOR_SHEET_ID), 'Usuarios');
  var por = {}; filas.forEach(function (f) { por[String(f.Email).trim().toLowerCase()] = f; });
  var out = buscar.map(function (c) { var f = por[c]; return c + ' -> ' + (f ? 'SI esta (rol ' + f.Rol + ', activo ' + f.Activo + ')' : 'FALTA en el Probador'); });
  var otros = filas.filter(function (f) { return buscar.indexOf(String(f.Email).trim().toLowerCase()) < 0; })
    .map(function (f) { return String(f.Nombre) + ' (' + f.Rol + ', activo ' + f.Activo + ') ' + String(f.Email).replace(/^(.{3}).*(@.*)$/, '$1***$2'); });
  Logger.log(out.join('\n') + '\nOtros en el Probador:\n' + otros.join('\n'));
  return out;
}
