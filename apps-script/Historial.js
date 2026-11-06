/**
 * ============================================================================
 * HISTORIAL DE TRABAJOS — Bitácora MM103 (Fase 5, nov 2026)
 * ----------------------------------------------------------------------------
 * Al cerrar la jornada (disparador de las 00:10 o botón "Cerrar jornada"), los
 * renglones de la cola de días ya cerrados con estado final (completados,
 * saltados/cancelados y lo que la Fase 4 dejó oculto en su fecha) se COPIAN a
 * la hoja HISTORIAL_TRABAJOS. El renglón de la cola NO se borra: solo recibe la
 * fecha en la columna archivado_en. Es idempotente (un registro_id se archiva una
 * sola vez). Lo Pendiente / En proceso / Pausado no se toca (lo traslada el cierre).
 * Consulta por fecha, técnico, tipo y estado; exportación a Excel (navegador) y PDF.
 * ============================================================================
 */

var HOJA_HISTORIAL = 'HISTORIAL_TRABAJOS';
var COLUMNAS_HISTORIAL_ = ['fecha_jornada', 'registro_id', 'tipo', 'origen_id', 'tarea_id', 'nombre', 'estado_final', 'motivo',
  'descripcion_realizada', 'tecnico_id', 'tecnico_nombre', 'hora_inicio', 'hora_fin', 'minutos_trabajados',
  'foto_evidencia_url', 'fotos_evidencia_urls', 'reabierto_veces', 'archivado_en'];
var TIPOS_HISTORIAL_ = { Catalogo: 'Tarea', Extra: 'Trabajo programado', Ticket: 'Ticket', Gas: 'Gas' };
var MAX_HISTORIAL_CONSULTA_ = 5000;

/** Crea la hoja HISTORIAL_TRABAJOS si no existe (segura de llamar muchas veces). */
function asegurarHojaHistorial_() {
  var libro = ss_();
  var sh = libro.getSheetByName(HOJA_HISTORIAL);
  if (!sh) {
    sh = libro.insertSheet(HOJA_HISTORIAL);
    sh.getRange(1, 1, 1, COLUMNAS_HISTORIAL_.length).setValues([COLUMNAS_HISTORIAL_]);
    sh.getRange(1, 1, 1, COLUMNAS_HISTORIAL_.length).setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  } else {
    COLUMNAS_HISTORIAL_.forEach(function (c) { asegurarColumna_(HOJA_HISTORIAL, c); });
  }
  return sh;
}

/**
 * Estado final de un renglón de cola para el historial, o null si todavía no es final.
 * Completada -> Completado; Saltada por ticket cancelado -> Cancelado; otra Saltada -> Saltado;
 * oculto por la Fase 4 -> Cancelado / Tarea desactivada / Completado fuera de la cola.
 */
function estadoFinalHistorial_(o, mapas) {
  var tipo = o.tipo_origen || 'Catalogo';
  if (o.estado === 'Completada') return { estado: 'Completado', motivo: '' };
  if (o.estado === 'Saltada') {
    var d = String(o.descripcion_realizada || '');
    var tk = tipo === 'Ticket' ? (mapas.tickets || {})[o.origen_id] : null;
    if (/^Ticket cancelado/i.test(d) || (tk && tk.estado === 'Cancelado')) {
      return { estado: 'Cancelado', motivo: d.replace(/^Ticket cancelado:\s*/i, '') || 'Ticket cancelado' };
    }
    return { estado: 'Saltado', motivo: o.motivo_salto || d || '' };
  }
  if (o.estado === 'En proceso' || o.estado === 'Pausado') return null;
  // Pendiente: solo es final si la Fase 4 lo oculta (origen cerrado o tarea desactivada). '0000-00-00' = sin límite de fecha.
  var oculto = motivoOcultoEnCola_(o, mapas, '0000-00-00');
  if (!oculto) return null;
  if (/cancelad/i.test(oculto)) return { estado: 'Cancelado', motivo: oculto };
  if (/desactivad/i.test(oculto)) return { estado: 'Tarea desactivada', motivo: oculto };
  return { estado: 'Completado fuera de la cola', motivo: oculto };
}

