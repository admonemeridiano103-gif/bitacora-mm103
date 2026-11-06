/**
 * ============================================================================
 * COMPARATIVA DE TIEMPOS POR TÉCNICO — Bitácora MM103 (Fase 6, nov 2026)
 * ----------------------------------------------------------------------------
 * Solo LEE datos. Toma los renglones Completada de COLA_TRABAJO_DIARIO con minutos
 * (la cola nunca se borra, así que incluye lo archivado en el historial y lo de hoy)
 * y agrupa por trabajo: misma tarea del catálogo (tarea_id), o mismo texto para
 * trabajos programados y tickets, o "Gas". Por técnico calcula promedio de minutos,
 * veces realizado y diferencia contra el promedio general del trabajo (min y %).
 * Solo se compara a un técnico con al menos N registros en ese trabajo; N vive en
 * CONFIG_SISTEMA (COMPARATIVA_MIN_REGISTROS, por defecto 2) y se cambia sin código.
 * Un trabajo aparece en la tabla cuando tiene al menos 2 técnicos comparables.
 * ============================================================================
 */

var CLAVE_CONFIG_COMPARATIVA = 'COMPARATIVA_MIN_REGISTROS';
var UMBRAL_COMPARATIVA_DEFECTO = 2;

/** Registros mínimos por técnico (CONFIG_SISTEMA). Si falta el parámetro, lo crea una sola vez con el valor por defecto. */
function umbralComparativa_() {
  var v = Number(obtenerConfig_(CLAVE_CONFIG_COMPARATIVA, ''));
  if (!(v >= 1)) { asegurarParametroComparativa_(); v = UMBRAL_COMPARATIVA_DEFECTO; }
  return Math.floor(v);
}

function asegurarParametroComparativa_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('CONFIG_COMPARATIVA_OK') === 'true') return;
  try {
    if (!buscarFilaPorValor_(HOJAS.CONFIG, 'clave', CLAVE_CONFIG_COMPARATIVA, false)) {
      var sh = hoja_(HOJAS.CONFIG);
      sh.appendRow(objetoAFila_(encabezados_(sh), {
        clave: CLAVE_CONFIG_COMPARATIVA,
        valor: UMBRAL_COMPARATIVA_DEFECTO,
        descripcion: 'Comparativa de tiempos: registros mínimos de un técnico en un mismo trabajo para compararlo'
      }));
    }
    props.setProperty('CONFIG_COMPARATIVA_OK', 'true');
  } catch (e) { console.warn('Parámetro de comparativa: ' + e); }
}

function normalizarTextoComparativa_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

/** Clave y nombre del "mismo trabajo" para un renglón de cola. */
function trabajoComparativa_(o, mapas) {
  var tipo = o.tipo_origen || 'Catalogo';
  if (tipo === 'Gas') return { clave: 'G', nombre: 'Cierre/Apertura de gas', tipo: 'Gas' };
  if (tipo === 'Extra') {
    var d = ((mapas.extras || {})[o.origen_id] || {}).descripcion || '';
    return d ? { clave: 'E:' + normalizarTextoComparativa_(d), nombre: d, tipo: 'Trabajo programado' } : null;
  }
  if (tipo === 'Ticket') {
    var m = ((mapas.tickets || {})[o.origen_id] || {}).mensaje || '';
    return m ? { clave: 'K:' + normalizarTextoComparativa_(m), nombre: m, tipo: 'Ticket' } : null;
  }
  if (!o.tarea_id) return null;
  return { clave: 'T:' + o.tarea_id, nombre: ((mapas.catalogo || {})[o.tarea_id] || {}).nombre_tarea || o.tarea_id, tipo: 'Tarea' };
}

function redondear1_(n) { return Math.round(n * 10) / 10; }

/**
 * opciones: { desde, hasta } ('yyyy-MM-dd', vacío = sin límite).
 * Devuelve { umbral, desde, hasta, trabajos:[{clave,nombre,tipo,veces,promedio,tecnicos:[...]}], porRegistro:{registro_id:{...}} }
 */
