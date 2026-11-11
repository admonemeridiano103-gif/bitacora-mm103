function crearHojasBloque2(token) {
  var usuario = requierePermiso_(token, PERMISOS.CONFIGURAR_SISTEMA);
  var libro = ss_();
  var definiciones = [
    { nombre: HOJAS.CAT_TAREAS, encabezados: ['tarea_id', 'nombre_tarea', 'tipo', 'area_o_equipo_asociado', 'orden_cola', 'activo', 'requiere_pasos', 'notas'] },
    { nombre: HOJAS.CAT_PASOS, encabezados: ['paso_id', 'tarea_id', 'orden_paso', 'nombre_paso', 'descripcion'] },
    { nombre: HOJAS.CAT_MATERIALES, encabezados: ['relacion_id', 'tarea_id', 'paso_id', 'material_id', 'cantidad_predeterminada', 'unidad'] },
    { nombre: HOJAS.COLA, encabezados: ['registro_id', 'fecha', 'tarea_id', 'estado', 'usuario_asignado_actual', 'hora_inicio', 'hora_fin', 'tiempo_total_minutos', 'codigo_salto', 'codigo_salto_confirmado', 'descripcion_realizada'] },
    { nombre: HOJAS.EXTRA, encabezados: ['id', 'descripcion', 'origen', 'fecha_programada', 'hora_programada', 'prioridad', 'estado', 'usuario_asignado', 'materiales_usados', 'tiempo_total_minutos', 'notas'] }
  ];
  var creadas = [];
  definiciones.forEach(function (def) {
    if (libro.getSheetByName(def.nombre)) return;
    var sh = libro.insertSheet(def.nombre);
    sh.getRange(1, 1, 1, def.encabezados.length).setValues([def.encabezados]);
    sh.getRange(1, 1, 1, def.encabezados.length).setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    creadas.push(def.nombre);
  });
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'CREAR_HOJAS_BLOQUE2', 'SISTEMA', '', '', creadas.join(', ') || '(ninguna nueva, ya existían)');
  var mensaje = creadas.length
    ? 'Se crearon ' + creadas.length + ' hojas: ' + creadas.join(', ')
    : 'No se creó ninguna hoja nueva: todas ya existían.';
  try { SpreadsheetApp.getUi().alert(mensaje); } catch (err) { /* si se corre fuera del editor, no hay UI */ }
  return { ok: true, creadas: creadas };
}

// --- Catálogo de tareas ---

function generarIdTarea_() {
  var tabla = leerTabla_(HOJAS.CAT_TAREAS);
  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^TAR-(\d+)$/.exec(String(f.obj.tarea_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'TAR-' + ('000' + (max + 1)).slice(-3);
}

function siguienteOrdenCola_() {
  var tabla = leerTabla_(HOJAS.CAT_TAREAS);
  var max = 0;
  tabla.filas.forEach(function (f) { max = Math.max(max, Number(f.obj.orden_cola) || 0); });
  return max + 10;
}

function obtenerCatalogoTareas_() {
  var cache = CacheService.getScriptCache();
  var cacheado = cache.get('CAT_TAREAS_ALL');
  if (cacheado) return JSON.parse(cacheado);
  var filas = leerTabla_(HOJAS.CAT_TAREAS).filas.map(function (f) { return f.obj; });
  cache.put('CAT_TAREAS_ALL', JSON.stringify(filas), 600);
  return filas;
}

function obtenerCatalogoPasos_() {
  var cache = CacheService.getScriptCache();
  var cacheado = cache.get('CAT_PASOS_ALL');
  if (cacheado) return JSON.parse(cacheado);
  var filas = leerTabla_(HOJAS.CAT_PASOS).filas.map(function (f) { return f.obj; });
  cache.put('CAT_PASOS_ALL', JSON.stringify(filas), 600);
  return filas;
}

function obtenerCatalogoMateriales_() {
  var cache = CacheService.getScriptCache();
  var cacheado = cache.get('CAT_MATERIALES_ALL');
  if (cacheado) return JSON.parse(cacheado);
  var filas = leerTabla_(HOJAS.CAT_MATERIALES).filas.map(function (f) { return f.obj; });
  cache.put('CAT_MATERIALES_ALL', JSON.stringify(filas), 600);
  return filas;
}

function invalidarCacheCatalogoTareas_() { CacheService.getScriptCache().remove('CAT_TAREAS_ALL'); }
function invalidarCacheCatalogoPasos_() { CacheService.getScriptCache().remove('CAT_PASOS_ALL'); }
function invalidarCacheCatalogoMateriales_() { CacheService.getScriptCache().remove('CAT_MATERIALES_ALL'); }

function listarCatalogoTareas(token) {
  var usuario = requiereSesion_(token);
  return obtenerCatalogoTareas_()
    .sort(function (a, b) { return (Number(a.orden_cola) || 0) - (Number(b.orden_cola) || 0); });
}

function listarPasosDeTarea_(tareaId) {
  return obtenerCatalogoPasos_()
    .filter(function (p) { return p.tarea_id === tareaId; })
    .sort(function (a, b) { return (Number(a.orden_paso) || 0) - (Number(b.orden_paso) || 0); });
}

function listarMaterialesDeTarea_(tareaId) {
  return obtenerCatalogoMateriales_().filter(function (m) { return m.tarea_id === tareaId; });
}

function obtenerTareaDetalle(token, tareaId) {
  var usuario = requiereSesion_(token);
  var tarea = obtenerCatalogoTareas_().find(function (t) { return t.tarea_id === tareaId; });
  if (!tarea) throw new Error('No existe la tarea "' + tareaId + '".');
  var materiales = listarMaterialesDeTarea_(tareaId);
  var catalogoAlmacen = {};
  leerTabla_('ALMACEN_CATALOGO_MATERIALES').filas.forEach(function (f) { catalogoAlmacen[f.obj.material_id] = f.obj; });
  materiales.forEach(function (m) {
    var info = catalogoAlmacen[m.material_id];
    m.nombre_material = info ? info.nombre : '(material eliminado)';
    m.stock_actual = info ? info.stock_actual : '';
  });
  return {
    tarea: tarea,
    pasos: listarPasosDeTarea_(tareaId),
    materiales: materiales
  };
}

/** datos: { tarea_id? (si se edita), nombre_tarea, tipo, area_o_equipo_asociado, orden_cola, activo, requiere_pasos, notas } */
function guardarTarea(token, datos) {
  invalidarColaDelDia_();
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  var nombre = String(datos && datos.nombre_tarea || '').trim();
  if (!nombre) throw new Error('Falta el nombre de la tarea.');

  if (datos.tarea_id) {
    var encontrado = buscarFilaPorValor_(HOJAS.CAT_TAREAS, 'tarea_id', datos.tarea_id, false);
    if (!encontrado) throw new Error('No existe la tarea "' + datos.tarea_id + '".');
    asegurarColumna_(HOJAS.CAT_TAREAS, 'equipos_checklist');
    encontrado = buscarFilaPorValor_(HOJAS.CAT_TAREAS, 'tarea_id', datos.tarea_id, false);
    var CAMPOS = ['nombre_tarea', 'tipo', 'area_o_equipo_asociado', 'orden_cola', 'activo', 'requiere_pasos', 'notas', 'equipos_checklist'];
    var camposAEscribir = {};
    CAMPOS.forEach(function (c) {
      if (datos[c] !== undefined) camposAEscribir[c] = datos[c];
    });
    escribirCamposFila_(encontrado, camposAEscribir);
    invalidarCacheCatalogoTareas_();
    registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EDITAR_TAREA', HOJAS.CAT_TAREAS, datos.tarea_id, '', JSON.stringify(datos));
    return { ok: true, tarea_id: datos.tarea_id };
  }

  var sh = hoja_(HOJAS.CAT_TAREAS);
  var encabezados = encabezados_(sh);
  var nuevo = {
    tarea_id: generarIdTarea_(),
    nombre_tarea: nombre,
    tipo: datos.tipo || '',
    area_o_equipo_asociado: datos.area_o_equipo_asociado || '',
    orden_cola: datos.orden_cola || siguienteOrdenCola_(),
    activo: datos.activo === undefined ? true : !!datos.activo,
    requiere_pasos: !!datos.requiere_pasos,
    notas: datos.notas || '',
    equipos_checklist: datos.equipos_checklist || ''
  };
  asegurarColumna_(HOJAS.CAT_TAREAS, 'equipos_checklist');
  encabezados = encabezados_(sh);
  sh.appendRow(objetoAFila_(encabezados, nuevo));
  invalidarCacheCatalogoTareas_();
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'ALTA_TAREA', HOJAS.CAT_TAREAS, nuevo.tarea_id, '', nombre);
  return nuevo;
}

function cambiarActivoTarea(token, tareaId, activo) {
  invalidarColaDelDia_();
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  var encontrado = buscarFilaPorValor_(HOJAS.CAT_TAREAS, 'tarea_id', tareaId, false);
  if (!encontrado) throw new Error('No existe la tarea "' + tareaId + '".');
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'activo', !!activo);
  invalidarCacheCatalogoTareas_();
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'CAMBIAR_ACTIVO_TAREA', HOJAS.CAT_TAREAS, tareaId, '', String(!!activo));
  return { ok: true };
}

// --- Pasos de tarea ---

