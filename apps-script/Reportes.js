// ============================================================================
// MÓDULO Reportes — Fase 7 (exportar auditoría a Excel/PDF) y Fase 8 (dashboard
// de indicadores con filtros por fechas, técnico y área).
// Solo LEE las hojas existentes; no modifica ningún dato de operación.
// ============================================================================

var PERMISOS_REPORTES_ = ['ALTA_BAJA_USUARIOS', 'CARGAR_MODIFICAR_TAREAS', 'AUDITORIA_INVENTARIO', 'GENERAR_CODIGO_SALTO'];

function puedeVerReportes_(usuario) {
  return PERMISOS_REPORTES_.some(function (p) { return usuarioTienePermiso_(usuario, p); });
}

function requiereReportes_(token) {
  var usuario = requiereSesion_(token);
  if (!puedeVerReportes_(usuario)) throw new Error('Tu perfil no tiene acceso a Reportes e indicadores.');
  return usuario;
}

/** Convierte Date / ISO / 'yyyy-MM-dd' a 'yyyy-MM-dd' en la zona del script. */
function fechaClaveReporte_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var d = null;
  if (Object.prototype.toString.call(v) === '[object Date]') d = v;
  else {
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var p = new Date(s);
    if (!isNaN(p.getTime())) d = p;
  }
  if (!d || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function fechaHoraTextoReporte_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var d = (Object.prototype.toString.call(v) === '[object Date]') ? v : new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

/** Lee una hoja si existe; si no, devuelve tabla vacía (no truena el reporte). */
function leerTablaSiExiste_(nombre) {
  if (!ss_().getSheetByName(nombre)) return { encabezados: [], filas: [] };
  return leerTabla_(nombre);
}

function enRango_(clave, desde, hasta) {
  if (!clave) return false;
  return (!desde || clave >= desde) && (!hasta || clave <= hasta);
}

/** Columnas que nunca salen en un reporte. */
var COLUMNAS_EXCLUIDAS_REPORTE_ = ['password_hash', 'password_salt', 'token_codigo', 'token_expira', 'codigo_salto', 'codigo_personal', 'token_sesion'];

/**
 * Arma todos los datos del reporte. filtros: { desde, hasta, usuario_id, area }
 * Devuelve { generado, filtros, resumen, porTecnico, porArea, porTarea, materiales, hojas:[{nombre, columnas, filas}] }
 */
function construirReporte_(filtros) {
  filtros = filtros || {};
  var hoy = fechaHoy_();
  var desde = filtros.desde || hoy.substring(0, 8) + '01';
  var hasta = filtros.hasta || hoy;
  if (desde > hasta) { var t = desde; desde = hasta; hasta = t; }
  var filtroUsuario = filtros.usuario_id || '';
  var filtroArea = String(filtros.area || '').trim().toLowerCase();

  // Catálogos para traducir ids a nombres
  var usuarios = {};
  leerTablaSiExiste_(HOJAS.USUARIOS).filas.forEach(function (f) { usuarios[f.obj.id_usuario] = f.obj.nombre_completo || f.obj.correo || f.obj.id_usuario; });
  var nombreUsuario = function (id) { return id ? (usuarios[id] || id) : ''; };
  var catalogo = {};
  leerTablaSiExiste_(HOJAS.CAT_TAREAS).filas.forEach(function (f) { catalogo[f.obj.tarea_id] = f.obj; });
  var extras = {};
  leerTablaSiExiste_(HOJAS.EXTRA).filas.forEach(function (f) { extras[f.obj.id] = f.obj; });
  var tickets = leerTablaSiExiste_('TICKETS_INDICACIONES');
  var ticketsPorId = {};
  tickets.filas.forEach(function (f) { ticketsPorId[f.obj.ticket_id] = f.obj; });
  var materiales = {};
  leerTablaSiExiste_('ALMACEN_CATALOGO_MATERIALES').filas.forEach(function (f) { materiales[f.obj.material_id] = f.obj; });

  // ---------------- TRABAJOS (cola diaria) ----------------
  var trabajos = [];
  leerTablaSiExiste_(HOJAS.COLA).filas.forEach(function (f) {
    var o = f.obj;
    var fecha = fechaClaveReporte_(o.fecha);
    if (!enRango_(fecha, desde, hasta)) return;
    var tipoOrigen = o.tipo_origen || 'Catalogo';
    var nombre = '', area = '', tipo = '';
    if (tipoOrigen === 'Ticket') {
      var tk = ticketsPorId[o.origen_id] || {};
      nombre = tk.mensaje || '(ticket)'; tipo = 'Ticket ' + (tk.prioridad || '');
    } else if (tipoOrigen === 'Extra') {
      var ex = extras[o.origen_id] || {};
      nombre = ex.descripcion || '(trabajo programado)'; tipo = 'Trabajo programado'; area = ex.area || ex.area_o_equipo_asociado || '';
    } else {
      var c = catalogo[o.tarea_id] || {};
      nombre = c.nombre_tarea || '(tarea)'; tipo = c.tipo || 'Diaria'; area = c.area_o_equipo_asociado || '';
    }
    if (filtroUsuario && o.usuario_asignado_actual !== filtroUsuario) return;
    if (filtroArea && String(area).toLowerCase().indexOf(filtroArea) === -1 && String(nombre).toLowerCase().indexOf(filtroArea) === -1) return;
    var minutos = Number(o.tiempo_total_minutos);
    trabajos.push({
      fecha: fecha,
      registro_id: o.registro_id,
      origen: tipoOrigen,
      trabajo: nombre,
      tipo: tipo,
      area: area,
      estado: o.estado,
      tecnico: nombreUsuario(o.usuario_asignado_actual),
      tecnico_id: o.usuario_asignado_actual || '',
      hora_inicio: fechaHoraTextoReporte_(o.hora_inicio),
      hora_fin: fechaHoraTextoReporte_(o.hora_fin),
      minutos: isNaN(minutos) || o.tiempo_total_minutos === '' ? '' : Math.round(minutos * 10) / 10,
      descripcion: o.descripcion_realizada || '',
      motivo_salto: o.motivo_salto || '',
      evidencia: o.fotos_evidencia_urls || o.foto_evidencia_url || ''
    });
  });

  // ---------------- TICKETS ----------------
  var listaTickets = [];
  tickets.filas.forEach(function (f) {
    var o = f.obj;
    var fecha = fechaClaveReporte_(o.fecha_hora_creacion);
    if (!enRango_(fecha, desde, hasta)) return;
    if (filtroUsuario && o.dirigido_a !== filtroUsuario) return;
    if (filtroArea && String(o.mensaje || '').toLowerCase().indexOf(filtroArea) === -1) return;
    listaTickets.push({
      fecha: fecha,
      ticket_id: o.ticket_id,
      creado: fechaHoraTextoReporte_(o.fecha_hora_creacion),
      creado_por: nombreUsuario(o.creado_por),
      dirigido_a: nombreUsuario(o.dirigido_a),
      mensaje: o.mensaje,
      prioridad: o.prioridad,
      estado: o.estado,
      atendido: fechaHoraTextoReporte_(o.fecha_hora_atendido)
    });
  });

  // ---------------- ALMACÉN ----------------
  var movimientos = [];
  leerTablaSiExiste_('ALMACEN_MOVIMIENTOS').filas.forEach(function (f) {
    var o = f.obj;
    var fecha = fechaClaveReporte_(o.fecha_hora);
    if (!enRango_(fecha, desde, hasta)) return;
    if (filtroUsuario && o.usuario_id !== filtroUsuario) return;
    var m = materiales[o.material_id] || {};
    movimientos.push({
      fecha: fecha,
      fecha_hora: fechaHoraTextoReporte_(o.fecha_hora),
      material_id: o.material_id,
      material: m.nombre || o.material_id,
      tipo: o.tipo,
      cantidad: Number(o.cantidad) || 0,
      unidad: m.unidad_medida || '',
      usuario: nombreUsuario(o.usuario_id),
      tarea_relacionada: o.tarea_relacionada_id || '',
      notas: o.notas || ''
    });
  });

  // ---------------- EQUIPOS (una hoja por equipo del catálogo) ----------------
  var hojasEquipo = [];
  var lecturasPorEquipo = {};
  leerTablaSiExiste_('EQUIPO_CATALOGO').filas.forEach(function (f) {
    var eq = f.obj;
    if (!eq.hoja_relacionada) return;
    var tabla = leerTablaSiExiste_(eq.hoja_relacionada);
    if (!tabla.encabezados.length) return;
    var columnas = tabla.encabezados.filter(function (h) { return h && COLUMNAS_EXCLUIDAS_REPORTE_.indexOf(h) === -1; });
    var filas = [];
    tabla.filas.forEach(function (fr) {
      var o = fr.obj;
      var fecha = fechaClaveReporte_(o.fecha_hora || o.fecha);
      if (!enRango_(fecha, desde, hasta)) return;
      if (filtroUsuario && o.usuario_id && o.usuario_id !== filtroUsuario) return;
      filas.push(columnas.map(function (h) {
        if (h === 'usuario_id') return nombreUsuario(o[h]);
        if (h === 'fecha_hora') return fechaHoraTextoReporte_(o[h]);
        var v = o[h];
        return (v === null || v === undefined) ? '' : v;
      }));
    });
    lecturasPorEquipo[eq.nombre || eq.equipo_id] = filas.length;
    hojasEquipo.push({ nombre: String(eq.nombre || eq.hoja_relacionada).substring(0, 31), columnas: columnas.map(function (h) { return h === 'usuario_id' ? 'tecnico' : h; }), filas: filas });
  });

  // ---------------- COMIDAS ----------------
  var comidas = [];
  leerTablaSiExiste_('COMIDAS_REGISTRO').filas.forEach(function (f) {
    var o = f.obj;
    var fecha = fechaClaveReporte_(o.fecha || o.hora_inicio);
    if (!enRango_(fecha, desde, hasta)) return;
    if (filtroUsuario && o.usuario_id !== filtroUsuario) return;
    var ini = o.hora_inicio ? new Date(o.hora_inicio) : null;
    var fin = o.hora_fin ? new Date(o.hora_fin) : null;
    var min = (ini && fin && !isNaN(ini) && !isNaN(fin)) ? Math.round((fin - ini) / 60000) : '';
    comidas.push({ fecha: fecha, tecnico: nombreUsuario(o.usuario_id), inicio: fechaHoraTextoReporte_(o.hora_inicio), fin: fechaHoraTextoReporte_(o.hora_fin), minutos: min });
  });

  // ---------------- AUDITORÍA (bitácora de cambios) ----------------
  var auditoria = [];
  leerTablaSiExiste_(HOJAS.LOG).filas.forEach(function (f) {
    var o = f.obj;
    var fecha = fechaClaveReporte_(o.timestamp);
    if (!enRango_(fecha, desde, hasta)) return;
    if (filtroUsuario && o.id_usuario_ejecuta && o.id_usuario_ejecuta !== filtroUsuario) return;
    auditoria.push({
      fecha_hora: fechaHoraTextoReporte_(o.timestamp),
      quien: o.correo_ejecuta || '',
      accion: o.accion || '',
      entidad: o.entidad || '',
      id: o.id_entidad_afectada || '',
      antes: o.valor_anterior || '',
      despues: o.valor_nuevo || ''
    });
  });

  // ---------------- INDICADORES ----------------
  var resumen = {
    trabajos_total: trabajos.length,
    completadas: 0, saltadas: 0, no_realizadas: 0, pendientes: 0, en_proceso: 0,
    minutos_trabajados: 0, tareas_con_tiempo: 0,
    tickets_total: listaTickets.length, tickets_atendidos: 0, tickets_abiertos: 0, tickets_cancelados: 0, tickets_alta: 0,
    movimientos_almacen: movimientos.length,
    lecturas_equipos: hojasEquipo.reduce(function (s, h) { return s + h.filas.length; }, 0),
    minutos_comida: 0,
    dias: 0
  };
  var porTecnico = {}, porArea = {}, porTarea = {}, porDia = {};
  trabajos.forEach(function (t) {
    var e = String(t.estado || '');
    if (e === 'Completada' || e === 'Completado') resumen.completadas++;
    else if (e === 'Saltada' && String(t.motivo_salto).indexOf('No trasladada') === 0) resumen.no_realizadas++;
    else if (e === 'Saltada') resumen.saltadas++;
    else if (e === 'En proceso') resumen.en_proceso++;
    else resumen.pendientes++;
    porDia[t.fecha] = porDia[t.fecha] || { fecha: t.fecha, total: 0, completadas: 0 };
    porDia[t.fecha].total++;
    if (e === 'Completada' || e === 'Completado') porDia[t.fecha].completadas++;
    if (t.minutos !== '') { resumen.minutos_trabajados += Number(t.minutos); resumen.tareas_con_tiempo++; }
    if (t.tecnico) {
      var pt = porTecnico[t.tecnico] = porTecnico[t.tecnico] || { tecnico: t.tecnico, completadas: 0, saltadas: 0, minutos: 0, con_tiempo: 0, comida: 0 };
      if (e === 'Completada' || e === 'Completado') pt.completadas++;
      if (e === 'Saltada' && String(t.motivo_salto).indexOf('No trasladada') !== 0) pt.saltadas++;
      if (t.minutos !== '') { pt.minutos += Number(t.minutos); pt.con_tiempo++; }
    }
    var a = t.area || '(sin área)';
    var pa = porArea[a] = porArea[a] || { area: a, total: 0, completadas: 0, minutos: 0 };
    pa.total++; if (e === 'Completada' || e === 'Completado') pa.completadas++;
    if (t.minutos !== '') pa.minutos += Number(t.minutos);
    if (t.minutos !== '') {
      var pk = porTarea[t.trabajo] = porTarea[t.trabajo] || { trabajo: t.trabajo, veces: 0, minutos: 0 };
      pk.veces++; pk.minutos += Number(t.minutos);
    }
  });
  listaTickets.forEach(function (t) {
    if (t.estado === 'Atendido') resumen.tickets_atendidos++;
    else if (t.estado === 'Cancelado') resumen.tickets_cancelados++;
    else resumen.tickets_abiertos++;
    if (t.prioridad === 'Alta') resumen.tickets_alta++;
  });
  comidas.forEach(function (c) {
    if (c.minutos !== '') {
      resumen.minutos_comida += c.minutos;
      if (porTecnico[c.tecnico]) porTecnico[c.tecnico].comida += c.minutos;
    }
  });
  var consumo = {};
  movimientos.forEach(function (m) {
    var tipo = String(m.tipo || '').toLowerCase();
    if (tipo.indexOf('consumo') === -1 && tipo.indexOf('salida') === -1) return;
    var k = m.material + (m.unidad ? ' (' + m.unidad + ')' : '');
    consumo[k] = (consumo[k] || 0) + Math.abs(m.cantidad);
  });
  resumen.dias = Object.keys(porDia).length;
  resumen.cumplimiento_pct = resumen.trabajos_total ? Math.round(resumen.completadas * 1000 / resumen.trabajos_total) / 10 : 0;
  resumen.minutos_promedio = resumen.tareas_con_tiempo ? Math.round(resumen.minutos_trabajados * 10 / resumen.tareas_con_tiempo) / 10 : 0;
  resumen.minutos_trabajados = Math.round(resumen.minutos_trabajados);

  var listaTecnicos = Object.keys(porTecnico).map(function (k) {
    var p = porTecnico[k];
    p.minutos = Math.round(p.minutos);
    p.promedio = p.con_tiempo ? Math.round(p.minutos * 10 / p.con_tiempo) / 10 : 0;
    delete p.con_tiempo;
    return p;
  }).sort(function (a, b) { return b.completadas - a.completadas; });
  var listaAreas = Object.keys(porArea).map(function (k) { var p = porArea[k]; p.minutos = Math.round(p.minutos); return p; })
    .sort(function (a, b) { return b.total - a.total; });
  var listaTareas = Object.keys(porTarea).map(function (k) {
    var p = porTarea[k]; p.promedio = Math.round(p.minutos * 10 / p.veces) / 10; p.minutos = Math.round(p.minutos); return p;
  }).sort(function (a, b) { return b.minutos - a.minutos; });
  var listaMateriales = Object.keys(consumo).map(function (k) { return { material: k, cantidad: Math.round(consumo[k] * 100) / 100 }; })
    .sort(function (a, b) { return b.cantidad - a.cantidad; });
  var listaDias = Object.keys(porDia).sort().map(function (k) { return porDia[k]; });

  function hojaDe_(nombre, lista, columnas) {
    return { nombre: nombre, columnas: columnas, filas: lista.map(function (o) { return columnas.map(function (c) { return o[c] === undefined ? '' : o[c]; }); }) };
  }

  var hojas = [
    hojaDe_('Trabajos', trabajos, ['fecha', 'registro_id', 'origen', 'trabajo', 'tipo', 'area', 'estado', 'tecnico', 'hora_inicio', 'hora_fin', 'minutos', 'descripcion', 'motivo_salto', 'evidencia']),
    hojaDe_('Tickets', listaTickets, ['fecha', 'ticket_id', 'creado', 'creado_por', 'dirigido_a', 'mensaje', 'prioridad', 'estado', 'atendido']),
    hojaDe_('Almacen movimientos', movimientos, ['fecha_hora', 'material_id', 'material', 'tipo', 'cantidad', 'unidad', 'usuario', 'tarea_relacionada', 'notas']),
    hojaDe_('Consumo de material', listaMateriales, ['material', 'cantidad'])
  ].concat(hojasEquipo).concat([
    hojaDe_('Comidas', comidas, ['fecha', 'tecnico', 'inicio', 'fin', 'minutos']),
    hojaDe_('Auditoria', auditoria, ['fecha_hora', 'quien', 'accion', 'entidad', 'id', 'antes', 'despues'])
  ]);

  return {
    generado: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    filtros: { desde: desde, hasta: hasta, usuario_id: filtroUsuario, usuario: nombreUsuario(filtroUsuario), area: filtros.area || '' },
    resumen: resumen,
    porTecnico: listaTecnicos,
    porArea: listaAreas,
    porTarea: listaTareas.slice(0, 15),
    porDia: listaDias,
    materiales: listaMateriales.slice(0, 15),
    lecturasPorEquipo: lecturasPorEquipo,
    hojas: hojas
  };
}

/** Opciones para los filtros del dashboard (técnicos y áreas). */
function opcionesFiltrosReporte(token) {
  requiereReportes_(token);
  var usuarios = leerTablaSiExiste_(HOJAS.USUARIOS).filas.map(function (f) {
    return { id: f.obj.id_usuario, nombre: f.obj.nombre_completo || f.obj.correo, rol: f.obj.rol, estado: f.obj.estado };
  }).filter(function (u) { return u.id; });
  var areas = {};
  leerTablaSiExiste_(HOJAS.CAT_TAREAS).filas.forEach(function (f) { if (f.obj.area_o_equipo_asociado) areas[f.obj.area_o_equipo_asociado] = true; });
  return { usuarios: usuarios, areas: Object.keys(areas).sort(), hoy: fechaHoy_() };
}

/** Dashboard: solo indicadores (sin las tablas de detalle, para que cargue rápido). */
function obtenerDashboard(token, filtros) {
  requiereReportes_(token);
  var r = construirReporte_(filtros);
  delete r.hojas;
  return r;
}

/** Datos completos para que el navegador arme el Excel. */
function obtenerDatosReporteExcel(token, filtros) {
  var usuario = requiereReportes_(token);
  var r = construirReporte_(filtros);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EXPORTAR_REPORTE_EXCEL', 'REPORTES', '', '', r.filtros.desde + ' a ' + r.filtros.hasta);
  return r;
}

/** Carpeta de Drive donde se archivan los reportes (se crea una vez y se reutiliza). */
function carpetaReportes_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CARPETA_REPORTES_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* se borró: crear de nuevo */ }
  }
  var carpeta = DriveApp.createFolder('MM103 - Reportes de Mantenimiento');
  props.setProperty('CARPETA_REPORTES_ID', carpeta.getId());
  return carpeta;
}

