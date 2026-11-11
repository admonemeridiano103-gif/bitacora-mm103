// =============================================================================
// Control de Cierre/Apertura de Gas + trabajos programados vinculados a módulos
//
// - REPORTE_MOROSIDAD: un renglón por departamento (el residente "TORRE B #B0804" y el
//   propietario "Propietarios B #PROB0804" se unen en una sola clave "B-804").
// - CONFIG_GAS: una sola fila con el monto mínimo (default 200).
// - Permiso CONTROL_CIERRE_GAS: interruptor del módulo (si ningún rol lo tiene, el módulo está
//   apagado) y acceso a la pantalla de administración.
// - La tarea "Cierre/Apertura de gas" entra a la cola con tipo_origen 'Gas', igual que los
//   trabajos programados entran con tipo_origen 'Extra'.
// =============================================================================

var HOJA_GAS_REPORTE = 'REPORTE_MOROSIDAD';
var HOJA_GAS_CONFIG = 'CONFIG_GAS';
var GAS_MONTO_MINIMO_DEFAULT = 200;
var GAS_ENCABEZADOS = ['clave', 'torre', 'departamento', 'fecha_carga', 'direccion', 'alias', 'monto_adeudado',
  'monto_moratorios', 'monto_total', 'aplica_cierre', 'prorrogado', 'motivo_prorroga', 'autorizo_prorroga',
  'fecha_limite_prorroga', 'estado_gas', 'foto_evidencia_url', 'ejecutado_por', 'fecha_ejecucion', 'quien_debe'];

function asegurarHojasGas_() {
  var libro = ss_();
  var sh = libro.getSheetByName(HOJA_GAS_REPORTE);
  if (!sh) {
    sh = libro.insertSheet(HOJA_GAS_REPORTE);
    sh.getRange(1, 1, 1, GAS_ENCABEZADOS.length).setValues([GAS_ENCABEZADOS]);
    sh.setFrozenRows(1);
  }
  asegurarColumna_(HOJA_GAS_REPORTE, 'quien_debe');
  var cfg = libro.getSheetByName(HOJA_GAS_CONFIG);
  if (!cfg) {
    cfg = libro.insertSheet(HOJA_GAS_CONFIG);
    cfg.getRange(1, 1, 1, 2).setValues([['monto_minimo_cierre', 'actualizado_por']]);
    cfg.getRange(2, 1, 1, 2).setValues([[GAS_MONTO_MINIMO_DEFAULT, '']]);
    cfg.setFrozenRows(1);
  }
}

/** El módulo está encendido cuando al menos un rol tiene CONTROL_CIERRE_GAS en ROLES_PERMISOS. */
function moduloGasActivo_() {
  // FASE 2 (2026-11-07): el control de gas y las lecturas viven en el Probador OCR ("Lectura y cierre de servicios").
  // La tarea del técnico se arma con los datos del Probador (solo lectura; ver Enlace_Probador.js). La pantalla
  // de administración local queda oculta y sus datos se conservan. El módulo local ya no se enciende por permisos.
  return true;
  /* eslint-disable no-unreachable */
  var tabla = leerTabla_(HOJAS.ROLES);
  var activo = false;
  tabla.filas.forEach(function (f) {
    if (f.obj.clave_permiso !== PERMISOS.CONTROL_CIERRE_GAS) return;
    tabla.encabezados.slice(2).forEach(function (rol) {
      if (f.obj[rol] === true || f.obj[rol] === 'TRUE') activo = true;
    });
  });
  return activo;
}

function estadoModuloGas(token) {
  requiereSesion_(token);
  return { activo: moduloGasActivo_() };
}

function gasMontoMinimo_() {
  asegurarHojasGas_();
  var t = leerTabla_(HOJA_GAS_CONFIG);
  var v = t.filas.length ? Number(t.filas[0].obj.monto_minimo_cierre) : NaN;
  return isNaN(v) ? GAS_MONTO_MINIMO_DEFAULT : v;
}