function generarIdPaso_() {
  var tabla = leerTabla_(HOJAS.CAT_PASOS);
  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^PASO-(\d+)$/.exec(String(f.obj.paso_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'PASO-' + ('0000' + (max + 1)).slice(-4);
}

/** datos: { paso_id?, tarea_id, orden_paso, nombre_paso, descripcion } */
function guardarPaso(token, datos) {
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  if (!datos || !datos.tarea_id) throw new Error('Falta la tarea a la que pertenece el paso.');
  if (!String(datos.nombre_paso || '').trim()) throw new Error('Falta el nombre del paso.');

  if (datos.paso_id) {
    var encontrado = buscarFilaPorValor_(HOJAS.CAT_PASOS, 'paso_id', datos.paso_id, false);
    if (!encontrado) throw new Error('No existe el paso "' + datos.paso_id + '".');
    var camposPaso = {};
    ['orden_paso', 'nombre_paso', 'descripcion'].forEach(function (c) {
      if (datos[c] !== undefined) camposPaso[c] = datos[c];
    });
    escribirCamposFila_(encontrado, camposPaso);
    invalidarCacheCatalogoPasos_();
    return { ok: true, paso_id: datos.paso_id };
  }

  var sh = hoja_(HOJAS.CAT_PASOS);
  var encabezados = encabezados_(sh);
  var pasosExistentes = listarPasosDeTarea_(datos.tarea_id);
  var nuevo = {
    paso_id: generarIdPaso_(),
    tarea_id: datos.tarea_id,
    orden_paso: datos.orden_paso || (pasosExistentes.length + 1),
    nombre_paso: datos.nombre_paso,
    descripcion: datos.descripcion || ''
  };
  sh.appendRow(objetoAFila_(encabezados, nuevo));
  invalidarCacheCatalogoPasos_();
  return nuevo;
}

function eliminarPaso(token, pasoId) {
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  var encontrado = buscarFilaPorValor_(HOJAS.CAT_PASOS, 'paso_id', pasoId, false);
  if (!encontrado) throw new Error('No existe el paso "' + pasoId + '".');
  encontrado.tabla.sh.deleteRow(encontrado.fila.indiceFila);
  invalidarCacheCatalogoPasos_();
  return { ok: true };
}

// --- Materiales por tarea ---

function generarIdMaterialRelacion_() {
  var tabla = leerTabla_(HOJAS.CAT_MATERIALES);
  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^MAT-(\d+)$/.exec(String(f.obj.relacion_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'MAT-' + ('0000' + (max + 1)).slice(-4);
}

/** datos: { relacion_id?, tarea_id, paso_id, material_id, cantidad_predeterminada, unidad } */
function guardarMaterialTarea(token, datos) {
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  if (!datos || !datos.tarea_id) throw new Error('Falta la tarea.');
  if (!String(datos.material_id || '').trim()) throw new Error('Falta el nombre o clave del material.');

  if (datos.relacion_id) {
    var encontrado = buscarFilaPorValor_(HOJAS.CAT_MATERIALES, 'relacion_id', datos.relacion_id, false);
    if (!encontrado) throw new Error('No existe la relación "' + datos.relacion_id + '".');
    var camposMaterial = {};
    ['paso_id', 'material_id', 'cantidad_predeterminada', 'unidad'].forEach(function (c) {
      if (datos[c] !== undefined) camposMaterial[c] = datos[c];
    });
    escribirCamposFila_(encontrado, camposMaterial);
    invalidarCacheCatalogoMateriales_();
    return { ok: true, relacion_id: datos.relacion_id };
  }

  var sh = hoja_(HOJAS.CAT_MATERIALES);
  var encabezados = encabezados_(sh);
  var nuevo = {
    relacion_id: generarIdMaterialRelacion_(),
    tarea_id: datos.tarea_id,
    paso_id: datos.paso_id || '',
    material_id: datos.material_id,
    cantidad_predeterminada: datos.cantidad_predeterminada || '',
    unidad: datos.unidad || ''
  };
  sh.appendRow(objetoAFila_(encabezados, nuevo));
  invalidarCacheCatalogoMateriales_();
  return nuevo;
}

function eliminarMaterialTarea(token, relacionId) {
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  var encontrado = buscarFilaPorValor_(HOJAS.CAT_MATERIALES, 'relacion_id', relacionId, false);
  if (!encontrado) throw new Error('No existe la relación "' + relacionId + '".');
  encontrado.tabla.sh.deleteRow(encontrado.fila.indiceFila);
  invalidarCacheCatalogoMateriales_();
  return { ok: true };
}

// --- Trabajos extra programados ---

function generarIdExtra_() {
  var tabla = leerTabla_(HOJAS.EXTRA);
  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^EXT-(\d+)$/.exec(String(f.obj.id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'EXT-' + ('0000' + (max + 1)).slice(-4);
}

function listarTrabajosExtra(token) {
  var usuario = requiereSesion_(token);
  return leerTabla_(HOJAS.EXTRA).filas.map(function (f) { return f.obj; })
    .sort(function (a, b) { return String(b.fecha_programada || '').localeCompare(String(a.fecha_programada || '')); });
}

/** datos: { id?, descripcion, origen, fecha_programada, hora_programada, prioridad, usuario_asignado } */
function guardarTrabajoExtra(token, datos) {
  ['tipo_trabajo', 'equipos_checklist', 'equipos_en_cola'].forEach(function (c) { asegurarColumna_(HOJAS.EXTRA, c); });
  invalidarColaDelDia_();
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  if (!String(datos && datos.descripcion || '').trim()) throw new Error('Falta la descripción del trabajo programado.');
  validarTipoTrabajoExtra_(datos);

  if (datos.id) {
    var encontrado = buscarFilaPorValor_(HOJAS.EXTRA, 'id', datos.id, false);
    if (!encontrado) throw new Error('No existe el trabajo programado "' + datos.id + '".');
    var CAMPOS = ['descripcion', 'origen', 'fecha_programada', 'hora_programada', 'prioridad', 'usuario_asignado', 'tipo_trabajo', 'equipos_checklist'];
    CAMPOS.forEach(function (c) {
      if (datos[c] !== undefined) setCell_(encontrado.tabla, encontrado.fila.indiceFila, c, datos[c]);
    });
    registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EDITAR_TRABAJO_EXTRA', HOJAS.EXTRA, datos.id, '', JSON.stringify(datos));
    return { ok: true, id: datos.id };
  }

  var sh = hoja_(HOJAS.EXTRA);
  var encabezados = encabezados_(sh);
  var nuevo = {
    id: generarIdExtra_(),
    descripcion: datos.descripcion,
    origen: datos.origen || 'Manual',
    fecha_programada: datos.fecha_programada || '',
    hora_programada: datos.hora_programada || '',
    prioridad: datos.prioridad || 'Normal',
    estado: 'Pendiente',
    usuario_asignado: datos.usuario_asignado || '',
    materiales_usados: '',
    tiempo_total_minutos: '',
    notas: '',
    tipo_trabajo: datos.tipo_trabajo || '',
    equipos_checklist: datos.equipos_checklist || ''
  };
  sh.appendRow(objetoAFila_(encabezados, nuevo));
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'ALTA_TRABAJO_EXTRA', HOJAS.EXTRA, nuevo.id, '', nuevo.descripcion);
  return nuevo;
}

function cambiarEstadoTrabajoExtra(token, id, nuevoEstado, notas) {
  invalidarColaDelDia_();
  var usuario = requiereSesion_(token);
  if (!usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS) && !usuarioTienePermiso_(usuario, PERMISOS.EJECUTAR_TAREAS_COLA)) {
    throw new Error('No tienes permiso para actualizar trabajos programados.');
  }
  if (ESTADOS_TRABAJO_EXTRA.indexOf(nuevoEstado) === -1) {
    throw new Error('Estado inválido. Usa: ' + ESTADOS_TRABAJO_EXTRA.join(', '));
  }
  var encontrado = buscarFilaPorValor_(HOJAS.EXTRA, 'id', id, false);
  if (!encontrado) throw new Error('No existe el trabajo programado "' + id + '".');
  var anterior = encontrado.fila.obj.estado;
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'estado', nuevoEstado);
  if (notas !== undefined) setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'notas', notas);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'CAMBIAR_ESTADO_TRABAJO_EXTRA', HOJAS.EXTRA, id, anterior, nuevoEstado);
  return { ok: true };
}

// ----------------------------------------------------------------------------
// BLOQUE 2 — COLA DE TRABAJO DIARIO
// ----------------------------------------------------------------------------

/** Genera, si todavía no existen, los renglones de la cola del día a partir del catálogo activo. */
function tareaAplicaHoy_(t, fecha) {
  var periodo = Number(t.periodicidad_dias) || 0;
  if (periodo <= 1) return true; // tarea diaria (comportamiento de siempre)
  var refStr = t.fecha_referencia ? soloFecha_(t.fecha_referencia) : '2026-01-05';
  var refPartes = refStr.split('-').map(Number);
  var hoyPartes = fecha.split('-').map(Number);
  var refDate = new Date(refPartes[0], refPartes[1] - 1, refPartes[2]);
  var hoyDate = new Date(hoyPartes[0], hoyPartes[1] - 1, hoyPartes[2]);
  var dias = Math.round((hoyDate - refDate) / 86400000);
  return dias >= 0 && (dias % periodo === 0);
}

function proximasRevisionesProgramadas(token) {
  requiereSesion_(token);
  var hoy = fechaHoy_();
  var hoyPartes = hoy.split('-').map(Number);
  var hoyDate = new Date(hoyPartes[0], hoyPartes[1] - 1, hoyPartes[2]);
  var resultado = [];
  leerTabla_(HOJAS.CAT_TAREAS).filas.forEach(function (f) {
    var t = f.obj;
    if (!(t.activo === true || t.activo === 'TRUE')) return;
    var periodo = Number(t.periodicidad_dias) || 0;
    if (periodo <= 1) return;
    for (var i = 0; i < periodo; i++) {
      var fechaPrueba = new Date(hoyDate.getTime() + i * 86400000);
      var fechaStr = Utilities.formatDate(fechaPrueba, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      if (tareaAplicaHoy_(t, fechaStr)) {
        if (i <= 2) resultado.push({ tarea_id: t.tarea_id, nombre_tarea: t.nombre_tarea, en_dias: i, fecha: fechaStr });
        break;
      }
    }
  });
  return resultado;
}


function asegurarColaDelDia_(fecha) {
  // La cola del día se arma una sola vez: el resultado se recuerda 6 horas en caché para no
  // volver a leer todas las hojas en cada clic. Se invalida al cambiar el catálogo o los trabajos programados.
  var cacheCola = CacheService.getScriptCache();
  var claveCola = 'COLA_OK_' + fecha;
  try { if (cacheCola.get(claveCola)) return; } catch (e) { }
  asegurarColaDelDiaSinCache_(fecha);
  try { cacheCola.put(claveCola, '1', 21600); } catch (e) { }
}

/** Obliga a que la siguiente consulta vuelva a revisar la cola de hoy (catálogo o extras cambiaron). */
function invalidarColaDelDia_() {
  try { CacheService.getScriptCache().remove('COLA_OK_' + fechaHoy_()); } catch (e) { }
}

function asegurarColaDelDiaSinCache_(fecha) {
  var tabla = leerTabla_(HOJAS.COLA);
  var idsDeHoy = {};
  tabla.filas.forEach(function (f) {
    if (soloFecha_(f.obj.fecha) === fecha) idsDeHoy[f.obj.tarea_id] = true;
  });

  var tareas = leerTabla_(HOJAS.CAT_TAREAS).filas.map(function (f) { return f.obj; })
    .filter(function (t) { return (t.activo === true || t.activo === 'TRUE') && !idsDeHoy[t.tarea_id]; })
    .filter(function (t) { return tareaAplicaHoy_(t, fecha); })
    .sort(function (a, b) { return (Number(a.orden_cola) || 0) - (Number(b.orden_cola) || 0); });

  asegurarColumna_(HOJAS.COLA, 'tipo_origen');
  asegurarColumna_(HOJAS.COLA, 'origen_id');
  asegurarColumna_(HOJAS.COLA, 'tiempo_acumulado_segundos');

  if (!tareas.length) { agregarModulosDelDiaACola_(fecha); return; }

  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^COLA-(\d+)$/.exec(String(f.obj.registro_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });

  var sh = hoja_(HOJAS.COLA);
  var encabezados = encabezados_(sh);
  var filasNuevas = tareas.map(function (t) {
    max += 1;
    return objetoAFila_(encabezados, {
      registro_id: 'COLA-' + ('00000' + max).slice(-5),
      fecha: fecha,
      tarea_id: t.tarea_id,
      estado: 'Pendiente',
      usuario_asignado_actual: '',
      hora_inicio: '',
      hora_fin: '',
      tiempo_total_minutos: '',
      codigo_salto: '',
      codigo_salto_confirmado: false,
      descripcion_realizada: '',
      tipo_origen: 'Catalogo',
      origen_id: '',
      tiempo_acumulado_segundos: 0
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, filasNuevas.length, encabezados.length).setValues(filasNuevas);

  agregarModulosDelDiaACola_(fecha);
}


function listarColaDelDia(token, fecha, incluirOcultos) {
  var usuario = requiereSesion_(token);
  var tienePermiso = usuarioTienePermiso_(usuario, PERMISOS.EJECUTAR_TAREAS_COLA) ||
    usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS) ||
    usuarioTienePermiso_(usuario, PERMISOS.GENERAR_CODIGO_SALTO);
  if (!tienePermiso) throw new Error('Tu perfil no tiene acceso a la cola de trabajo diario.');

  fecha = fecha || fechaHoy_();
  if (fecha === fechaHoy_()) { asegurarColaDelDia_(fecha); cerrarGasSiSinPendientes_(fecha); }
  // "Ver terminados y ocultos" (Fase 4): solo para quien puede volver a abrir trabajos.
  var verOcultos = !!incluirOcultos && (usuarioTienePermiso_(usuario, PERMISOS.ENVIAR_TICKET) || usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS));
  return construirColaDelDia_(fecha, { incluirOcultos: verOcultos });
}

/**
 * Fase 4 — Decide si un renglón de la cola se oculta y por qué ('' = se muestra). No borra ni cambia filas.
 * - Nunca se oculta lo que está En proceso o Pausado (alguien lo tiene en las manos).
 * - Extra: renglón Completada, o trabajo programado Completado/Cancelado.
 * - Ticket: renglón Completada, o ticket Atendido/Cancelado.
 * - Catálogo: tarea desactivada, solo para renglones con fecha >= fechaDesde (por defecto, hoy).
 * - Gas: nunca.
 * Al reabrir (Reapertura.js) el renglón vuelve a Pendiente y su origen a Pendiente/Abierto, así que reaparece.
 */
function motivoOcultoEnCola_(o, mapas, fechaDesde) {
  if (!o || o.estado === 'En proceso' || o.estado === 'Pausado') return '';
  var tipo = o.tipo_origen || 'Catalogo';
  if (tipo === 'Gas') return '';
  if (tipo === 'Extra') {
    if (o.estado === 'Completada') return 'Trabajo programado completado';
    var e = (mapas.extras || {})[o.origen_id];
    if (e && (e.estado === 'Completado' || e.estado === 'Cancelado')) return 'Trabajo programado ' + String(e.estado).toLowerCase();
    return '';
  }
  if (tipo === 'Ticket') {
    if (o.estado === 'Completada') return 'Ticket completado';
    var tk = (mapas.tickets || {})[o.origen_id];
    if (tk && (tk.estado === 'Atendido' || tk.estado === 'Cancelado')) return 'Ticket ' + String(tk.estado).toLowerCase();
    return '';
  }
  var t = (mapas.catalogo || {})[o.tarea_id];
  if (t && !(t.activo === true || t.activo === 'TRUE') && soloFecha_(o.fecha) >= (fechaDesde || fechaHoy_())) return 'Tarea desactivada en el catálogo';
  return '';
}

/**
 * Arma la lista de la cola de un día, ya ordenada como la verá el técnico.
 * Si la cola fue reordenada a mano (posicion_manual), ese orden manda; lo que se agregue
 * después sin posición (por ejemplo un ticket nuevo) queda al final de la lista.
 */
function construirColaDelDia_(fecha, opciones) {
  var incluirOcultos = !!(opciones && opciones.incluirOcultos);
  var hoy = fechaHoy_();
  var mapas = mapasOrdenCola_();
  var catalogo = mapas.catalogo;
  var tickets = mapas.tickets;
  var extras = mapas.extras;
  var equiposCat = [];
  try { equiposCat = obtenerCatalogoEquipos_(); } catch (e) { equiposCat = []; }

  var filas = leerTabla_(HOJAS.COLA).filas.map(function (f) { return f.obj; })
    .filter(function (o) { return soloFecha_(o.fecha) === fecha; })
    .map(function (o, indiceOriginal) {
      var tipoOrigen = o.tipo_origen || 'Catalogo';
      var codigoConfirmado = o.codigo_salto_confirmado === true || o.codigo_salto_confirmado === 'TRUE';
      var base = {
        registro_id: o.registro_id,
        fecha: o.fecha,
        estado: o.estado,
        usuario_asignado_actual: o.usuario_asignado_actual,
        hora_inicio: o.hora_inicio,
        hora_fin: o.hora_fin,
        tiempo_total_minutos: o.tiempo_total_minutos,
        tiempo_acumulado_segundos: Number(o.tiempo_acumulado_segundos) || 0,
        codigo_salto_confirmado: codigoConfirmado,
        tiene_codigo_pendiente: !!o.codigo_salto && !codigoConfirmado,
        motivo_salto: o.motivo_salto || '',
        descripcion_realizada: o.descripcion_realizada,
        tarea_id: o.tarea_id,
        tipo_origen: tipoOrigen,
        origen_id: o.origen_id || '',
        motivo_pausa: o.motivo_pausa || '',
        pausado_por: o.pausado_por || '',
        pausado_en: o.pausado_en || ''
      };
      if (tipoOrigen === 'Gas') {
      base.bloqueo_estricto = false;
      base.nombre_tarea = 'Cierre/Apertura de gas';
      base.tipo = 'Gas';
      base.es_gas = true;
      base.area_o_equipo_asociado = 'Gas';
      base.requiere_pasos = false;
      base.prioridad = '';
      base.equipos_checklist = [];
    } else if (tipoOrigen === 'Extra') {
        var e = extras[o.origen_id] || {};
        base.bloqueo_estricto = false;
        base.nombre_tarea = e.descripcion || '(trabajo programado eliminado)';
        base.tipo = 'Extra';
      base.equipos_checklist = e.tipo_trabajo === 'Checklist' ? String(e.equipos_en_cola || e.equipos_checklist || '').split(',').map(function (x) { return x.trim(); }).filter(String) : [];
        base.area_o_equipo_asociado = '';
        base.requiere_pasos = false;
        base.prioridad = e.prioridad || '';
      } else if (tipoOrigen === 'Ticket') {
        var tk = tickets[o.origen_id] || {};
        base.bloqueo_estricto = false;
        base.nombre_tarea = tk.mensaje || '(ticket eliminado)';
        base.tipo = 'Ticket';
        base.area_o_equipo_asociado = '';
        base.requiere_pasos = false;
        base.prioridad = tk.prioridad || 'Media';
        base.fotos_antes = String(tk.fotos_antes_urls || '').split('\n').map(function (x) { return x.trim(); }).filter(String);
        base.orden_manual = valorPosicionManual_(o.orden_manual);
      } else {
        var t = catalogo[o.tarea_id] || {};
        base.bloqueo_estricto = !!(t.bloqueo_estricto === true || t.bloqueo_estricto === 'TRUE');
        base.nombre_tarea = t.nombre_tarea || '(tarea eliminada)';
        base.tipo = t.tipo || '';
        base.area_o_equipo_asociado = t.area_o_equipo_asociado || '';
        base.equipos_checklist = equiposDeTarea_(t, equiposCat);
        base.requiere_pasos = !!t.requiere_pasos;
        base.prioridad = '';
      }
      base.rollover_desde = o.rollover_desde || '';
      base.motivo_reapertura = o.motivo_reapertura || '';
      base.fotos_reapertura = String(o.fotos_reapertura_urls || '').split('\n').map(function (x) { return x.trim(); }).filter(String);
      base.reabierto_veces = parseInt(o.reabierto_veces, 10) || 0;
      base.reabierto_por = o.reabierto_por || '';
      base.posicion_manual = valorPosicionManual_(o.posicion_manual);
      base.oculto_motivo = motivoOcultoEnCola_(o, mapas, hoy);
      // Un ticket atendido o completado hoy sigue a la vista (con "Volver a abrir") hasta el cierre de jornada, cuando pasa al historial.
      base.ticket_terminado = false;
      if (tipoOrigen === 'Ticket' && base.oculto_motivo && !/cancelad/i.test(base.oculto_motivo) && !o.archivado_en && fecha === hoy) {
        base.ticket_terminado = true;
        base.oculto_motivo = '';
      }
      base.orden_efectivo = claveOrdenCola_(o, catalogo, tickets) + (base.ticket_terminado ? 100000 : 0); // al final de la lista
      base.orden_cola = base.orden_efectivo;
      base._indice = indiceOriginal;
      return base;
    });
  if (!incluirOcultos) filas = filas.filter(function (f) { return !f.oculto_motivo; });
  filas.sort(function (a, b) { return (a.orden_efectivo - b.orden_efectivo) || (a._indice - b._indice); });
  filas.forEach(function (f, i) { f.posicion = i + 1; delete f._indice; });
  return filas;
}

/** Devuelve la posición manual guardada en la cola (número) o null si no tiene. */
function valorPosicionManual_(v) {
  if (v === '' || v === undefined || v === null) return null;
  var n = Number(v);
  return isNaN(n) ? null : n;
}

// ============================================================================
// ORDEN DE LA COLA Y TOMA DE TRABAJOS
// Orden: 1) tickets urgentes (prioridad Alta), 2) trabajos diarios del catálogo,
// 3) trabajos extra, 4) tickets Media y 5) tickets Baja. Lo acarreado del día
// anterior va primero dentro de su grupo. Si la administración acomodó la cola a
// mano (posicion_manual), se respeta ese orden; lo nuevo urgente entra arriba y lo
// demás nuevo entra al final.
// Cualquier técnico puede tomar cualquier trabajo pendiente que no esté dirigido a
// otra persona, o continuar cualquier trabajo pausado. Si ya tiene uno en proceso,
// ese se pausa (con motivo) en el mismo paso.
// ============================================================================

var BANDAS_COLA_ = { Alta: -100000, Catalogo: 100000, Extra: 150000, Media: 200000, Baja: 300000 };

function claveOrdenCola_(o, catalogo, tickets) {
  var manual = valorPosicionManual_(o.posicion_manual);
  if (manual !== null) return manual;
  var tipo = o.tipo_origen || 'Catalogo';
  var banda, dentro = 0;
  if (tipo === 'Ticket') {
    var tk = tickets[o.origen_id] || {};
    var p = tk.prioridad === 'Alta' || tk.prioridad === 'Baja' ? tk.prioridad : 'Media';
    banda = BANDAS_COLA_[p];
    var om = valorPosicionManual_(o.orden_manual);
    if (om !== null) dentro = om / 1000;
  } else if (tipo === 'Extra') {
    banda = BANDAS_COLA_.Extra;
  } else if (tipo === 'Gas') {
    banda = BANDAS_COLA_.Catalogo;
    dentro = 100;
  } else {
    banda = BANDAS_COLA_.Catalogo;
    dentro = Number((catalogo[o.tarea_id] || {}).orden_cola) || 0;
  }
  if (o.rollover_desde) dentro -= 40000;
  return banda + dentro;
}

function mapasOrdenCola_() {
  var catalogo = {};
  leerTabla_(HOJAS.CAT_TAREAS).filas.forEach(function (f) { catalogo[f.obj.tarea_id] = f.obj; });
  var tickets = {};
  leerTabla_('TICKETS_INDICACIONES').filas.forEach(function (f) { tickets[f.obj.ticket_id] = f.obj; });
  var extras = {};
  leerTabla_(HOJAS.EXTRA).filas.forEach(function (f) { extras[f.obj.id] = f.obj; });
  return { catalogo: catalogo, tickets: tickets, extras: extras };
}

/** Crea una sola vez las columnas que usa la pausa (se recuerda en las propiedades del script). */
function asegurarColumnasPausa_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('COLUMNAS_PAUSA_OK') === 'true') return;
  ['tiempo_acumulado_segundos', 'motivo_pausa', 'pausado_por', 'pausado_en'].forEach(function (c) { asegurarColumna_(HOJAS.COLA, c); });
  props.setProperty('COLUMNAS_PAUSA_OK', 'true');
}

/** Pausa una fila "En proceso": guarda el tiempo trabajado, el motivo y quién la pausó. */
function pausarFilaCola_(encontrado, usuario, motivo) {
  var o = encontrado.fila.obj;
  var ahora = new Date();
  var inicio = o.hora_inicio ? new Date(o.hora_inicio) : null;
  var segundos = (inicio && !isNaN(inicio.getTime())) ? Math.max(0, Math.round((ahora - inicio) / 1000)) : 0;
  var acumulado = (Number(o.tiempo_acumulado_segundos) || 0) + segundos;
  escribirCamposFila_(encontrado, {
    estado: 'Pausado',
    hora_inicio: '',
    tiempo_acumulado_segundos: acumulado,
    motivo_pausa: motivo,
    pausado_por: usuario.id_usuario,
    pausado_en: ahora
  });
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'PAUSAR_TAREA', HOJAS.COLA, o.registro_id,
    'En proceso', 'Pausado — motivo: ' + motivo + ' — trabajado: ' + Math.round(acumulado / 60) + ' min');
}