function nombreTrabajoHistorial_(o, mapas) {
  var tipo = o.tipo_origen || 'Catalogo';
  if (tipo === 'Gas') return 'Cierre/Apertura de gas';
  if (tipo === 'Extra') return ((mapas.extras || {})[o.origen_id] || {}).descripcion || '(trabajo programado eliminado)';
  if (tipo === 'Ticket') return ((mapas.tickets || {})[o.origen_id] || {}).mensaje || '(ticket eliminado)';
  return ((mapas.catalogo || {})[o.tarea_id] || {}).nombre_tarea || '(tarea eliminada)';
}

/**
 * Archiva en HISTORIAL_TRABAJOS los renglones con estado final de días <= fechaLimite que aún no
 * tengan archivado_en. Primero escribe el historial y después marca la cola (si la marca fallara,
 * la siguiente corrida solo marca, sin duplicar). Devuelve { ok, archivados, marcados }.
 */
function archivarHistorialHasta_(fechaLimite, idUsuarioActor, correoActor) {
  var shHist = asegurarHojaHistorial_();
  asegurarColumna_(HOJAS.COLA, 'archivado_en');
  var tabla = leerTabla_(HOJAS.COLA);
  var colArchivado = tabla.encabezados.indexOf('archivado_en');
  if (colArchivado === -1) throw new Error('No se pudo crear la columna archivado_en en la cola.');
  var mapas = mapasOrdenCola_();
  var nombres = {};
  leerTabla_(HOJAS.USUARIOS).filas.forEach(function (f) { nombres[f.obj.id_usuario] = f.obj.nombre_completo || f.obj.correo || f.obj.id_usuario; });
  var tablaHist = leerTabla_(HOJA_HISTORIAL);
  var encHist = tablaHist.encabezados;
  var yaEnHistorial = {};
  tablaHist.filas.forEach(function (f) { if (f.obj.registro_id) yaEnHistorial[f.obj.registro_id] = true; });

  var ahora = new Date();
  var nuevas = [];
  var aMarcar = [];
  tabla.filas.forEach(function (f) {
    var o = f.obj;
    if (o.archivado_en) return;
    var dia = soloFecha_(o.fecha);
    if (!dia || dia > fechaLimite) return;
    var ef = estadoFinalHistorial_(o, mapas);
    if (!ef) return;
    aMarcar.push(f.indiceFila);
    if (yaEnHistorial[o.registro_id]) return;
    yaEnHistorial[o.registro_id] = true;
    var minutos = Number(o.tiempo_total_minutos) || 0;
    if (!minutos && Number(o.tiempo_acumulado_segundos)) minutos = Math.round(Number(o.tiempo_acumulado_segundos) / 60);
    var tecnico = o.usuario_asignado_actual || '';
    nuevas.push(objetoAFila_(encHist, {
      fecha_jornada: dia,
      registro_id: o.registro_id,
      tipo: TIPOS_HISTORIAL_[o.tipo_origen || 'Catalogo'] || o.tipo_origen,
      origen_id: o.origen_id || '',
      tarea_id: o.tarea_id || '',
      nombre: nombreTrabajoHistorial_(o, mapas),
      estado_final: ef.estado,
      motivo: ef.motivo,
      descripcion_realizada: o.descripcion_realizada || '',
      tecnico_id: tecnico,
      tecnico_nombre: tecnico ? (nombres[tecnico] || tecnico) : '',
      hora_inicio: o.hora_inicio || '',
      hora_fin: o.hora_fin || '',
      minutos_trabajados: minutos || '',
      foto_evidencia_url: o.foto_evidencia_url || '',
      fotos_evidencia_urls: o.fotos_evidencia_urls || '',
      reabierto_veces: parseInt(o.reabierto_veces, 10) || 0,
      archivado_en: ahora
    }));
  });

  if (nuevas.length) shHist.getRange(shHist.getLastRow() + 1, 1, nuevas.length, encHist.length).setValues(nuevas);
  if (aMarcar.length) {
    // Una sola lectura y una sola escritura de la columna archivado_en (rápido aunque sean miles de renglones).
    var rango = tabla.sh.getRange(2, colArchivado + 1, tabla.filas.length, 1);
    var valores = rango.getValues();
    aMarcar.forEach(function (fila) { valores[fila - 2][0] = ahora; });
    rango.setValues(valores);
  }
  if (nuevas.length) {
    registrarAuditoria_(idUsuarioActor || '', correoActor || '(sistema)', 'ARCHIVAR_HISTORIAL', HOJA_HISTORIAL, fechaLimite, '',
      nuevas.length + ' trabajo(s) archivado(s) hasta ' + fechaLimite);
  }
  return { ok: true, archivados: nuevas.length, marcados: aMarcar.length, hasta: fechaLimite };
}