function gasNormalizar_(s) {
  return String(s || '').toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]/g, '');
}

function gasNumero_(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  var s = String(v === null || v === undefined ? '' : v).replace(/[^0-9.,\-]/g, '');
  if (!s) return 0;
  if (s.indexOf(',') !== -1 && s.indexOf('.') !== -1) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.indexOf(',') !== -1) s = /,\d{3}(\D|$)/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/** "TORRE B #B0804" y "Propietarios B #PROB0804" -> { clave: 'B-804', torre: 'B', departamento: '804' }. */
function gasNombreLocal_(s) {
  return String(s || '').trim().toUpperCase()
    .replace(/[\u00c1\u00c0\u00c4]/g, 'A').replace(/[\u00c9\u00c8\u00cb]/g, 'E').replace(/[\u00cd\u00cc\u00cf]/g, 'I')
    .replace(/[\u00d3\u00d2\u00d6]/g, 'O').replace(/[\u00da\u00d9\u00dc]/g, 'U')
    .replace(/\s+/g, ' ');
}

/** Extrae torre+depto (A/B/C) o el local comercial (Torre D) de la columna Direccion del Excel de YAU.
 * Devuelve null para cajones de estacionamiento (CAJON, VEQ): no entran al control de gas.
 * Ej: 'TORRE B #B0804' o 'Propietarios B #PROB0804' -> { clave:'B-804', torre:'B', departamento:'804' }.
 * Ej: 'TACOS JOU' (Torre D) -> { clave:'D-TACOS JOU', torre:'D', departamento:'TACOS JOU' }. */