/**
 * Toma un trabajo de la cola de hoy.
 * - registroId vacío: toma el primero disponible según el orden de la cola.
 * - registroId de un trabajo Pendiente (libre o dirigido a mí) o Pausado (de cualquiera).
 * Si el técnico ya tiene otro trabajo en proceso, se necesita motivoPausa para pausarlo;
 * sin motivo responde { ok:false, necesitaMotivo:true, actual } para que la app lo pregunte.
 */
function tomarTarea(token, registroId, motivoPausa) {
  var usuario = requierePermiso_(token, PERMISOS.EJECUTAR_TAREAS_COLA);
  var fecha = fechaHoy_();
  asegurarColumnasPausa_();
  var candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    asegurarColaDelDia_(fecha);
    var tabla = leerTabla_(HOJAS.COLA);
    var deHoy = tabla.filas.filter(function (f) { return soloFecha_(f.obj.fecha) === fecha; });
    var miId = usuario.id_usuario;
    var actual = deHoy.filter(function (f) { return f.obj.estado === 'En proceso' && f.obj.usuario_asignado_actual === miId; })[0] || null;
    var mapas = null;
    var elegido = null;

    if (registroId) {
      elegido = deHoy.filter(function (f) { return f.obj.registro_id === registroId; })[0] || null;
      if (!elegido) return { ok: false, mensaje: 'Ese trabajo ya no está en la cola de hoy. Actualiza la cola.' };
      var o = elegido.obj;
      if (actual && actual.obj.registro_id === registroId) return { ok: false, mensaje: 'Ese trabajo ya lo tienes en proceso.' };
      if (o.estado === 'Pendiente') {
        if (o.usuario_asignado_actual && o.usuario_asignado_actual !== miId) return { ok: false, mensaje: 'Ese trabajo está dirigido a otra persona.' };
        var motivoOculto = motivoOcultoEnCola_(o, mapasOrdenCola_(), fecha);
        if (motivoOculto) return { ok: false, mensaje: 'Ese trabajo ya no está en la cola (' + motivoOculto + '). Actualiza la cola.' };
      } else if (o.estado !== 'Pausado') {
        return { ok: false, mensaje: 'Ese trabajo ya no está disponible (está "' + o.estado + '"). Actualiza la cola.' };
      }
    } else {
      mapas = mapasOrdenCola_();
      var candidatos = deHoy.filter(function (f) {
        return f.obj.estado === 'Pendiente' && (!f.obj.usuario_asignado_actual || f.obj.usuario_asignado_actual === miId) &&
          !motivoOcultoEnCola_(f.obj, mapas, fecha);
      });
      candidatos.sort(function (a, b) {
        return (claveOrdenCola_(a.obj, mapas.catalogo, mapas.tickets) - claveOrdenCola_(b.obj, mapas.catalogo, mapas.tickets)) || (a.indiceFila - b.indiceFila);
      });
      if (!candidatos.length) return { ok: false, mensaje: 'No hay trabajos pendientes en la cola de hoy.' };
      elegido = candidatos[0];
    }

    if (actual) {
      motivoPausa = String(motivoPausa || '').trim();
      if (!motivoPausa) return { ok: false, necesitaMotivo: true, actual: actual.obj.registro_id };
      pausarFilaCola_({ tabla: tabla, fila: actual }, usuario, motivoPausa);
    }

    var anterior = elegido.obj.estado;
    var pausadoPor = elegido.obj.pausado_por || '';
    escribirCamposFila_({ tabla: tabla, fila: elegido }, {
      estado: 'En proceso',
      usuario_asignado_actual: miId,
      hora_inicio: new Date()
    });
    registrarAuditoria_(miId, usuario.correo, anterior === 'Pausado' ? 'REANUDAR_TAREA' : 'TOMAR_TAREA_COLA', HOJAS.COLA, elegido.obj.registro_id,
      anterior + (anterior === 'Pausado' && pausadoPor ? ' (pausado por ' + pausadoPor + ')' : ''), 'En proceso (' + miId + ')');
    if ((elegido.obj.tipo_origen || '') === 'Ticket') { try { asignarTicketAbiertoSiAplica_(elegido.obj.origen_id, usuario); } catch (e) { } }

    var cola = construirColaDelDia_(fecha);
    var fila = cola.filter(function (x) { return x.registro_id === elegido.obj.registro_id; })[0];
    return {
      ok: true,
      cola: cola,
      registro_id: elegido.obj.registro_id,
      reanudado: anterior === 'Pausado',
      pausado: actual ? actual.obj.registro_id : '',
      tarea: { nombre_tarea: fila ? fila.nombre_tarea : elegido.obj.registro_id }
    };
  } finally {
    candado.releaseLock();
  }
}