/** Botón "Actualizar historial": archiva los días anteriores a hoy SIN cerrar la jornada. */
function actualizarHistorialTrabajos(token) {
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  var candado = LockService.getScriptLock();
  candado.waitLock(30000);
  try {
    return archivarHistorialHasta_(sumarDias_(fechaHoy_(), -1), usuario.id_usuario, usuario.correo);
  } finally {
    candado.releaseLock();
  }
}

/** Filtra el historial. filtros: { desde, hasta, tecnico, tipo, estado, texto } */
function consultarHistorial_(filtros) {
  filtros = filtros || {};
  var hoy = fechaHoy_();
  var desde = filtros.desde || sumarDias_(hoy, -7);
  var hasta = filtros.hasta || hoy;
  var tabla = leerTablaSiExiste_(HOJA_HISTORIAL);
  var todas = tabla.filas.map(function (f) { return f.obj; });
  var unicos = function (campo) {
    var vistos = {};
    todas.forEach(function (o) { var v = String(o[campo] || ''); if (v) vistos[v] = true; });
    return Object.keys(vistos).sort();
  };
  var q = String(filtros.texto || '').trim().toLowerCase();
  var ultimo = '';
  var lista = todas.filter(function (o) {
    var archivo = o.archivado_en ? String(o.archivado_en) : '';
    if (archivo > ultimo) ultimo = archivo;
    var dia = soloFecha_(o.fecha_jornada);
    if (!dia || dia < desde || dia > hasta) return false;
    if (filtros.tecnico && String(o.tecnico_nombre || '') !== filtros.tecnico) return false;
    if (filtros.tipo && String(o.tipo || '') !== filtros.tipo) return false;
    if (filtros.estado && String(o.estado_final || '') !== filtros.estado) return false;
    if (q && [o.nombre, o.motivo, o.descripcion_realizada, o.tecnico_nombre, o.registro_id].join(' ').toLowerCase().indexOf(q) === -1) return false;
    return true;
  });
  lista.sort(function (a, b) {
    var da = soloFecha_(a.fecha_jornada), db = soloFecha_(b.fecha_jornada);
    if (da !== db) return da < db ? 1 : -1;
    return String(b.hora_fin || '').localeCompare(String(a.hora_fin || ''));
  });
  return {
    filtros: { desde: desde, hasta: hasta, tecnico: filtros.tecnico || '', tipo: filtros.tipo || '', estado: filtros.estado || '', texto: filtros.texto || '' },
    total: lista.length,
    truncado: lista.length > MAX_HISTORIAL_CONSULTA_,
    filas: lista.slice(0, MAX_HISTORIAL_CONSULTA_).map(function (o) {
      return {
        fecha_jornada: soloFecha_(o.fecha_jornada), registro_id: o.registro_id, tipo: o.tipo, origen_id: o.origen_id, tarea_id: o.tarea_id,
        nombre: o.nombre, estado_final: o.estado_final, motivo: o.motivo, descripcion_realizada: o.descripcion_realizada,
        tecnico_id: o.tecnico_id, tecnico_nombre: o.tecnico_nombre, hora_inicio: o.hora_inicio, hora_fin: o.hora_fin,
        minutos_trabajados: o.minutos_trabajados === '' ? '' : Number(o.minutos_trabajados) || 0,
        foto_evidencia_url: o.foto_evidencia_url, reabierto_veces: Number(o.reabierto_veces) || 0
      };
    }),
    opciones: { tecnicos: unicos('tecnico_nombre'), tipos: unicos('tipo'), estados: unicos('estado_final') },
    ultimo_archivado: ultimo,
    hay_hoja: !!tabla.encabezados.length
  };
}

/** Consulta para la pantalla "Historial de trabajos" (mismos perfiles que Reportes). */
function obtenerHistorialTrabajos(token, filtros) {
  requiereReportes_(token);
  return consultarHistorial_(filtros);
}