function gasClaveDeDireccion_(dir) {
  var s = String(dir || '').trim();
  if (!s) return null;
  if (/\bCAJ[O\u00d3]N\b/i.test(s) || /\bVEQ\b/i.test(s)) return null;
  var m = /#\s*(?:PRO)?([A-Za-z])\s*0*(\d+)\s*$/i.exec(s);
  var torre = '', num = '';
  if (m) { torre = m[1]; num = m[2]; }
  else {
    var mt = /(?:TORRE|PROPIETARIOS\s)\s+([A-Za-z])\b/i.exec(s);
    var mn = /0*(\d+)\s*$/.exec(s);
    if (mt && mn) { torre = mt[1]; num = mn[1]; }
  }
  if (torre && num) {
    torre = torre.toUpperCase();
    return { clave: torre + '-' + num, torre: torre, departamento: num };
  }
  var nombre = gasNombreLocal_(s.replace(/^\s*TORRE\s+D\s*#?\s*/i, ''));
  if (!nombre) return null;
  return { clave: 'D-' + nombre, torre: 'D', departamento: nombre };
}

function gasProrrogaVigente_(o, hoy) {
  if (!(o.prorrogado === true || o.prorrogado === 'TRUE')) return false;
  var lim = soloFecha_(o.fecha_limite_prorroga);
  return !lim || String(lim) >= hoy;
}

/** 'Cerrar' | 'Abrir' | 'Sin cambio' para un renglón de REPORTE_MOROSIDAD. */
function gasAccion_(o, hoy) {
  var cerrado = String(o.estado_gas) === 'Cerrado';
  var aplica = o.aplica_cierre === true || o.aplica_cierre === 'TRUE';
  var prorroga = gasProrrogaVigente_(o, hoy);
  if (aplica && !prorroga && !cerrado) return 'Cerrar';
  if ((!aplica || prorroga) && cerrado) return 'Abrir';
  return 'Sin cambio';
}

function gasOrdenar_(a, b) {
  if (a.torre !== b.torre) return String(a.torre).localeCompare(String(b.torre));
  var na = parseInt(a.departamento, 10), nb = parseInt(b.departamento, 10);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a.departamento).localeCompare(String(b.departamento));
}

/** Departamentos con acción pendiente (Cerrar/Abrir), en el orden en que el técnico debe recorrerlos. */
function gasPendientes_(hoy) {
  // Si el Probador no se puede leer, no se rompe la cola: sin datos no se agrega la tarea.
  try { return gasPendientesProbador_(hoy); } catch (e) { console.warn(e); return []; }
}

function gasVista_() {
  asegurarHojasGas_();
  var hoy = fechaHoy_();
  var fechaCarga = '';
  var filas = leerTabla_(HOJA_GAS_REPORTE).filas.map(function (f) {
    var o = f.obj;
    if (o.fecha_carga) fechaCarga = soloFecha_(o.fecha_carga);
    var prorroga = null;
    if (o.prorrogado === true || o.prorrogado === 'TRUE') {
      prorroga = { vigente: gasProrrogaVigente_(o, hoy), motivo: o.motivo_prorroga || '', autorizo: o.autorizo_prorroga || '', fecha_limite: soloFecha_(o.fecha_limite_prorroga) || '' };
    }
    return {
      clave: o.clave, torre: o.torre, departamento: String(o.departamento), direccion: o.direccion || '', alias: o.alias || '', quien_debe: o.quien_debe || '',
      monto_adeudado: Number(o.monto_adeudado) || 0, monto_moratorios: Number(o.monto_moratorios) || 0, monto_total: Number(o.monto_total) || 0,
      aplica_cierre: o.aplica_cierre === true || o.aplica_cierre === 'TRUE', estado_gas: o.estado_gas || 'Abierto',
      accion: gasAccion_(o, hoy), prorroga: prorroga, ejecutado_por: o.ejecutado_por || '', fecha_ejecucion: o.fecha_ejecucion ? soloFecha_(o.fecha_ejecucion) : ''
    };
  }).sort(gasOrdenar_);
  return {
    activo: moduloGasActivo_(), minimo: gasMontoMinimo_(), fecha_carga: fechaCarga, filas: filas,
    pendientes: filas.filter(function (x) { return x.accion !== 'Sin cambio'; }).length
  };
}

function listarReporteGas(token) {
  requierePermiso_(token, PERMISOS.CONTROL_CIERRE_GAS);
  return gasVista_();
}

/**
 * filas: [{ 'Dirección', 'Propietario (Alias)', 'Monto adeudado', 'Monto moratorios', 'Monto total' }, ...]
 * Reemplaza el reporte del mes en curso. Conserva el estado del gas y las prórrogas de los departamentos
 * que ya estaban, y deja en "Abrir" a los que estaban cerrados y ya no aparecen como morosos.
 */
function cargarReporteMorosidad(token, filas) {
  var usuario = requierePermiso_(token, PERMISOS.CONTROL_CIERRE_GAS);
  if (!Array.isArray(filas) || !filas.length) throw new Error('El archivo no trae filas. Revisa que sea el reporte de morosidad de YAU.');
  if (filas.length > 2000) throw new Error('El reporte trae demasiadas filas (máximo 2000).');
  asegurarHojasGas_();
  var minimo = gasMontoMinimo_();
  var hoy = fechaHoy_();
  var combinados = {}, ignoradas = [], leidas = 0;
  filas.forEach(function (fila) {
    var mapa = {};
    Object.keys(fila || {}).forEach(function (k) { mapa[gasNormalizar_(k)] = fila[k]; });
    var direccion = String(mapa.direccion || '').trim();
    if (!direccion) return;
    var info = gasClaveDeDireccion_(direccion);
    if (!info) { ignoradas.push(direccion); return; }
    leidas++;
    var adeudado = gasNumero_(mapa.montoadeudado);
    var morat = gasNumero_(mapa.montomoratorios);
    var total = (mapa.montototal !== undefined && mapa.montototal !== '') ? gasNumero_(mapa.montototal) : adeudado + morat;
    var alias = String(mapa.propietarioalias || mapa.propietario || mapa.alias || '').trim();
    var c = combinados[info.clave];
    if (!c) c = combinados[info.clave] = { clave: info.clave, torre: info.torre, departamento: info.departamento, direccion: '', alias: '', adeudado: 0, morat: 0, total: 0, debePropietario: false, debeResidente: false };
    c.adeudado += adeudado; c.morat += morat; c.total += total;
    if (c.direccion.indexOf(direccion) === -1) c.direccion += (c.direccion ? ' + ' : '') + direccion;
    if (alias && c.alias.indexOf(alias) === -1) c.alias += (c.alias ? ' / ' : '') + alias;
    if (info.torre !== 'D' && total > 0) {
      if (/PROPIETARI/i.test(direccion)) c.debePropietario = true; else c.debeResidente = true;
    }
  });
  if (!leidas) throw new Error('No encontré columnas de Dirección con formato de departamento (ej. "TORRE B #B0804"). No se cambió nada.');

  var previas = {};
  leerTabla_(HOJA_GAS_REPORTE).filas.forEach(function (f) { previas[f.obj.clave] = f.obj; });
  Object.keys(previas).forEach(function (clave) {
    if (combinados[clave] || String(previas[clave].estado_gas) !== 'Cerrado') return;
    var p = previas[clave];
    combinados[clave] = { clave: clave, torre: p.torre, departamento: String(p.departamento), direccion: p.direccion || '', alias: p.alias || '', adeudado: 0, morat: 0, total: 0 };
  });

  var sh = hoja_(HOJA_GAS_REPORTE);
  var enc = encabezados_(sh);
  var lista = Object.keys(combinados).map(function (k) { return combinados[k]; }).sort(gasOrdenar_);
  var aplican = 0;
  var nuevas = lista.map(function (c) {
    var p = previas[c.clave] || {};
    var aplica = c.total > minimo;
    if (aplica) aplican++;
    var quienDebe = c.debePropietario && c.debeResidente ? 'Ambos' : (c.debePropietario ? 'Propietario' : (c.debeResidente ? 'Residente' : ''));
    return objetoAFila_(enc, {
      clave: c.clave, torre: c.torre, departamento: c.departamento, fecha_carga: hoy, direccion: c.direccion, alias: c.alias,
      monto_adeudado: c.adeudado, monto_moratorios: c.morat, monto_total: c.total, aplica_cierre: aplica, quien_debe: quienDebe,
      prorrogado: (p.prorrogado === true || p.prorrogado === 'TRUE'), motivo_prorroga: p.motivo_prorroga || '', autorizo_prorroga: p.autorizo_prorroga || '',
      fecha_limite_prorroga: p.fecha_limite_prorroga || '', estado_gas: p.estado_gas || 'Abierto', foto_evidencia_url: p.foto_evidencia_url || '',
      ejecutado_por: p.ejecutado_por || '', fecha_ejecucion: p.fecha_ejecucion || ''
    });
  });
  var ultima = sh.getLastRow();
  if (ultima > 1) sh.getRange(2, 1, ultima - 1, enc.length).clearContent();
  sh.getRange(2, 1, nuevas.length, enc.length).setValues(nuevas);
  invalidarColaDelDia_();
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'CARGAR_REPORTE_GAS', HOJA_GAS_REPORTE, '', '',
    lista.length + ' departamentos, ' + aplican + ' sobre el mínimo de ' + minimo + ', ' + ignoradas.length + ' filas ignoradas');
  var vista = gasVista_();
  vista.ok = true;
  vista.ignoradas = ignoradas.slice(0, 20);
  vista.total_ignoradas = ignoradas.length;
  return vista;
}