/** Compatibilidad: toma el siguiente trabajo de la cola. */
function tomarSiguienteTarea(token, motivoPausa) {
  return tomarTarea(token, '', motivoPausa);
}

/** Compatibilidad: continuar un trabajo pausado. */
function reanudarTareaPausada(token, registroId, motivoPausa) {
  return tomarTarea(token, registroId, motivoPausa);
}

function pausarTareaManual(token, registroId, motivo) {
  var usuario = requierePermiso_(token, PERMISOS.EJECUTAR_TAREAS_COLA);
  motivo = String(motivo || '').trim();
  if (!motivo) throw new Error('Escribe por qué pausas el trabajo.');
  asegurarColumnasPausa_();
  var candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    var enc = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
    if (!enc) throw new Error('No existe el registro de cola "' + registroId + '".');
    if (enc.fila.obj.estado !== 'En proceso') throw new Error('Solo se puede pausar un trabajo que esté en proceso (este está "' + enc.fila.obj.estado + '").');
    if (enc.fila.obj.usuario_asignado_actual !== usuario.id_usuario) throw new Error('Solo quien tiene el trabajo en proceso puede pausarlo.');
    pausarFilaCola_(enc, usuario, motivo);
    return { ok: true, cola: construirColaDelDia_(fechaHoy_()) };
  } finally {
    candado.releaseLock();
  }
}


