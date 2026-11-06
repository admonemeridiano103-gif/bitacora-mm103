function obtenerDefinicionLecturasEquipo(token) {
  var usuario = requiereSesion_(token);
  return CAMPOS_LECTURA_EQUIPO;
}

function obtenerCatalogoEquipos_() {
  var cache = CacheService.getScriptCache();
  var cacheado = cache.get('EQUIPO_CATALOGO_ALL');
  if (cacheado) return JSON.parse(cacheado);
  var filas = leerTabla_('EQUIPO_CATALOGO').filas.map(function (f) { return f.obj; });
  cache.put('EQUIPO_CATALOGO_ALL', JSON.stringify(filas), 1800);
  return filas;
}

function listarCatalogoEquipos(token) {
  var usuario = requiereSesion_(token);
  return obtenerCatalogoEquipos_()
    .filter(function (e) { return e.activo === true || e.activo === 'TRUE'; });
}

function generarNumeroAccion_() {
  var max = 0;
  Object.keys(CAMPOS_LECTURA_EQUIPO).forEach(function (nombreHoja) {
    var sh = ss_().getSheetByName(nombreHoja);
    if (!sh) return;
    leerTabla_(nombreHoja).filas.forEach(function (f) {
      var m = /^ACCION-(\d+)$/.exec(String(f.obj.registro_id || ''));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
  });
  return 'ACCION-' + ('00000' + (max + 1)).slice(-5);
}

function listarChecklistEquiposDelDia(token) {
  var usuario = requiereSesion_(token);
  var tienePermiso = usuarioTienePermiso_(usuario, PERMISOS.REGISTRAR_LECTURA_EQUIPO) ||
    usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  if (!tienePermiso) throw new Error('Tu perfil no tiene acceso al checklist de equipos.');

  var fecha = fechaHoy_();
  var equipos = listarCatalogoEquipos(token);
  return equipos.map(function (eq) {
    var hoja = eq.hoja_relacionada;
    var registroHoy = null;
    if (hoja && ss_().getSheetByName(hoja)) {
      var filasHoy = leerTabla_(hoja).filas
        .filter(function (f) { return soloFecha_(f.obj.fecha_hora) === fecha; });
      if (filasHoy.length) registroHoy = filasHoy[filasHoy.length - 1].obj;
    }
    return {
      equipo_id: eq.equipo_id,
      nombre: eq.nombre,
      hoja_relacionada: hoja,
      frecuencia_revision: eq.frecuencia_revision,
      completado_hoy: !!registroHoy,
      registro_id: registroHoy ? registroHoy.registro_id : '',
      usuario_id: registroHoy ? registroHoy.usuario_id : ''
    };
  });
}

function registrarLecturaEquipo(token, equipoId, lecturas) {
  var usuario = requierePermiso_(token, PERMISOS.REGISTRAR_LECTURA_EQUIPO);
  var encontrado = buscarFilaPorValor_('EQUIPO_CATALOGO', 'equipo_id', equipoId, false);
  if (!encontrado) throw new Error('No existe el equipo "' + equipoId + '".');
  var eq = encontrado.fila.obj;
  var hoja = eq.hoja_relacionada;
  var campos = CAMPOS_LECTURA_EQUIPO[hoja];
  if (!campos) throw new Error('No hay definición de lecturas para "' + hoja + '".');

  // Asegura que cada campo de la definición tenga su columna en la hoja de destino
  // (por ejemplo si se agrega o renombra un campo, como bomba_lider en Comercio).
  campos.forEach(function (c) {
    asegurarColumna_(hoja, c.campo);
  });

  // Regla de cierre: no se pide foto, pero SÍ deben quedar capturados el 100% de los
  // campos de la lectura (numéricos, de texto y de selección) antes de poder registrarla.
  var faltantes = [];
  campos.forEach(function (c) {
    var v = lecturas ? lecturas[c.campo] : undefined;
    if (c.tipo === 'booleano') return; // un checkbox siempre trae un valor definido.
    if (v === undefined || v === null || v === '' || (c.tipo === 'numero' && isNaN(Number(v)))) {
      faltantes.push(c.etiqueta);
    }
  });
  if (faltantes.length) {
    throw new Error('Faltan campos por capturar antes de poder cerrar esta lectura: ' + faltantes.join(', ') + '.');
  }

  var sh = hoja_(hoja);
  var encabezados = encabezados_(sh);
  var numeroAccion = generarNumeroAccion_();
  var nuevo = { registro_id: numeroAccion, fecha_hora: new Date(), usuario_id: usuario.id_usuario, firma_evidencia_url: '' };
  campos.forEach(function (c) {
    var v = lecturas ? lecturas[c.campo] : undefined;
    nuevo[c.campo] = (v === undefined || v === null) ? '' : v;
  });
  sh.appendRow(objetoAFila_(encabezados, nuevo));
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'REGISTRAR_LECTURA_EQUIPO', hoja, numeroAccion, '', eq.nombre);

  // Si esta lectura corresponde a un equipo con una tarea pendiente/en proceso en la cola
  // de hoy, la cierra automáticamente (sin foto, ya que la regla de hidroneumáticos no la
  // requiere). Si algo falla aquí no debe impedir que la lectura ya registrada quede guardada.
  try {
    cerrarTareaColaPorEquipo_(usuario, eq.equipo_id);
  } catch (e) {
    // no bloquea el registro de la lectura
  }

  return { ok: true, numero_accion: numeroAccion, checklist: listarChecklistEquiposDelDia(token), cola: construirColaDelDia_(fechaHoy_()) };
}

/**
 * Equipos del checklist que cubre una tarea del catálogo. Se toma, en este orden:
 *  1) la columna equipos_checklist ('HIDRO' = todos los hidroneumáticos, 'TODOS' = todo el
 *     checklist, o una lista de equipo_id separados por coma);
 *  2) el campo Área/equipo si coincide con el id o el nombre de un equipo;
 *  3) si el nombre de la tarea menciona "hidroneum", todos los hidroneumáticos.
 */
function equiposDeTarea_(t, catalogoEquipos) {
  if (!t) return [];
  var activos = (catalogoEquipos || obtenerCatalogoEquipos_()).filter(function (e) { return e.activo === true || e.activo === 'TRUE'; });
  var idDe = function (e) { return e.equipo_id; };
  var hidros = function () {
    return activos.filter(function (e) { return /hidroneum/i.test(String(e.nombre || '')) || /HIDRO/i.test(String(e.hoja_relacionada || '')); }).map(idDe);
  };
  var v = String(t.equipos_checklist === undefined || t.equipos_checklist === null ? '' : t.equipos_checklist).trim();
  if (v === 'HIDRO') return hidros();
  if (v === 'TODOS') return activos.map(idDe);
  if (v) return v.split(',').map(function (x) { return String(x).trim(); }).filter(String);
  var area = String(t.area_o_equipo_asociado || '').trim().toLowerCase();
  if (area) {
    var porArea = activos.filter(function (e) { return String(e.equipo_id).toLowerCase() === area || String(e.nombre || '').toLowerCase() === area; });
    if (porArea.length) return porArea.map(idDe);
  }
  if (/hidroneum/i.test(String(t.nombre_tarea || ''))) return hidros();
  return [];
}

/** Ids de equipos (de la lista dada) que ya tienen lectura registrada hoy. */
function equiposConLecturaHoy_(ids) {
  var fecha = fechaHoy_();
  var catalogo = {};
  obtenerCatalogoEquipos_().forEach(function (e) { catalogo[e.equipo_id] = e; });
  return ids.filter(function (id) {
    var eq = catalogo[id];
    if (!eq || !eq.hoja_relacionada || !ss_().getSheetByName(eq.hoja_relacionada)) return false;
    return leerTabla_(eq.hoja_relacionada).filas.some(function (f) { return soloFecha_(f.obj.fecha_hora) === fecha; });
  });
}

function cerrarTareaColaPorEquipo_(usuario, equipoId) {
  if (!equipoId) return;
  var catalogo = {};
  leerTabla_(HOJAS.CAT_TAREAS).filas.forEach(function (f) { catalogo[f.obj.tarea_id] = f.obj; });
  var equiposCat = obtenerCatalogoEquipos_();

  var fecha = fechaHoy_();
  var tabla = leerTabla_(HOJAS.COLA);
  var fila = null, equiposTarea = [];
  tabla.filas.forEach(function (f) {
    if (fila) return;
    var o = f.obj;
    if (soloFecha_(o.fecha) !== fecha) return;
    if (o.estado === 'Completada' || o.estado === 'Saltada') return;
    var t = catalogo[o.tarea_id];
    if (!t && o.tipo_origen === 'Extra') t = tareaDeExtraVinculado_(o);
    if (!t) return;
    var eqs = equiposDeTarea_(t, equiposCat);
    if (eqs.indexOf(equipoId) !== -1) { fila = f; equiposTarea = eqs; }
  });
  if (!fila) return;

  // Si la tarea cubre varios equipos (p. ej. todos los hidroneumáticos), se cierra sola
  // hasta que el último de ellos tenga su lectura del día.
  if (equiposTarea.length > 1) {
    var hechos = equiposConLecturaHoy_(equiposTarea);
    if (hechos.length < equiposTarea.length) return;
  }

  var ahora = new Date();
  var obj = fila.obj;
  var inicio = obj.hora_inicio ? new Date(obj.hora_inicio) : null;
  var segundosSesion = (inicio && !isNaN(inicio.getTime())) ? Math.max(0, Math.round((ahora - inicio) / 1000)) : 0;
  var minutos = Math.max(1, Math.round((segundosSesion + (Number(obj.tiempo_acumulado_segundos) || 0)) / 60));

  var camposCierre = {
    estado: 'Completada',
    hora_fin: ahora,
    tiempo_total_minutos: minutos,
    descripcion_realizada: 'Cerrada automáticamente al registrar la lectura de ' + (equiposTarea.length > 1 ? 'los equipos ' + equiposTarea.join(', ') : 'el equipo ' + equipoId) + '.'
  };
  if (!obj.usuario_asignado_actual) camposCierre.usuario_asignado_actual = usuario.id_usuario;
  if (!obj.hora_inicio) camposCierre.hora_inicio = ahora;
  escribirCamposFila_({ tabla: tabla, fila: fila }, camposCierre);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'COMPLETAR_TAREA_COLA_AUTO', HOJAS.COLA, obj.registro_id, '', 'Cierre automático por lectura de ' + equiposTarea.join(', '));
}

// --- Almacén ---