function guardarMontoMinimoGas(token, monto) {
  var usuario = requierePermiso_(token, PERMISOS.CONTROL_CIERRE_GAS);
  var n = Number(monto);
  if (isNaN(n) || n < 0) throw new Error('El monto mínimo debe ser un número igual o mayor a 0.');
  asegurarHojasGas_();
  var cfg = hoja_(HOJA_GAS_CONFIG);
  cfg.getRange(2, 1, 1, 2).setValues([[n, usuario.correo || usuario.id_usuario]]);
  var tabla = leerTabla_(HOJA_GAS_REPORTE);
  if (tabla.filas.length) {
    var col = tabla.encabezados.indexOf('aplica_cierre') + 1;
    var valores = tabla.filas.map(function (f) { return [(Number(f.obj.monto_total) || 0) > n]; });
    tabla.sh.getRange(2, col, valores.length, 1).setValues(valores);
  }
  invalidarColaDelDia_();
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EDITAR_MONTO_MINIMO_GAS', HOJA_GAS_CONFIG, '', '', String(n));
  return gasVista_();
}

function guardarProrrogaGas(token, clave, motivo, autorizo, fechaLimite) {
  var usuario = requierePermiso_(token, PERMISOS.CONTROL_CIERRE_GAS);
  motivo = String(motivo || '').trim(); autorizo = String(autorizo || '').trim(); fechaLimite = String(fechaLimite || '').trim();
  if (!motivo) throw new Error('Falta el motivo de la prórroga.');
  if (!autorizo) throw new Error('Falta quién autorizó la prórroga.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaLimite)) throw new Error('Falta la fecha límite de la prórroga.');
  if (fechaLimite < fechaHoy_()) throw new Error('La fecha límite no puede ser anterior a hoy.');
  var enc = buscarFilaPorValor_(HOJA_GAS_REPORTE, 'clave', clave, false);
  if (!enc) throw new Error('No existe el departamento "' + clave + '" en el reporte.');
  escribirCamposFila_(enc, { prorrogado: true, motivo_prorroga: motivo, autorizo_prorroga: autorizo, fecha_limite_prorroga: fechaLimite });
  invalidarColaDelDia_();
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'PRORROGA_GAS', HOJA_GAS_REPORTE, clave, '', 'hasta ' + fechaLimite + ' (' + autorizo + '): ' + motivo);
  return gasVista_();
}