/** Carpeta de Drive donde se guardan las fotos de evidencia al completar tareas de la cola (se crea una vez y se reutiliza). */
function carpetaFotosEvidenciaTareas_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CARPETA_FOTOS_EVIDENCIA_TAREAS_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* la carpeta ya no existe: se recrea abajo */ }
  }
  var carpeta = DriveApp.createFolder('MM103 - Evidencia de Tareas');
  props.setProperty('CARPETA_FOTOS_EVIDENCIA_TAREAS_ID', carpeta.getId());
  return carpeta;
}

/** Crea la hoja EVIDENCIAS_FOTOS si todavía no existe (normalmente la crea crearHojasFuturas, pero esto la asegura). */
function asegurarHojaEvidencias_() {
  var libro = ss_();
  var sh = libro.getSheetByName('EVIDENCIAS_FOTOS');
  if (!sh) {
    sh = libro.insertSheet('EVIDENCIAS_FOTOS');
    var encabezados = ['evidencia_id', 'fecha_hora', 'usuario_id', 'tipo', 'entidad_relacionada_id', 'url_drive'];
    sh.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
    sh.getRange(1, 1, 1, encabezados.length).setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function generarIdEvidencia_() {
  return 'EV-' + new Date().getTime();
}

function registrarEvidenciaFoto_(usuarioId, tipo, entidadId, url) {
  var sh = asegurarHojaEvidencias_();
  var id = generarIdEvidencia_();
  sh.appendRow([id, new Date(), usuarioId, tipo, entidadId, url]);
  return id;
}

function completarTarea(token, registroId, descripcionRealizada, fotoBase64, fotoMime, fotoNombre) {
  var usuario = requierePermiso_(token, PERMISOS.EJECUTAR_TAREAS_COLA);
  var encontrado = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
  if (!encontrado) throw new Error('No existe el registro de cola "' + registroId + '".');
  var obj = encontrado.fila.obj;
  if (obj.estado !== 'En proceso') throw new Error('Esta tarea no está en proceso.');
  if (obj.usuario_asignado_actual !== usuario.id_usuario) throw new Error('Esta tarea está asignada a otro usuario.');
  if (String(obj.tipo_origen) === 'Gas') return completarTareaGas_(usuario, registroId, obj, descripcionRealizada);
  // Acepta una sola foto (forma anterior) o una lista de fotos [{ base64, mime, nombre }].
  var fotos = Array.isArray(fotoBase64) ? fotoBase64 : (fotoBase64 ? [{ base64: fotoBase64, mime: fotoMime, nombre: fotoNombre }] : []);
  fotos = fotos.filter(function (f) { return f && f.base64; });
  if (!fotos.length) throw new Error('Debes adjuntar al menos una foto de evidencia para completar la tarea.');
  if (fotos.length > 10) throw new Error('Puedes adjuntar máximo 10 fotos por trabajo.');
  fotos.forEach(function (f) { if (String(f.base64).length > 7000000) throw new Error('Una de las imágenes es demasiado grande. Usa fotos más ligeras.'); });

  var ahora = new Date();
  var inicio = obj.hora_inicio ? new Date(obj.hora_inicio) : null;
  var segundosSesion = (inicio && !isNaN(inicio.getTime())) ? Math.max(0, Math.round((ahora - inicio) / 1000)) : 0;
  var acumuladoPrevio = Number(obj.tiempo_acumulado_segundos) || 0;
  var minutos = Math.max(1, Math.round((segundosSesion + acumuladoPrevio) / 60));

  var carpeta = carpetaFotosEvidenciaTareas_();
  var marca = new Date().getTime();
  var urls = fotos.map(function (f, i) {
    var blob = Utilities.newBlob(Utilities.base64Decode(f.base64), f.mime || 'image/jpeg', f.nombre || (registroId + '-' + (i + 1) + '.jpg'));
    var archivo = carpeta.createFile(blob);
    archivo.setName(registroId + ' - ' + (obj.tarea_id || obj.origen_id || '') + ' - foto ' + (i + 1) + ' - ' + marca);
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/thumbnail?sz=w500&id=' + archivo.getId();
  });
  var urlFoto = urls[0];

  asegurarColumna_(HOJAS.COLA, 'foto_evidencia_url');
  asegurarColumna_(HOJAS.COLA, 'fotos_evidencia_urls');
  encontrado = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
  escribirCamposFila_(encontrado, {
    estado: 'Completada',
    hora_fin: ahora,
    tiempo_total_minutos: minutos,
    descripcion_realizada: descripcionRealizada || '',
    foto_evidencia_url: urlFoto,
    fotos_evidencia_urls: urls.join('\n')
  });
  urls.forEach(function (u) { registrarEvidenciaFoto_(usuario.id_usuario, 'TAREA_COLA', registroId, u); });
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'COMPLETAR_TAREA_COLA', HOJAS.COLA, registroId, 'En proceso', 'Completada (con ' + urls.length + (urls.length === 1 ? ' foto' : ' fotos') + ' de evidencia)');

  if (obj.tipo_origen === 'Ticket' && obj.origen_id) {
    var ticketEncontrado = buscarFilaPorValor_('TICKETS_INDICACIONES', 'ticket_id', obj.origen_id, false);
    if (ticketEncontrado && ticketEncontrado.fila.obj.estado !== 'Atendido') {
      setCell_(ticketEncontrado.tabla, ticketEncontrado.fila.indiceFila, 'estado', 'Atendido');
      setCell_(ticketEncontrado.tabla, ticketEncontrado.fila.indiceFila, 'fecha_hora_atendido', ahora);
    }
  }

  return { ok: true, foto_url: urlFoto, cola: construirColaDelDia_(fechaHoy_()) };
}

function generarCodigoNumerico_(longitud) {
  var min = Math.pow(10, longitud - 1), max = Math.pow(10, longitud) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

function tareaTieneBloqueoEstricto_(tareaId) {
  var info = buscarFilaPorValor_(HOJAS.CAT_TAREAS, 'tarea_id', tareaId, false);
  return !!(info && (info.fila.obj.bloqueo_estricto === true || info.fila.obj.bloqueo_estricto === 'TRUE'));
}

function correosConPermiso_(clavePermiso) {
  return leerTabla_(HOJAS.USUARIOS).filas
    .map(function (f) { return f.obj; })
    .filter(function (u) { return u.estado === 'Activo' && u.correo && usuarioTienePermiso_(u, clavePermiso); })
    .map(function (u) { return u.correo; });
}

function solicitarCodigoSalto(token, registroId, motivo) {
  var usuario = requierePermiso_(token, PERMISOS.EJECUTAR_TAREAS_COLA);
  var motivoLimpio = String(motivo || '').trim();
  if (!motivoLimpio) throw new Error('Escribe el motivo por el que necesitas omitir esta tarea.');

  var encontrado = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
  if (!encontrado) throw new Error('No existe el registro de cola "' + registroId + '".');
  var obj = encontrado.fila.obj;
  if (obj.estado === 'Completada' || obj.estado === 'Saltada') {
    throw new Error('Esta tarea ya se cerró; no se puede solicitar un código de salto.');
  }
  if (tareaTieneBloqueoEstricto_(obj.tarea_id)) {
    throw new Error('Esta tarea no se puede omitir: debe completarse al 100% (regla de equipos críticos).');
  }

  asegurarColumna_(HOJAS.COLA, 'motivo_salto');
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'motivo_salto', motivoLimpio);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'SOLICITAR_CODIGO_SALTO', HOJAS.COLA, registroId, '', motivoLimpio);

  var catalogo = {};
  leerTabla_(HOJAS.CAT_TAREAS).filas.forEach(function (f) { catalogo[f.obj.tarea_id] = f.obj; });
  var nombreTarea = (catalogo[obj.tarea_id] || {}).nombre_tarea || obj.tarea_id;

  var destinatarios = correosConPermiso_(PERMISOS.GENERAR_CODIGO_SALTO);
  if (destinatarios.length) {
    var asunto = 'MM103 · Solicitud de código para omitir tarea';
    var cuerpo = usuario.nombre_completo + ' solicita un código para omitir la tarea "' + nombreTarea + '".\n\n' +
      'Motivo: ' + motivoLimpio + '\n\n' +
      'Entra a la app, sección "Cola de trabajo de hoy", y genera el código de salto para dárselo.\n\n' +
      'Condominio Maestro Meridiano 103';
    try {
      MailApp.sendEmail(destinatarios.join(','), asunto, cuerpo);
    } catch (e) {
      // no bloquea la solicitud si falla el envío de correo
    }
  }

  return { ok: true };
}