/** Guarda en Drive una copia del Excel que armó el navegador (archivo histórico). */
function guardarExcelReporteEnDrive(token, base64, nombreArchivo) {
  var usuario = requiereReportes_(token);
  var blob = Utilities.newBlob(Utilities.base64Decode(base64), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nombreArchivo);
  var archivo = carpetaReportes_().createFile(blob);
  return { ok: true, url: archivo.getUrl() };
}

function escHtmlReporte_(s) {
  return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Genera el PDF ejecutivo (resumen + tablas principales), lo archiva en Drive y lo devuelve en base64. */
function generarReportePdf(token, filtros) {
  var usuario = requiereReportes_(token);
  var r = construirReporte_(filtros);
  var s = r.resumen;
  var e = escHtmlReporte_;
  function tabla_(titulo, columnas, filas, max) {
    if (!filas.length) return '<h3>' + e(titulo) + '</h3><p class="vacio">Sin registros en el periodo.</p>';
    var cuerpo = filas.slice(0, max || filas.length).map(function (f) {
      return '<tr>' + f.map(function (v) { return '<td>' + e(v) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var nota = (max && filas.length > max) ? '<p class="vacio">Se muestran ' + max + ' de ' + filas.length + ' registros; el detalle completo está en el Excel.</p>' : '';
    return '<h3>' + e(titulo) + '</h3><table><thead><tr>' + columnas.map(function (c) { return '<th>' + e(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + cuerpo + '</tbody></table>' + nota;
  }
  function kpi_(titulo, valor) { return '<td class="kpi"><div class="v">' + e(valor) + '</div><div class="t">' + e(titulo) + '</div></td>'; }
  var filtrosTxt = 'Periodo: ' + r.filtros.desde + ' al ' + r.filtros.hasta +
    (r.filtros.usuario ? ' · Técnico: ' + r.filtros.usuario : '') + (r.filtros.area ? ' · Área: ' + r.filtros.area : '');

  var html = '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;font-size:10px;color:#222;margin:24px;}' +
    'h1{color:#1F4E78;font-size:18px;margin:0;}h2{color:#1F4E78;font-size:13px;margin:18px 0 6px;border-bottom:2px solid #1F4E78;padding-bottom:3px;}' +
    'h3{font-size:11px;margin:12px 0 4px;color:#333;}.sub{color:#555;margin:2px 0 10px;}' +
    'table{border-collapse:collapse;width:100%;margin-bottom:6px;}th{background:#1F4E78;color:#fff;text-align:left;padding:4px;font-size:9px;}' +
    'td{border-bottom:1px solid #ddd;padding:3px 4px;font-size:9px;vertical-align:top;}' +
    '.kpis td.kpi{border:1px solid #cfd8e3;text-align:center;padding:8px;width:16%;}.kpi .v{font-size:16px;font-weight:bold;color:#1F4E78;}.kpi .t{font-size:8px;color:#555;}' +
    '.vacio{color:#777;font-style:italic;}.pie{margin-top:20px;color:#777;font-size:8px;}' +
    '</style></head><body>' +
    '<h1>Condominio Maestro Meridiano 103</h1>' +
    '<div class="sub"><b>Reporte de Mantenimiento</b> — ' + e(filtrosTxt) + '</div>' +
    '<h2>Indicadores del periodo</h2>' +
    '<table class="kpis"><tr>' +
    kpi_('Trabajos en cola', s.trabajos_total) + kpi_('Completados', s.completadas) + kpi_('Cumplimiento', s.cumplimiento_pct + '%') +
    kpi_('Saltados', s.saltadas) + kpi_('Min. promedio por trabajo', s.minutos_promedio) + kpi_('Horas trabajadas', Math.round(s.minutos_trabajados / 6) / 10) +
    '</tr><tr>' +
    kpi_('Tickets recibidos', s.tickets_total) + kpi_('Tickets atendidos', s.tickets_atendidos) + kpi_('Tickets abiertos', s.tickets_abiertos) +
    kpi_('Tickets urgentes', s.tickets_alta) + kpi_('Movimientos de almacén', s.movimientos_almacen) + kpi_('Lecturas de equipos', s.lecturas_equipos) +
    '</tr></table>' +
    '<h2>Desempeño por técnico</h2>' +
    tabla_('Trabajos y tiempos', ['Técnico', 'Completados', 'Saltados', 'Minutos trabajados', 'Min. promedio', 'Min. de comida'],
      r.porTecnico.map(function (p) { return [p.tecnico, p.completadas, p.saltadas, p.minutos, p.promedio, p.comida]; })) +
    '<h2>Trabajo por área</h2>' +
    tabla_('Áreas', ['Área', 'Trabajos', 'Completados', 'Minutos'], r.porArea.map(function (p) { return [p.area, p.total, p.completadas, p.minutos]; })) +
    tabla_('Trabajos que más tiempo consumen', ['Trabajo', 'Veces', 'Minutos totales', 'Min. promedio'], r.porTarea.map(function (p) { return [p.trabajo, p.veces, p.minutos, p.promedio]; })) +
    '<h2>Almacén</h2>' +
    tabla_('Material más utilizado (consumo y salidas)', ['Material', 'Cantidad'], r.materiales.map(function (m) { return [m.material, m.cantidad]; })) +
    '<h2>Tickets e indicaciones</h2>' +
    tabla_('Tickets del periodo', ['Fecha', 'Mensaje', 'Prioridad', 'Dirigido a', 'Estado'],
      r.hojas[1].filas.map(function (f) { return [f[0], f[5], f[6], f[4], f[7]]; }), 40) +
    '<h2>Trabajos saltados</h2>' +
    tabla_('Saltos autorizados con código', ['Fecha', 'Trabajo', 'Técnico', 'Motivo'],
      r.hojas[0].filas.filter(function (f) { return f[6] === 'Saltada' && String(f[12]).indexOf('No trasladada') !== 0; }).map(function (f) { return [f[0], f[3], f[7], f[12]]; }), 40) +
    '<h2>Equipos</h2>' +
    tabla_('Lecturas registradas por equipo', ['Equipo', 'Lecturas'], Object.keys(r.lecturasPorEquipo).map(function (k) { return [k, r.lecturasPorEquipo[k]]; })) +
    '<div class="pie">Generado el ' + e(r.generado) + ' por ' + e(usuario.nombre_completo || usuario.correo) +
    ' desde la Bitácora de Mantenimiento MM103. El detalle completo de cada registro está en el reporte de Excel del mismo periodo.</div>' +
    '</body></html>';

  var nombre = 'Reporte Mantenimiento MM103 ' + r.filtros.desde + ' a ' + r.filtros.hasta + '.pdf';
  var pdf = Utilities.newBlob(html, 'text/html', 'reporte.html').getAs('application/pdf').setName(nombre);
  var url = '';
  try { url = carpetaReportes_().createFile(pdf).getUrl(); } catch (err) { url = ''; }
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EXPORTAR_REPORTE_PDF', 'REPORTES', '', '', r.filtros.desde + ' a ' + r.filtros.hasta);
  return { ok: true, nombre: nombre, base64: Utilities.base64Encode(pdf.getBytes()), url: url };
}