function quitarProrrogaGas(token, clave) {
  var usuario = requierePermiso_(token, PERMISOS.CONTROL_CIERRE_GAS);
  var enc = buscarFilaPorValor_(HOJA_GAS_REPORTE, 'clave', clave, false);
  if (!enc) throw new Error('No existe el departamento "' + clave + '" en el reporte.');
  escribirCamposFila_(enc, { prorrogado: false, motivo_prorroga: '', autorizo_prorroga: '', fecha_limite_prorroga: '' });
  invalidarColaDelDia_();
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'QUITAR_PRORROGA_GAS', HOJA_GAS_REPORTE, clave, '', '');
  return gasVista_();
}

// --- Vista y ejecución del técnico: solo torre, número y acción (sin montos ni nombres) ---

function gasTareaVista_(registroId) {
  // Solo lectura: la acción se registra en la app de Lectura y cierre de servicios. Aquí el error se muestra al técnico.
  var items = gasPendientesProbador_(fechaHoy_()).map(function (x) {
    return { clave: x.clave, torre: x.torre, departamento: x.departamento, accion: x.accion, hecho: false };
  });
  return { registro_id: registroId, items: items, siguiente: null, total: items.length, hechos: 0, solo_lectura: true };
}

function obtenerTareaGas(token, registroId) {
  var usuario = requiereSesion_(token);
  if (!usuarioTienePermiso_(usuario, PERMISOS.EJECUTAR_TAREAS_COLA) && !usuarioTienePermiso_(usuario, PERMISOS.CONTROL_CIERRE_GAS)) {
    throw new Error('Tu perfil no tiene acceso a la tarea de gas.');
  }
  asegurarHojasGas_();
  return gasTareaVista_(registroId);
}