function generarCodigoSalto(token, registroId) {
  var usuario = requierePermiso_(token, PERMISOS.GENERAR_CODIGO_SALTO);
  var encontrado = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
  if (!encontrado) throw new Error('No existe el registro de cola "' + registroId + '".');
  var obj = encontrado.fila.obj;
  if (obj.estado === 'Completada' || obj.estado === 'Saltada') {
    throw new Error('Esta tarea ya se cerró; no se puede generar un código de salto.');
  }
  if (tareaTieneBloqueoEstricto_(obj.tarea_id)) {
    throw new Error('Esta tarea no se puede omitir: debe completarse al 100% (regla de equipos críticos).');
  }
  var codigo = generarCodigoNumerico_(4);
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'codigo_salto', codigo);
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'codigo_salto_confirmado', false);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'GENERAR_CODIGO_SALTO', HOJAS.COLA, registroId, '', 'Código generado');
  return { ok: true, codigo: codigo };
}

function saltarTareaConCodigo(token, registroId, codigo) {
  var usuario = requierePermiso_(token, PERMISOS.EJECUTAR_TAREAS_COLA);
  var encontrado = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
  if (!encontrado) throw new Error('No existe el registro de cola "' + registroId + '".');
  var obj = encontrado.fila.obj;
  if (obj.estado === 'Completada' || obj.estado === 'Saltada') throw new Error('Esta tarea ya se cerró.');
  if (!obj.codigo_salto || String(obj.codigo_salto).trim() !== String(codigo || '').trim()) {
    throw new Error('El código de salto no es correcto.');
  }
  if (obj.codigo_salto_confirmado === true || obj.codigo_salto_confirmado === 'TRUE') {
    throw new Error('Ese código ya fue usado.');
  }
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'estado', 'Saltada');
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'codigo_salto_confirmado', true);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'SALTAR_TAREA_COLA', HOJAS.COLA, registroId, obj.estado, 'Saltada (autorizada por código)');
  return { ok: true, cola: construirColaDelDia_(fechaHoy_()) };
}

// ----------------------------------------------------------------------------
// BLOQUE 3 — CHECKLIST DE EQUIPOS Y ALMACÉN
// ----------------------------------------------------------------------------

var CAMPOS_LECTURA_EQUIPO = {
  EQUIPO_HIDRO_ALTA_PRESION: [
    { campo: 'psi', etiqueta: 'PSI', tipo: 'numero' },
    { campo: 'hz', etiqueta: 'Hz', tipo: 'numero' },
    { campo: 'amperes', etiqueta: 'Amperes', tipo: 'numero' },
    { campo: 'bomba_activa', etiqueta: 'Bomba en operación hoy', tipo: 'seleccion', opciones: ['Bomba 1', 'Bomba 2', 'Bomba 3'] }
  ],
  EQUIPO_HIDRO_BAJA_PRESION: [
    { campo: 'psi', etiqueta: 'PSI', tipo: 'numero' },
    { campo: 'hz', etiqueta: 'Hz', tipo: 'numero' },
    { campo: 'amperes', etiqueta: 'Amperes', tipo: 'numero' },
    { campo: 'bomba_activa', etiqueta: 'Bomba en operación hoy', tipo: 'seleccion', opciones: ['Bomba 1', 'Bomba 2', 'Bomba 3'] }
  ],
  EQUIPO_HIDRO_COMERCIO: [
    { campo: 'bomba_lider', etiqueta: 'Bomba líder hoy (arranque principal)', tipo: 'seleccion', opciones: ['Bomba A', 'Bomba B'] },
    { campo: 'psi_encendido_principal', etiqueta: 'PSI encendido (bomba líder)', tipo: 'numero' },
    { campo: 'psi_apagado_principal', etiqueta: 'PSI apagado (bomba líder)', tipo: 'numero' },
    { campo: 'amperes', etiqueta: 'Amperes', tipo: 'numero' },
    { campo: 'psi_encendido_recuperacion', etiqueta: 'PSI encendido (bomba de apoyo)', tipo: 'numero' },
    { campo: 'psi_apagado_recuperacion', etiqueta: 'PSI apagado (bomba de apoyo)', tipo: 'numero' }
  ],
  EQUIPO_PLANTA_ELECTRICA: [
    { campo: 'anticongelante_pct', etiqueta: 'Anticongelante (%)', tipo: 'numero' },
    { campo: 'diesel_pct', etiqueta: 'Diésel (%)', tipo: 'numero' },
    { campo: 'linea1', etiqueta: 'Línea 1', tipo: 'numero' },
    { campo: 'linea2', etiqueta: 'Línea 2', tipo: 'numero' },
    { campo: 'linea3', etiqueta: 'Línea 3', tipo: 'numero' },
    { campo: 'hz', etiqueta: 'Hz', tipo: 'numero' },
    { campo: 'rpm', etiqueta: 'RPM', tipo: 'numero' },
    { campo: 'tiempo_uso', etiqueta: 'Tiempo de uso', tipo: 'texto' },
    { campo: 'bateria', etiqueta: 'Batería', tipo: 'texto' },
    { campo: 'temperatura', etiqueta: 'Temperatura', tipo: 'numero' },
    { campo: 'psi', etiqueta: 'PSI', tipo: 'numero' }
  ],
  EQUIPO_PLANTA_INCENDIOS: [
    { campo: 'psi', etiqueta: 'PSI', tipo: 'numero' },
    { campo: 'rpm', etiqueta: 'RPM', tipo: 'numero' },
    { campo: 'amperes', etiqueta: 'Amperes', tipo: 'numero' },
    { campo: 'temperatura', etiqueta: 'Temperatura', tipo: 'numero' },
    { campo: 'bateria', etiqueta: 'Batería', tipo: 'texto' },
    { campo: 'diesel_pct', etiqueta: 'Diésel (%)', tipo: 'numero' }
  ]
};


// ---------------------------------------------------------------------------
// Fase 5: trabajos extra y tickets integrados a la cola de trabajo diario
// ---------------------------------------------------------------------------