/** Datos para el Excel que arma el navegador; deja constancia en la auditoría. */
function obtenerHistorialParaExcel(token, filtros) {
  var usuario = requiereReportes_(token);
  var r = consultarHistorial_(filtros);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EXPORTAR_HISTORIAL_EXCEL', HOJA_HISTORIAL, '', '', r.filtros.desde + ' a ' + r.filtros.hasta + ' (' + r.total + ')');
  return r;
}

/** PDF del historial filtrado; se archiva en la carpeta de reportes y se devuelve en base64. */
function generarHistorialPdf(token, filtros) {
  var usuario = requiereReportes_(token);
  var r = consultarHistorial_(filtros);
  var e = escHtmlReporte_;
  var MAX_PDF = 500;
  var filtrosTxt = 'Periodo: ' + r.filtros.desde + ' al ' + r.filtros.hasta +
    (r.filtros.tecnico ? ' · Técnico: ' + r.filtros.tecnico : '') + (r.filtros.tipo ? ' · Tipo: ' + r.filtros.tipo : '') +
    (r.filtros.estado ? ' · Estado: ' + r.filtros.estado : '') + (r.filtros.texto ? ' · Búsqueda: ' + r.filtros.texto : '');
  var porEstado = {};
  var minutos = 0;
  r.filas.forEach(function (f) { porEstado[f.estado_final] = (porEstado[f.estado_final] || 0) + 1; minutos += Number(f.minutos_trabajados) || 0; });
  var cuerpo = r.filas.slice(0, MAX_PDF).map(function (f) {
    return '<tr><td>' + e(f.fecha_jornada) + '</td><td>' + e(f.tipo) + '</td><td>' + e(f.nombre) + '</td><td>' + e(f.estado_final) +
      '</td><td>' + e(f.tecnico_nombre) + '</td><td>' + e(f.minutos_trabajados) + '</td><td>' + e(f.motivo || f.descripcion_realizada) + '</td></tr>';
  }).join('');
  var html = '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;font-size:10px;color:#222;margin:24px;}h1{color:#1F4E78;font-size:18px;margin:0;}' +
    '.sub{color:#555;margin:2px 0 10px;}table{border-collapse:collapse;width:100%;}th{background:#1F4E78;color:#fff;text-align:left;padding:4px;font-size:9px;}' +
    'td{border-bottom:1px solid #ddd;padding:3px 4px;font-size:9px;vertical-align:top;}.res td{border:1px solid #cfd8e3;padding:6px;text-align:center;}' +
    '.vacio{color:#777;font-style:italic;}.pie{margin-top:20px;color:#777;font-size:8px;}</style></head><body>' +
    '<h1>Condominio Maestro Meridiano 103</h1><div class="sub"><b>Historial de trabajos</b> — ' + e(filtrosTxt) + '</div>' +
    '<table class="res"><tr><td><b>' + r.total + '</b><br>trabajos</td><td><b>' + minutos + '</b><br>minutos</td>' +
    Object.keys(porEstado).sort().map(function (k) { return '<td><b>' + porEstado[k] + '</b><br>' + e(k) + '</td>'; }).join('') + '</tr></table><br>' +
    (r.filas.length ? '<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Trabajo</th><th>Estado final</th><th>Técnico</th><th>Min.</th><th>Motivo / descripción</th></tr></thead><tbody>' +
      cuerpo + '</tbody></table>' : '<p class="vacio">Sin trabajos en el periodo.</p>') +
    (r.filas.length > MAX_PDF ? '<p class="vacio">Se muestran ' + MAX_PDF + ' de ' + r.filas.length + ' registros; el detalle completo está en el Excel.</p>' : '') +
    '<div class="pie">Generado el ' + e(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')) + ' por ' + e(usuario.nombre_completo || usuario.correo) +
    ' desde la Bitácora de Mantenimiento MM103.</div></body></html>';
  var nombre = 'Historial de trabajos MM103 ' + r.filtros.desde + ' a ' + r.filtros.hasta + '.pdf';
  var pdf = Utilities.newBlob(html, 'text/html', 'historial.html').getAs('application/pdf').setName(nombre);
  var url = '';
  try { url = carpetaReportes_().createFile(pdf).getUrl(); } catch (err) { url = ''; }
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EXPORTAR_HISTORIAL_PDF', HOJA_HISTORIAL, '', '', r.filtros.desde + ' a ' + r.filtros.hasta + ' (' + r.total + ')');
  return { ok: true, nombre: nombre, base64: Utilities.base64Encode(pdf.getBytes()), url: url };
}