/** Registra un departamento con foto. Debe ser el siguiente de la lista (orden obligatorio). */
function registrarAccionGas(token, registroId, clave, fotoBase64, fotoMime, fotoNombre) {
  var usuario = requierePermiso_(token, PERMISOS.EJECUTAR_TAREAS_COLA);
  throw new Error('El cierre y la apertura de gas se registran en la app de Lectura y cierre de servicios, no aquí.');
  var tarea = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
  if (!tarea) throw new Error('No existe el registro de cola "' + registroId + '".');
  var obj = tarea.fila.obj;
  if (String(obj.tipo_origen) !== 'Gas') throw new Error('Ese registro de cola no es la tarea de gas.');
  if (obj.estado !== 'En proceso') throw new Error('Esta tarea no está en proceso.');
  if (obj.usuario_asignado_actual !== usuario.id_usuario) throw new Error('Esta tarea está asignada a otro usuario.');
  var vista = gasTareaVista_(registroId);
  var item = null;
  vista.items.forEach(function (x) { if (x.clave === clave) item = x; });
  if (!item) throw new Error('El departamento ' + clave + ' no tiene una acción de gas pendiente.');
  if (item.hecho) { vista.ok = true; vista.duplicado = true; return vista; }
  if (vista.siguiente !== clave) throw new Error('Debes recorrer los departamentos en orden. Sigue: ' + vista.siguiente + '.');
  if (!fotoBase64) throw new Error('Debes adjuntar la foto de evidencia de este departamento.');
  if (String(fotoBase64).length > 7000000) throw new Error('La imagen es demasiado grande. Usa una foto más ligera.');
  var blob = Utilities.newBlob(Utilities.base64Decode(fotoBase64), fotoMime || 'image/jpeg', fotoNombre || (clave + '.jpg'));
  var archivo = carpetaFotosEvidenciaTareas_().createFile(blob);
  archivo.setName(registroId + ' - GAS ' + clave + ' - ' + item.accion + ' - ' + new Date().getTime());
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = 'https://drive.google.com/thumbnail?sz=w500&id=' + archivo.getId();
  var enc = buscarFilaPorValor_(HOJA_GAS_REPORTE, 'clave', clave, false);
  escribirCamposFila_(enc, {
    estado_gas: item.accion === 'Cerrar' ? 'Cerrado' : 'Abierto', foto_evidencia_url: url,
    ejecutado_por: usuario.nombre_completo || usuario.correo || usuario.id_usuario, fecha_ejecucion: new Date()
  });
  registrarEvidenciaFoto_(usuario.id_usuario, 'GAS_DEPTO', registroId + '|' + clave, url);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EJECUTAR_GAS', HOJA_GAS_REPORTE, clave, '', item.accion);
  var nueva = gasTareaVista_(registroId);
  nueva.ok = true;
  return nueva;
}

/** Cierra la tarea de gas en la cola (llamada desde completarTarea). Exige que no quede ningún departamento pendiente. */
function completarTareaGas_(usuario, registroId, obj, descripcion) {
  var ahora = new Date();
  var inicio = obj.hora_inicio ? new Date(obj.hora_inicio) : null;
  var seg = (inicio && !isNaN(inicio.getTime())) ? Math.max(0, Math.round((ahora - inicio) / 1000)) : 0;
  var minutos = Math.max(1, Math.round((seg + (Number(obj.tiempo_acumulado_segundos) || 0)) / 60));
  var pend = gasPendientes_(fechaHoy_()).length;
  var enc = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
  escribirCamposFila_(enc, {
    estado: 'Completada', hora_fin: ahora, tiempo_total_minutos: minutos,
    descripcion_realizada: descripcion || ('Cierre/Apertura de gas: ' + pend + ' unidad(es) pendiente(s) al terminar según Lectura y cierre de servicios')
  });
  var extras = leerTabla_(HOJAS.EXTRA);
  extras.filas.forEach(function (f) {
    if (f.obj.registro_cola_id === registroId && String(f.obj.tipo_trabajo) === 'Gas') setCell_(extras, f.indiceFila, 'estado', 'Completado');
  });
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'COMPLETAR_TAREA_GAS', HOJAS.COLA, registroId, 'En proceso', 'Completada');
  return { ok: true, foto_url: '', cola: construirColaDelDia_(fechaHoy_()) };
}