function agregarExtrasDelDiaACola_(fecha) {
  asegurarColumna_(HOJAS.EXTRA, 'registro_cola_id');
  asegurarColumna_(HOJAS.COLA, 'tipo_origen');
  asegurarColumna_(HOJAS.COLA, 'origen_id');
  asegurarColumna_(HOJAS.COLA, 'tiempo_acumulado_segundos');

  var tablaExtra = leerTabla_(HOJAS.EXTRA);
  var pendientesHoy = tablaExtra.filas.filter(function (f) {
    var o = f.obj;
    return o.estado === 'Pendiente' && !o.registro_cola_id && o.fecha_programada && soloFecha_(o.fecha_programada) === fecha && !esTrabajoVinculado_(o);
  });
  if (!pendientesHoy.length) return;

  var shCola = hoja_(HOJAS.COLA);
  var encCola = encabezados_(shCola);
  var tablaCola = leerTabla_(HOJAS.COLA);
  var max = 0;
  tablaCola.filas.forEach(function (f) {
    var m = /^COLA-(\d+)$/.exec(String(f.obj.registro_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });

  var filasNuevas = [];
  pendientesHoy.forEach(function (f) {
    max += 1;
    var registroId = 'COLA-' + ('00000' + max).slice(-5);
    filasNuevas.push(objetoAFila_(encCola, {
      registro_id: registroId,
      fecha: fecha,
      tarea_id: '',
      estado: 'Pendiente',
      usuario_asignado_actual: f.obj.usuario_asignado || '',
      hora_inicio: '',
      hora_fin: '',
      tiempo_total_minutos: '',
      codigo_salto: '',
      codigo_salto_confirmado: false,
      descripcion_realizada: '',
      tipo_origen: 'Extra',
      origen_id: f.obj.id,
      tiempo_acumulado_segundos: 0
    }));
    setCell_(tablaExtra, f.indiceFila, 'registro_cola_id', registroId);
  });

  if (filasNuevas.length) {
    shCola.getRange(shCola.getLastRow() + 1, 1, filasNuevas.length, encCola.length).setValues(filasNuevas);
  }
}


// ---------------------------------------------------------------------------
// Fase 6, punto 6: reordenamiento manual de prioridad entre tickets urgentes
// de la cola de hoy (un administrador o supervisor decide cuál va primero).
// ---------------------------------------------------------------------------

function ticketsUrgentesDeHoyOrdenados_() {
  var fecha = fechaHoy_();
  var tickets = {};
  leerTabla_('TICKETS_INDICACIONES').filas.forEach(function (f) { tickets[f.obj.ticket_id] = f.obj; });
  var tabla = leerTabla_(HOJAS.COLA);
  var lista = tabla.filas.filter(function (f) {
    var o = f.obj;
    if (soloFecha_(o.fecha) !== fecha || o.tipo_origen !== 'Ticket') return false;
    if (o.estado !== 'Pendiente' && o.estado !== 'En proceso') return false;
    var tk = tickets[o.origen_id];
    if (tk && o.estado === 'Pendiente' && (tk.estado === 'Atendido' || tk.estado === 'Cancelado')) return false;
    return tk && tk.prioridad === 'Alta';
  });
  lista.sort(function (a, b) {
    var ma = (a.obj.orden_manual === '' || a.obj.orden_manual === undefined) ? Number.MAX_SAFE_INTEGER : Number(a.obj.orden_manual);
    var mb = (b.obj.orden_manual === '' || b.obj.orden_manual === undefined) ? Number.MAX_SAFE_INTEGER : Number(b.obj.orden_manual);
    if (ma !== mb) return ma - mb;
    return String(a.obj.registro_id).localeCompare(String(b.obj.registro_id));
  });
  return { tabla: tabla, lista: lista };
}

/**
 * direccion: 'subir' | 'bajar'. Requiere permiso de administrar tickets o tareas
 * (un administrador o supervisor). Solo reordena entre tickets urgentes (Alta)
 * de la cola de hoy; nunca saca a un ticket de su banda de prioridad.
 */
function moverTicketEnCola(token, registroId, direccion) {
  var usuario = requiereSesion_(token);
  if (!usuarioTienePermiso_(usuario, PERMISOS.ATENDER_TICKET) && !usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS)) {
    throw new Error('No tienes permiso para reordenar la cola de tickets.');
  }
  if (direccion !== 'subir' && direccion !== 'bajar') throw new Error('Dirección inválida.');

  asegurarColumna_(HOJAS.COLA, 'orden_manual');
  var contexto = ticketsUrgentesDeHoyOrdenados_();
  var lista = contexto.lista;

  // Si ningún ticket urgente de hoy tiene todavía un orden_manual asignado, se inicializan
  // todos según su orden actual (10, 20, 30...) antes de mover nada.
  var faltaInicializar = lista.some(function (f) { return f.obj.orden_manual === '' || f.obj.orden_manual === undefined; });
  if (faltaInicializar) {
    lista.forEach(function (f, idx) {
      escribirCamposFila_({ tabla: contexto.tabla, fila: f }, { orden_manual: (idx + 1) * 10 });
    });
  }

  var indice = -1;
  for (var i = 0; i < lista.length; i++) { if (lista[i].obj.registro_id === registroId) { indice = i; break; } }
  if (indice === -1) throw new Error('Ese ticket no está en la lista de urgentes pendientes de hoy.');

  var indiceVecino = direccion === 'subir' ? indice - 1 : indice + 1;
  if (indiceVecino < 0 || indiceVecino >= lista.length) {
    return { ok: true, sinCambio: true, cola: construirColaDelDia_(fechaHoy_()) }; // ya está en el extremo de la lista
  }

  var filaActual = lista[indice];
  var filaVecina = lista[indiceVecino];
  var ordenActual = Number(filaActual.obj.orden_manual);
  var ordenVecino = Number(filaVecina.obj.orden_manual);

  escribirCamposFila_({ tabla: contexto.tabla, fila: filaActual }, { orden_manual: ordenVecino });
  escribirCamposFila_({ tabla: contexto.tabla, fila: filaVecina }, { orden_manual: ordenActual });

  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'REORDENAR_TICKET_COLA', HOJAS.COLA, registroId,
    'posición ' + (indice + 1), 'posición ' + (indiceVecino + 1) + ' (' + direccion + ')');
  return { ok: true, cola: construirColaDelDia_(fechaHoy_()) };
}

// ---------------------------------------------------------------------------
// Fase 6, punto 7: cierre de jornada y traspaso automático de tickets
// pendientes al siguiente día hábil (rollover diario).
// ---------------------------------------------------------------------------

/** Suma un día a una fecha 'yyyy-MM-dd' y devuelve el resultado en el mismo formato. */
function sumarDias_(fechaStr, dias) {
  var partes = fechaStr.split('-').map(Number);
  var fecha = new Date(partes[0], partes[1] - 1, partes[2]);
  fecha.setDate(fecha.getDate() + dias);
  return Utilities.formatDate(fecha, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function diaDeLaSemana_(fechaStr) {
  var partes = fechaStr.split('-').map(Number);
  return new Date(partes[0], partes[1] - 1, partes[2]).getDay(); // 0 = domingo
}

/** Siguiente día hábil (se trabaja de lunes a sábado; domingo se salta). */
function fechaSiguienteDiaHabil_(fechaStr) {
  var siguiente = sumarDias_(fechaStr, 1);
  if (diaDeLaSemana_(siguiente) === 0) siguiente = sumarDias_(siguiente, 1);
  return siguiente;
}

/**
 * Núcleo del cierre de jornada para una fecha dada: traslada al siguiente día hábil
 * todo lo que en COLA_TRABAJO_DIARIO haya quedado Pendiente o En proceso ese día
 * (tickets, trabajos extra y tareas de catálogo por igual). Lo que estaba "En
 * proceso" pasa primero a "Pausado", registrando el tiempo ya trabajado. Los
 * registros trasladados quedan marcados (rollover_desde) para reubicarse al
 * inicio de la cola del nuevo día, conservando su orden relativo de urgencia.
 * Al final regenera la hoja de trabajo del nuevo día con asegurarColaDelDia_.
 */
function ejecutarCierreJornada_(fechaCierre, idUsuarioActor, correoActor) {
  asegurarColumna_(HOJAS.COLA, 'rollover_desde');
  asegurarColumna_(HOJAS.COLA, 'tiempo_acumulado_segundos');

  var fechaSiguiente = fechaSiguienteDiaHabil_(fechaCierre);
  var tabla = leerTabla_(HOJAS.COLA);
  var mapasCierre = mapasOrdenCola_();
  // Fase 4: lo que está oculto en la cola no se traslada al día siguiente; se queda en su fecha, sin borrarse.
  var aTrasladar = tabla.filas.filter(function (f) {
    return soloFecha_(f.obj.fecha) === fechaCierre && (f.obj.estado === 'Pendiente' || f.obj.estado === 'En proceso' || f.obj.estado === 'Pausado') &&
      !motivoOcultoEnCola_(f.obj, mapasCierre, fechaCierre);
  });

  // Las tareas de catálogo que ya existen en el día siguiente no se trasladan: se cierran como
  // 'Saltada' con motivo, para que la cola no acumule juegos duplicados de las mismas tareas.
  var yaEnSiguiente = {};
  tabla.filas.forEach(function (f) {
    var tipo = f.obj.tipo_origen || 'Catalogo';
    if (tipo === 'Catalogo' && f.obj.tarea_id && soloFecha_(f.obj.fecha) === fechaSiguiente) yaEnSiguiente[f.obj.tarea_id] = true;
  });
  var duplicadas = 0;

  aTrasladar.forEach(function (f) {
    var tipoOrigen = f.obj.tipo_origen || 'Catalogo';
    // Un trabajo pausado (por ejemplo, uno que lleva varias visitas) siempre se traslada.
    if (tipoOrigen === 'Catalogo' && f.obj.tarea_id && f.obj.estado !== 'Pausado') {
      if (yaEnSiguiente[f.obj.tarea_id]) {
        escribirCamposFila_({ tabla: tabla, fila: f }, {
          estado: 'Saltada',
          motivo_salto: 'No trasladada: la tarea ya existe en la cola del ' + fechaSiguiente
        });
        duplicadas++;
        return;
      }
      yaEnSiguiente[f.obj.tarea_id] = true;
    }
    // El acomodo manual de la cola vale solo por el día: al trasladar, se vuelve al orden estándar.
    var campos = { fecha: fechaSiguiente, rollover_desde: fechaCierre, posicion_manual: '' };
    if (f.obj.estado === 'En proceso') {
      var ahora = new Date();
      var inicio = f.obj.hora_inicio ? new Date(f.obj.hora_inicio) : null;
      var segundos = (inicio && !isNaN(inicio.getTime())) ? Math.max(0, Math.round((ahora - inicio) / 1000)) : 0;
      campos.estado = 'Pausado';
      campos.hora_inicio = '';
      campos.tiempo_acumulado_segundos = (Number(f.obj.tiempo_acumulado_segundos) || 0) + segundos;
    }
    escribirCamposFila_({ tabla: tabla, fila: f }, campos);
  });

  asegurarColaDelDia_(fechaSiguiente);

  registrarAuditoria_(idUsuarioActor || '', correoActor || '(sistema)', 'SYSTEM_DAY_ROLLOVER', HOJAS.COLA, fechaCierre,
    (aTrasladar.length - duplicadas) + ' registro(s) trasladados' + (duplicadas ? ', ' + duplicadas + ' duplicado(s) cerrados' : ''), 'a ' + fechaSiguiente);

  // Fase 5: lo terminado de los días ya cerrados se copia a HISTORIAL_TRABAJOS (no se borra nada).
  // Si el archivado fallara, el cierre de jornada ya quedó hecho y se reintenta en el siguiente cierre.
  var historial = null;
  try { historial = archivarHistorialHasta_(fechaCierre, idUsuarioActor, correoActor); }
  catch (errHist) { console.error('Historial de trabajos: ' + errHist); historial = { ok: false, error: String(errHist && errHist.message || errHist) }; }

  return { ok: true, trasladados: aTrasladar.length - duplicadas, duplicados_cerrados: duplicadas, fecha_cierre: fechaCierre, fecha_siguiente: fechaSiguiente, historial: historial };
}

/** Cierre manual, disparado por un supervisor/administrador desde la app. */
function ejecutarCierreJornadaManual(token, fecha) {
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  var r = ejecutarCierreJornada_(fecha || fechaHoy_(), usuario.id_usuario, usuario.correo);
  r.cola = construirColaDelDia_(fechaHoy_());
  return r;
}

/**
 * Punto de entrada para el disparador (trigger) de tiempo instalado a medianoche.
 * No recibe token: lo ejecuta el sistema, no una persona. Como el disparador corre
 * justo después de las 00:00, fechaHoy_() ya es el día NUEVO; la jornada que hay
 * que cerrar es la de ayer.
 */
function rolloverJornadaProgramado() {
  var fechaCierre = sumarDias_(fechaHoy_(), -1);
  return ejecutarCierreJornada_(fechaCierre, '', '(sistema)');
}

/**
 * Instala (una sola vez; es idempotente) el disparador de tiempo que corre
 * rolloverJornadaProgramado() todos los días poco después de medianoche.
 * Ejecutar manualmente desde el editor de Apps Script (selector de función
 * "instalarTriggerCierreJornada_" > Ejecutar).
 */
function instalarTriggerCierreJornada_() {
  var yaExiste = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'rolloverJornadaProgramado';
  });
  if (yaExiste) return { ok: true, yaInstalado: true };
  ScriptApp.newTrigger('rolloverJornadaProgramado').timeBased().atHour(0).nearMinute(10).everyDays(1).create();
  return { ok: true, yaInstalado: false };
}