function calcularComparativaTiempos_(opciones) {
  opciones = opciones || {};
  var desde = opciones.desde || '', hasta = opciones.hasta || '';
  var umbral = umbralComparativa_();
  var mapas = mapasOrdenCola_();
  var nombres = {};
  leerTablaSiExiste_(HOJAS.USUARIOS).filas.forEach(function (f) { nombres[f.obj.id_usuario] = f.obj.nombre_completo || f.obj.correo || f.obj.id_usuario; });

  var grupos = {};
  leerTablaSiExiste_(HOJAS.COLA).filas.forEach(function (f) {
    var o = f.obj;
    if (o.estado !== 'Completada' || !o.usuario_asignado_actual) return;
    var minutos = Number(o.tiempo_total_minutos);
    if (!(minutos > 0)) return;
    var dia = fechaClaveReporte_(o.fecha);
    if (!dia || (desde && dia < desde) || (hasta && dia > hasta)) return;
    var t = trabajoComparativa_(o, mapas);
    if (!t) return;
    var g = grupos[t.clave] || (grupos[t.clave] = { clave: t.clave, nombre: t.nombre, tipo: t.tipo, registros: [] });
    g.registros.push({ registro_id: o.registro_id, tecnico_id: o.usuario_asignado_actual, minutos: minutos });
  });

  var trabajos = [], porRegistro = {};
  Object.keys(grupos).forEach(function (k) {
    var g = grupos[k];
    var suma = 0, porTec = {};
    g.registros.forEach(function (r) {
      suma += r.minutos;
      var pt = porTec[r.tecnico_id] || (porTec[r.tecnico_id] = { tecnico_id: r.tecnico_id, tecnico: nombres[r.tecnico_id] || r.tecnico_id, veces: 0, suma: 0 });
      pt.veces++; pt.suma += r.minutos;
    });
    var promedio = suma / g.registros.length;
    var tecnicos = Object.keys(porTec).map(function (id) {
      var p = porTec[id], prom = p.suma / p.veces, dif = prom - promedio;
      return {
        tecnico_id: id, tecnico: p.tecnico, veces: p.veces, promedio: redondear1_(prom),
        dif_min: redondear1_(dif), dif_pct: promedio ? Math.round(dif * 100 / promedio) : 0, comparable: p.veces >= umbral
      };
    }).sort(function (a, b) { return a.promedio - b.promedio; });
    var comparables = tecnicos.filter(function (x) { return x.comparable; });
    g.registros.forEach(function (r) {
      var pt = porTec[r.tecnico_id], dif = r.minutos - promedio;
      porRegistro[r.registro_id] = {
        trabajo: g.nombre, minutos: redondear1_(r.minutos), promedio_general: redondear1_(promedio), veces_general: g.registros.length,
        promedio_tecnico: redondear1_(pt.suma / pt.veces), veces_tecnico: pt.veces,
        dif_min: redondear1_(dif), dif_pct: promedio ? Math.round(dif * 100 / promedio) : 0,
        comparable: pt.veces >= umbral && g.registros.length > pt.veces
      };
    });
    if (comparables.length >= 2) {
      trabajos.push({ clave: g.clave, nombre: g.nombre, tipo: g.tipo, veces: g.registros.length, promedio: redondear1_(promedio), tecnicos: comparables, otros: tecnicos.length - comparables.length });
    }
  });
  trabajos.sort(function (a, b) { return (b.veces - a.veces) || String(a.nombre).localeCompare(String(b.nombre)); });
  return { umbral: umbral, desde: desde, hasta: hasta, trabajos: trabajos, porRegistro: porRegistro };
}

/** Agrega a cada movimiento COMPLETAR_TAREA_COLA de la auditoría su "Tiempo vs. promedio" (columna nueva de Auditoría). */
function agregarComparativaAuditoria_(filas) {
  if (!filas.some(function (f) { return f.accion === 'COMPLETAR_TAREA_COLA'; })) return filas;
  var c = calcularComparativaTiempos_({});
  filas.forEach(function (f) {
    if (f.accion !== 'COMPLETAR_TAREA_COLA') return;
    var x = c.porRegistro[f.id_entidad_afectada];
    if (x) { x.umbral = c.umbral; f.comparativa = x; }
  });
  return filas;
}