// --- Inserción en la cola (mismo patrón que los trabajos programados) ---

function gasIdsColaNuevos_(cantidad) {
  var max = 0;
  leerTabla_(HOJAS.COLA).filas.forEach(function (f) {
    var m = /^COLA-(\d+)$/.exec(String(f.obj.registro_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var ids = [];
  for (var i = 1; i <= cantidad; i++) ids.push('COLA-' + ('00000' + (max + i)).slice(-5));
  return ids;
}

function gasInsertarFilaCola_(fecha, registroId, tipoOrigen, origenId, usuarioAsignado) {
  var sh = hoja_(HOJAS.COLA);
  var enc = encabezados_(sh);
  sh.getRange(sh.getLastRow() + 1, 1, 1, enc.length).setValues([objetoAFila_(enc, {
    registro_id: registroId, fecha: fecha, tarea_id: '', estado: 'Pendiente', usuario_asignado_actual: usuarioAsignado || '',
    hora_inicio: '', hora_fin: '', tiempo_total_minutos: '', codigo_salto: '', codigo_salto_confirmado: false,
    descripcion_realizada: '', tipo_origen: tipoOrigen, origen_id: origenId, tiempo_acumulado_segundos: 0
  })]);
}

/** Inserta (una vez) la tarea de gas de hoy si el módulo está activo y hay acciones pendientes. */
function agregarGasDelDiaACola_(fecha) {
  if (!moduloGasActivo_()) return null;
  if (!gasPendientes_(fecha).length) return null;
  var existente = null;
  leerTabla_(HOJAS.COLA).filas.forEach(function (f) {
    var o = f.obj;
    // Una sola tarea de gas por día (aunque ya esté completada): el estado real se lleva en el Probador.
    if (soloFecha_(o.fecha) === fecha && o.tipo_origen === 'Gas') existente = o.registro_id;
  });
  if (existente) return existente;
  var id = gasIdsColaNuevos_(1)[0];
  gasInsertarFilaCola_(fecha, id, 'Gas', 'GAS', '');
  return id;
}

function tareaDeExtraVinculado_(filaCola) {
  var enc = buscarFilaPorValor_(HOJAS.EXTRA, 'id', filaCola.origen_id, false);
  if (!enc) return null;
  var e = enc.fila.obj;
  if (String(e.tipo_trabajo) !== 'Checklist') return null;
  return { equipos_checklist: String(e.equipos_en_cola || e.equipos_checklist || ''), nombre_tarea: '', area_o_equipo_asociado: '' };
}

function gasEquiposCubiertosHoy_(fecha) {
  var catalogo = {};
  leerTabla_(HOJAS.CAT_TAREAS).filas.forEach(function (f) { catalogo[f.obj.tarea_id] = f.obj; });
  var equiposCat = obtenerCatalogoEquipos_();
  var cubiertos = {};
  leerTabla_(HOJAS.COLA).filas.forEach(function (f) {
    var o = f.obj;
    if (soloFecha_(o.fecha) !== fecha || o.estado === 'Saltada') return;
    var t = catalogo[o.tarea_id];
    if (!t && o.tipo_origen === 'Extra') t = tareaDeExtraVinculado_(o);
    if (!t) return;
    equiposDeTarea_(t, equiposCat).forEach(function (id) { cubiertos[id] = true; });
  });
  return cubiertos;
}

function esTrabajoVinculado_(o) {
  return String(o.tipo_trabajo) === 'Gas' || String(o.tipo_trabajo) === 'Checklist';
}

/** Trabajos programados de tipo Gas o Checklist de equipos cuya fecha es hoy. */
function agregarTrabajosVinculadosDelDiaACola_(fecha) {
  ['tipo_trabajo', 'equipos_checklist', 'equipos_en_cola', 'registro_cola_id'].forEach(function (c) { asegurarColumna_(HOJAS.EXTRA, c); });
  var tabla = leerTabla_(HOJAS.EXTRA);
  var vinculados = tabla.filas.filter(function (f) {
    var o = f.obj;
    return o.estado === 'Pendiente' && !o.registro_cola_id && o.fecha_programada && soloFecha_(o.fecha_programada) === fecha && esTrabajoVinculado_(o);
  });
  if (!vinculados.length) return;
  var cubiertos = null;
  vinculados.forEach(function (f) {
    var o = f.obj;
    if (o.tipo_trabajo === 'Gas') {
      if (!moduloGasActivo_()) return;
      if (!gasPendientes_(fecha).length) {
        setCell_(tabla, f.indiceFila, 'estado', 'Completado');
        setCell_(tabla, f.indiceFila, 'notas', 'Sin departamentos pendientes de cierre o apertura de gas.');
        return;
      }
      var idGas = agregarGasDelDiaACola_(fecha);
      if (idGas) setCell_(tabla, f.indiceFila, 'registro_cola_id', idGas);
      return;
    }
    if (!cubiertos) cubiertos = gasEquiposCubiertosHoy_(fecha);
    var pedidos = String(o.equipos_checklist || '').split(',').map(function (x) { return x.trim(); }).filter(String);
    var faltan = pedidos.filter(function (id) { return !cubiertos[id]; });
    if (!faltan.length) {
      setCell_(tabla, f.indiceFila, 'estado', 'Completado');
      setCell_(tabla, f.indiceFila, 'notas', 'Los equipos ya estaban cubiertos por el checklist de hoy.');
      return;
    }
    var id = gasIdsColaNuevos_(1)[0];
    gasInsertarFilaCola_(fecha, id, 'Extra', o.id, o.usuario_asignado);
    setCell_(tabla, f.indiceFila, 'equipos_en_cola', faltan.join(','));
    setCell_(tabla, f.indiceFila, 'registro_cola_id', id);
    faltan.forEach(function (e) { cubiertos[e] = true; });
  });
}

/** Punto único que usa asegurarColaDelDiaSinCache_ después de insertar las tareas del catálogo. */
function agregarModulosDelDiaACola_(fecha) {
  agregarTrabajosVinculadosDelDiaACola_(fecha);
  agregarExtrasDelDiaACola_(fecha);
  agregarGasDelDiaACola_(fecha);
}

/** Valida y normaliza tipo_trabajo / equipos_checklist de un trabajo programado antes de guardarlo. */
function validarTipoTrabajoExtra_(datos) {
  var tipo = String(datos.tipo_trabajo || '').trim();
  if (tipo !== 'Gas' && tipo !== 'Checklist') { datos.tipo_trabajo = ''; datos.equipos_checklist = ''; return; }
  if (!datos.fecha_programada) throw new Error('Un trabajo programado vinculado a un módulo necesita fecha programada.');
  if (tipo === 'Gas') {
    if (!moduloGasActivo_()) throw new Error('El módulo de Control de gas está desactivado. Actívalo primero desde Permisos.');
    datos.equipos_checklist = '';
    return;
  }
  var ids = String(datos.equipos_checklist || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  if (!ids.length) throw new Error('Elige al menos un equipo del checklist.');
  var validos = {};
  obtenerCatalogoEquipos_().forEach(function (e) { validos[e.equipo_id] = true; });
  ids.forEach(function (id) { if (!validos[id]) throw new Error('El equipo "' + id + '" no existe en el catálogo de equipos.'); });
  datos.equipos_checklist = ids.join(',');
}