// ----------------------------------------------------------------------------
// REORDENAR LA COLA DE HOY (subir / bajar / mover a una posición)
// Permiso: CARGAR_MODIFICAR_TAREAS. Solo se mueven tareas Pendientes.
// La primera vez que se reordena en el día, se guarda la posición de TODAS las tareas de hoy
// (10, 20, 30...). Lo que entre después sin posición (tickets nuevos) queda al final.
// ----------------------------------------------------------------------------
function moverTareaEnCola(token, registroId, destino) {
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  var fecha = fechaHoy_();
  asegurarColumna_(HOJAS.COLA, 'posicion_manual');
  var tabla = leerTabla_(HOJAS.COLA);
  var colPosicion = tabla.encabezados.indexOf('posicion_manual') + 1;
  if (colPosicion < 1) throw new Error('No se encontró la columna posicion_manual.');

  var mapas = mapasOrdenCola_();
  function ordenEfectivo_(f) { return claveOrdenCola_(f.obj, mapas.catalogo, mapas.tickets); }

  // Las posiciones se cuentan sobre lo que se ve en la cola (sin renglones ocultos, Fase 4).
  var deHoy = tabla.filas.filter(function (f) { return soloFecha_(f.obj.fecha) === fecha && !motivoOcultoEnCola_(f.obj, mapas, fecha); });
  deHoy.sort(function (a, b) { return (ordenEfectivo_(a) - ordenEfectivo_(b)) || (a.indiceFila - b.indiceFila); });

  var indice = -1;
  for (var i = 0; i < deHoy.length; i++) { if (deHoy[i].obj.registro_id === registroId) { indice = i; break; } }
  if (indice === -1) throw new Error('Esa tarea no está en la cola de hoy.');
  if (deHoy[indice].obj.estado !== 'Pendiente') throw new Error('Solo se pueden mover tareas pendientes.');

  var nuevo;
  if (destino === 'subir') {
    nuevo = indice - 1;
    while (nuevo >= 0 && deHoy[nuevo].obj.estado !== 'Pendiente') nuevo--;
    if (nuevo < 0) return { ok: true, sinCambio: true, cola: construirColaDelDia_(fecha) };
  } else if (destino === 'bajar') {
    nuevo = indice + 1;
    while (nuevo < deHoy.length && deHoy[nuevo].obj.estado !== 'Pendiente') nuevo++;
    if (nuevo >= deHoy.length) return { ok: true, sinCambio: true, cola: construirColaDelDia_(fecha) };
  } else {
    var pos = parseInt(destino, 10);
    if (!(pos >= 1)) throw new Error('Escribe una posición válida (1, 2, 3...).');
    nuevo = Math.min(deHoy.length, pos) - 1;
  }

  var movida = deHoy.splice(indice, 1)[0];
  deHoy.splice(nuevo, 0, movida);

  // Solo se escriben las filas cuya posición cambió, agrupando filas contiguas en una sola escritura.
  var cambios = [];
  deHoy.forEach(function (f, idx) {
    var valor = (idx + 1) * 10;
    if (String(f.obj.posicion_manual) !== String(valor)) cambios.push([f.indiceFila, valor]);
  });
  cambios.sort(function (a, b) { return a[0] - b[0]; });
  var k = 0;
  while (k < cambios.length) {
    var inicio = k;
    while (k + 1 < cambios.length && cambios[k + 1][0] === cambios[k][0] + 1) k++;
    var bloque = cambios.slice(inicio, k + 1).map(function (c) { return [c[1]]; });
    tabla.sh.getRange(cambios[inicio][0], colPosicion, bloque.length, 1).setValues(bloque);
    k++;
  }

  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'REORDENAR_COLA', HOJAS.COLA, registroId,
    'posición ' + (indice + 1), 'posición ' + (nuevo + 1));
  return { ok: true, cola: construirColaDelDia_(fecha) };
}


/**
 * Detener un trabajo que alguien tomó por error y regresarlo a la cola como si nunca lo
 * hubiera tomado (estado Pendiente, sin hora de inicio y con el tiempo en cero). Solo para
 * quien puede enviar tickets o cargar tareas. Un ticket abierto vuelve a quedar abierto.
 */
function devolverTareaACola(token, registroId, motivo) {
  var usuario = requiereSesion_(token);
  if (!usuarioTienePermiso_(usuario, PERMISOS.ENVIAR_TICKET) && !usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS)) {
    throw new Error('Tu perfil no puede regresar trabajos a la cola.');
  }
  motivo = String(motivo || '').trim();
  if (!motivo) throw new Error('Escribe el motivo para regresar el trabajo a la cola.');
  var candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    var enc = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
    if (!enc) throw new Error('No existe el registro de cola "' + registroId + '".');
    var o = enc.fila.obj;
    if (o.estado !== 'En proceso' && o.estado !== 'Pausado' && o.estado !== 'Saltada') {
      throw new Error('Solo se puede regresar un trabajo que esté en proceso, pausado o saltado (este está "' + o.estado + '").');
    }
    var nuevoAsignado = '';
    var tipo = o.tipo_origen || 'Catalogo';
    if (tipo === 'Ticket') {
      var et = buscarFilaPorValor_('TICKETS_INDICACIONES', 'ticket_id', o.origen_id, false);
      if (et) {
        var t = et.fila.obj;
        if (t.era_abierto === true || t.era_abierto === 'TRUE') {
          setCell_(et.tabla, et.fila.indiceFila, 'dirigido_a', TICKET_ABIERTO);
          setCell_(et.tabla, et.fila.indiceFila, 'era_abierto', '');
        } else {
          nuevoAsignado = t.dirigido_a || '';
        }
      }
    } else if (tipo === 'Extra') {
      var ee = buscarFilaPorValor_(HOJAS.EXTRA, 'id', o.origen_id, false);
      nuevoAsignado = ee ? (ee.fila.obj.usuario_asignado || '') : '';
    }
    asegurarColumna_(HOJAS.COLA, 'tiempo_acumulado_segundos');
    enc = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
    var camposReactivar = {
      estado: 'Pendiente',
      usuario_asignado_actual: nuevoAsignado,
      hora_inicio: '',
      hora_fin: '',
      tiempo_total_minutos: '',
      tiempo_acumulado_segundos: 0,
      motivo_pausa: '',
      pausado_por: '',
      pausado_en: ''
    };
    if (o.estado === 'Saltada') {
      // Se borra el salto (código y motivo) para que vuelva limpio; el salto original queda en la auditoría.
      camposReactivar.codigo_salto = '';
      camposReactivar.codigo_salto_confirmado = false;
      camposReactivar.motivo_salto = '';
    }
    escribirCamposFila_(enc, camposReactivar);
    registrarAuditoria_(usuario.id_usuario, usuario.correo, 'REGRESAR_A_COLA', HOJAS.COLA, registroId,
      o.estado + ' (' + (o.usuario_asignado_actual || 'sin asignar') + ')' + (o.estado === 'Saltada' && o.motivo_salto ? ' — salto: ' + o.motivo_salto : ''), 'Pendiente — motivo: ' + motivo);
    return { ok: true, cola: construirColaDelDia_(fechaHoy_()) };
  } finally {
    candado.releaseLock();
  }
}
