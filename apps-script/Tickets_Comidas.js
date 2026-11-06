// Ticket abierto: no va dirigido a una persona; lo toma el primer técnico que se desocupe.
var TICKET_ABIERTO = 'ABIERTO';
var TICKET_ABIERTO_NOMBRE = 'Abierto — quien se desocupe primero';

/** Cuando un técnico toma un ticket abierto, el ticket queda a su nombre (para el historial y los reportes). */
// --- Fotos del "antes" en tickets (opcionales, máximo 5 por ticket) ---
var MAX_FOTOS_ANTES_TICKET = 5;

function carpetaFotosTickets_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CARPETA_FOTOS_TICKETS_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* se borró: crear de nuevo */ }
  }
  var carpeta = DriveApp.createFolder('MM103 - Fotos de Tickets (antes)');
  props.setProperty('CARPETA_FOTOS_TICKETS_ID', carpeta.getId());
  return carpeta;
}

function fotosAntesDeTicket_(t) {
  return String((t && t.fotos_antes_urls) || '').split('\n').map(function (x) { return x.trim(); }).filter(String);
}

/** Guarda en Drive las fotos [{ base64, mime, nombre }] y devuelve sus enlaces. */
function guardarFotosAntesTicket_(ticketId, fotos) {
  fotos = (fotos || []).filter(function (f) { return f && f.base64; });
  if (!fotos.length) return [];
  if (fotos.length > MAX_FOTOS_ANTES_TICKET) throw new Error('Puedes subir máximo ' + MAX_FOTOS_ANTES_TICKET + ' fotos por ticket.');
  var carpeta = carpetaFotosTickets_();
  var marca = new Date().getTime();
  return fotos.map(function (f, i) {
    if (String(f.base64).length > 7000000) throw new Error('Una de las imágenes es demasiado grande. Usa fotos más ligeras.');
    var blob = Utilities.newBlob(Utilities.base64Decode(f.base64), f.mime || 'image/jpeg', f.nombre || (ticketId + '-antes-' + (i + 1) + '.jpg'));
    var archivo = carpeta.createFile(blob);
    archivo.setName(ticketId + ' - antes ' + (i + 1) + ' - ' + marca);
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/thumbnail?sz=w1000&id=' + archivo.getId();
  });
}

function asignarTicketAbiertoSiAplica_(ticketId, usuario) {
  if (!ticketId) return;
  asegurarColumna_('TICKETS_INDICACIONES', 'era_abierto');
  var enc = buscarFilaPorValor_('TICKETS_INDICACIONES', 'ticket_id', ticketId, false);
  if (!enc || enc.fila.obj.dirigido_a !== TICKET_ABIERTO) return;
  setCell_(enc.tabla, enc.fila.indiceFila, 'dirigido_a', usuario.id_usuario);
  setCell_(enc.tabla, enc.fila.indiceFila, 'era_abierto', true); // para poder regresarlo a 'abierto' si lo detienen
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'TOMAR_TICKET_ABIERTO', 'TICKETS_INDICACIONES', ticketId, TICKET_ABIERTO, usuario.nombre_completo || usuario.id_usuario);
}

function generarIdTicket_() {
  var tabla = leerTabla_('TICKETS_INDICACIONES');
  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^TCK-(\d+)$/.exec(String(f.obj.ticket_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'TCK-' + ('00000' + (max + 1)).slice(-5);
}

function listarDestinatariosTicket(token) {
  var usuario = requiereSesion_(token);
  return leerTabla_(HOJAS.USUARIOS).filas.map(function (f) { return f.obj; })
    .filter(function (u) { return u.estado === 'Activo' && u.id_usuario !== usuario.id_usuario; })
    .map(function (u) { return { id_usuario: u.id_usuario, nombre_completo: u.nombre_completo, rol: u.rol }; })
    .sort(function (a, b) { return String(a.nombre_completo).localeCompare(String(b.nombre_completo)); });
}

function listarTickets(token) {
  var usuario = requiereSesion_(token);
  var tienePermiso = usuarioTienePermiso_(usuario, PERMISOS.ENVIAR_TICKET) ||
    usuarioTienePermiso_(usuario, PERMISOS.ATENDER_TICKET) ||
    usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  if (!tienePermiso) throw new Error('Tu perfil no tiene acceso a los tickets.');
  var esGeneral = usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS) || usuarioTienePermiso_(usuario, PERMISOS.ATENDER_TICKET);
  var pesoPrioridad = { Alta: 0, Media: 1, Baja: 2 };
  var usuarios = leerTabla_(HOJAS.USUARIOS).filas.map(function (f) { return f.obj; });
  function nombrePorId_(id) {
    if (id === TICKET_ABIERTO) return TICKET_ABIERTO_NOMBRE;
    var u = usuarios.filter(function (x) { return x.id_usuario === id; })[0];
    return u ? u.nombre_completo : id;
  }
  return leerTabla_('TICKETS_INDICACIONES').filas.map(function (f) { return f.obj; })
    .map(function (t) {
      t.creado_por_nombre = nombrePorId_(t.creado_por);
      t.dirigido_a_nombre = nombrePorId_(t.dirigido_a);
      return t;
    })
    .filter(function (t) {
      if (esGeneral) return true;
      return t.creado_por === usuario.id_usuario || t.dirigido_a === usuario.id_usuario || t.dirigido_a === TICKET_ABIERTO;
    })
    .sort(function (a, b) {
      if (a.estado !== b.estado) return a.estado === 'Abierto' ? -1 : 1;
      var pa = pesoPrioridad[a.prioridad] === undefined ? 9 : pesoPrioridad[a.prioridad];
      var pb = pesoPrioridad[b.prioridad] === undefined ? 9 : pesoPrioridad[b.prioridad];
      if (pa !== pb) return pa - pb;
      return new Date(b.fecha_hora_creacion) - new Date(a.fecha_hora_creacion);
    });
}

function crearTicket(token, datos) {
  var usuario = requierePermiso_(token, PERMISOS.ENVIAR_TICKET);
  var dirigidoA = String(datos && datos.dirigido_a || '').trim();
  var mensaje = String(datos && datos.mensaje || '').trim();
  var prioridad = String(datos && datos.prioridad || 'Media').trim();
  if (!dirigidoA) throw new Error('Selecciona a quién va dirigido el ticket.');
  if (!mensaje) throw new Error('Escribe el mensaje o indicación del ticket.');
  if (['Alta', 'Media', 'Baja'].indexOf(prioridad) === -1) prioridad = 'Media';
  var esAbierto = dirigidoA === TICKET_ABIERTO;
  var destino = esAbierto ? null : buscarFilaPorValor_(HOJAS.USUARIOS, 'id_usuario', dirigidoA, false);
  if (!esAbierto && !destino) throw new Error('El destinatario seleccionado ya no existe.');

  var sh = hoja_('TICKETS_INDICACIONES');
  var encabezados = encabezados_(sh);
  var ticketId = generarIdTicket_();
  var fotosAntes = guardarFotosAntesTicket_(ticketId, datos && datos.fotos);
  if (fotosAntes.length) {
    asegurarColumna_('TICKETS_INDICACIONES', 'fotos_antes_urls');
    encabezados = encabezados_(sh);
  }
  sh.appendRow(objetoAFila_(encabezados, {
    ticket_id: ticketId,
    fecha_hora_creacion: new Date(),
    creado_por: usuario.id_usuario,
    dirigido_a: dirigidoA,
    mensaje: mensaje,
    prioridad: prioridad,
    estado: 'Abierto',
    fecha_hora_atendido: '',
    trabajo_pausado_id: (datos && datos.trabajo_pausado_id) || '',
    fotos_antes_urls: fotosAntes.join('\n')
  }));

  asegurarColumna_(HOJAS.COLA, 'tipo_origen');
  asegurarColumna_(HOJAS.COLA, 'origen_id');
  asegurarColumna_(HOJAS.COLA, 'tiempo_acumulado_segundos');
  var shCola = hoja_(HOJAS.COLA);
  var encCola = encabezados_(shCola);
  var tablaCola = leerTabla_(HOJAS.COLA);
  var max = 0;
  tablaCola.filas.forEach(function (f) {
    var m = /^COLA-(\d+)$/.exec(String(f.obj.registro_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var registroColaId = 'COLA-' + ('00000' + (max + 1)).slice(-5);
  shCola.appendRow(objetoAFila_(encCola, {
    registro_id: registroColaId,
    fecha: fechaHoy_(),
    tarea_id: '',
    estado: 'Pendiente',
    usuario_asignado_actual: esAbierto ? '' : dirigidoA,
    hora_inicio: '',
    hora_fin: '',
    tiempo_total_minutos: '',
    codigo_salto: '',
    codigo_salto_confirmado: false,
    descripcion_realizada: '',
    tipo_origen: 'Ticket',
    origen_id: ticketId,
    tiempo_acumulado_segundos: 0
  }));

  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'CREAR_TICKET', 'TICKETS_INDICACIONES', ticketId, '', (esAbierto ? TICKET_ABIERTO_NOMBRE : destino.fila.obj.nombre_completo) + ': ' + mensaje);
  return { ok: true, ticket_id: ticketId, registro_cola_id: registroColaId, tickets: listarTickets(token), cola: construirColaDelDia_(fechaHoy_()) };
}

function atenderTicket(token, ticketId) {
  var usuario = requierePermiso_(token, PERMISOS.ATENDER_TICKET);
  var encontrado = buscarFilaPorValor_('TICKETS_INDICACIONES', 'ticket_id', ticketId, false);
  if (!encontrado) throw new Error('No existe el ticket "' + ticketId + '".');
  if (encontrado.fila.obj.estado === 'Atendido') throw new Error('Ese ticket ya fue atendido.');
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'estado', 'Atendido');
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'fecha_hora_atendido', new Date());
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'ATENDER_TICKET', 'TICKETS_INDICACIONES', ticketId, 'Abierto', 'Atendido por ' + usuario.nombre_completo);
  return { ok: true, tickets: listarTickets(token) };
}

/** Busca, si existe, el renglón de la cola de hoy que corresponde a un ticket. */
function buscarFilaColaPorTicket_(ticketId) {
  var tabla = leerTabla_(HOJAS.COLA);
  for (var i = 0; i < tabla.filas.length; i++) {
    if (tabla.filas[i].obj.tipo_origen === 'Ticket' && tabla.filas[i].obj.origen_id === ticketId) {
      return { tabla: tabla, fila: tabla.filas[i] };
    }
  }
  return null;
}

/**
 * Edita un ticket (mensaje, prioridad y/o destinatario) mientras siga Abierto.
 * Solo disponible para quien tiene permiso de crear tickets (ENVIAR_TICKET),
 * y siempre requiere un motivo, que queda en la bitácora de auditoría junto
 * con el usuario y la fecha/hora (registrados automáticamente).
 */
function editarTicket(token, ticketId, cambios) {
  var usuario = requierePermiso_(token, PERMISOS.ENVIAR_TICKET);
  var motivo = String(cambios && cambios.motivo || '').trim();
  if (!motivo) throw new Error('Escribe el motivo de la edición.');

  var encontrado = buscarFilaPorValor_('TICKETS_INDICACIONES', 'ticket_id', ticketId, false);
  if (!encontrado) throw new Error('No existe el ticket "' + ticketId + '".');
  var obj = encontrado.fila.obj;
  if (obj.estado !== 'Abierto') throw new Error('Solo se pueden editar tickets en estado Abierto.');

  var cambiosTexto = [];
  if (cambios.mensaje !== undefined && String(cambios.mensaje).trim() && String(cambios.mensaje).trim() !== obj.mensaje) {
    setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'mensaje', String(cambios.mensaje).trim());
    cambiosTexto.push('mensaje: "' + obj.mensaje + '" -> "' + String(cambios.mensaje).trim() + '"');
    obj.mensaje = String(cambios.mensaje).trim();
  }
  if (cambios.prioridad !== undefined && ['Alta', 'Media', 'Baja'].indexOf(cambios.prioridad) !== -1 && cambios.prioridad !== obj.prioridad) {
    setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'prioridad', cambios.prioridad);
    cambiosTexto.push('prioridad: ' + obj.prioridad + ' -> ' + cambios.prioridad);
    obj.prioridad = cambios.prioridad;
  }
  if (cambios.dirigido_a !== undefined && cambios.dirigido_a && cambios.dirigido_a !== obj.dirigido_a) {
    var destino = cambios.dirigido_a === TICKET_ABIERTO ? true : buscarFilaPorValor_(HOJAS.USUARIOS, 'id_usuario', cambios.dirigido_a, false);
    if (!destino) throw new Error('El destinatario seleccionado ya no existe.');
    var anteriorDirigidoA = obj.dirigido_a;
    setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'dirigido_a', cambios.dirigido_a);
    cambiosTexto.push('dirigido_a: ' + anteriorDirigidoA + ' -> ' + cambios.dirigido_a);
    obj.dirigido_a = cambios.dirigido_a;

    var colaEnc = buscarFilaColaPorTicket_(ticketId);
    if (colaEnc && colaEnc.fila.obj.estado === 'Pendiente') {
      setCell_(colaEnc.tabla, colaEnc.fila.indiceFila, 'usuario_asignado_actual', cambios.dirigido_a === TICKET_ABIERTO ? '' : cambios.dirigido_a);
    }
  }

  if (cambios.fotos_nuevas && cambios.fotos_nuevas.length) {
    asegurarColumna_('TICKETS_INDICACIONES', 'fotos_antes_urls');
    var encFotos = buscarFilaPorValor_('TICKETS_INDICACIONES', 'ticket_id', ticketId, false);
    var previas = fotosAntesDeTicket_(encFotos.fila.obj);
    if (previas.length + cambios.fotos_nuevas.length > MAX_FOTOS_ANTES_TICKET) throw new Error('El ticket ya tiene ' + previas.length + ' foto(s); el máximo es ' + MAX_FOTOS_ANTES_TICKET + '.');
    var nuevas = guardarFotosAntesTicket_(ticketId, cambios.fotos_nuevas);
    setCell_(encFotos.tabla, encFotos.fila.indiceFila, 'fotos_antes_urls', previas.concat(nuevas).join('\n'));
    cambiosTexto.push(nuevas.length + (nuevas.length === 1 ? ' foto del antes agregada' : ' fotos del antes agregadas'));
  }

  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EDITAR_TICKET', 'TICKETS_INDICACIONES', ticketId, 'Motivo: ' + motivo, cambiosTexto.join('; ') || '(sin cambios)');
  return { ok: true, tickets: listarTickets(token), cola: construirColaDelDia_(fechaHoy_()) };
}

/**
 * Cancela un ticket abierto (nunca uno ya atendido) y, si su tarea en la cola
 * de hoy sigue pendiente o en proceso, la cierra como "Saltada" conservando el
 * tiempo ya trabajado. Requiere motivo y solo lo puede hacer quien tiene
 * permiso de crear tickets (ENVIAR_TICKET). Queda en la bitácora de auditoría
 * con usuario, fecha/hora y motivo.
 */
function cancelarTicket(token, ticketId, motivo) {
  var usuario = requierePermiso_(token, PERMISOS.ENVIAR_TICKET);
  var motivoLimpio = String(motivo || '').trim();
  if (!motivoLimpio) throw new Error('Escribe el motivo de la cancelación.');

  var encontrado = buscarFilaPorValor_('TICKETS_INDICACIONES', 'ticket_id', ticketId, false);
  if (!encontrado) throw new Error('No existe el ticket "' + ticketId + '".');
  if (encontrado.fila.obj.estado === 'Atendido') throw new Error('Ese ticket ya fue atendido; no se puede cancelar.');
  if (encontrado.fila.obj.estado === 'Cancelado') throw new Error('Ese ticket ya está cancelado.');
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'estado', 'Cancelado');

  var colaEnc = buscarFilaColaPorTicket_(ticketId);
  if (colaEnc && colaEnc.fila.obj.estado !== 'Completada' && colaEnc.fila.obj.estado !== 'Saltada') {
    var camposCierre = { estado: 'Saltada', descripcion_realizada: 'Ticket cancelado: ' + motivoLimpio };
    if (colaEnc.fila.obj.estado === 'En proceso') {
      var ahora = new Date();
      var inicio = colaEnc.fila.obj.hora_inicio ? new Date(colaEnc.fila.obj.hora_inicio) : null;
      var segundos = (inicio && !isNaN(inicio.getTime())) ? Math.max(0, Math.round((ahora - inicio) / 1000)) : 0;
      camposCierre.tiempo_acumulado_segundos = (Number(colaEnc.fila.obj.tiempo_acumulado_segundos) || 0) + segundos;
      camposCierre.hora_inicio = '';
    }
    escribirCamposFila_(colaEnc, camposCierre);
  }

  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'CANCELAR_TICKET', 'TICKETS_INDICACIONES', ticketId, motivoLimpio, 'Cancelado');
  return { ok: true, tickets: listarTickets(token), cola: construirColaDelDia_(fechaHoy_()) };
}

// ----------------------------------------------------------------------------
// COMIDA — registro de inicio/fin del espacio de comida de cada técnico
// ----------------------------------------------------------------------------

function generarIdComida_() {
  var tabla = leerTabla_('COMIDAS_REGISTRO');
  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^COM-(\d+)$/.exec(String(f.obj.id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'COM-' + ('00000' + (max + 1)).slice(-5);
}

/**
 * Si el técnico tiene una tarea "En proceso" al momento de irse a comer, la pausa
 * automáticamente: guarda el tiempo acumulado hasta ese instante y la deja en
 * "Pendiente" (asignada a él mismo), lista para reanudarse exactamente donde se
 * quedó cuando termine su comida. Devuelve el registro_id pausado, o '' si no
 * tenía ninguna tarea en curso.
 */
function pausarTareaEnCursoPorComida_(usuario) {
  asegurarColumnasPausa_();
  var fecha = fechaHoy_();
  var tabla = leerTabla_(HOJAS.COLA);
  var fila = null;
  tabla.filas.forEach(function (f) {
    if (fila) return;
    if (soloFecha_(f.obj.fecha) === fecha && f.obj.estado === 'En proceso' && f.obj.usuario_asignado_actual === usuario.id_usuario) fila = f;
  });
  if (!fila) return '';
  // Queda "Pausado" con motivo; al regresar, el técnico lo continúa desde la cola.
  pausarFilaCola_({ tabla: tabla, fila: fila }, usuario, 'Hora de comida');
  return fila.obj.registro_id;
}

function iniciarComida(token) {
  var usuario = requierePermiso_(token, PERMISOS.EJECUTAR_TAREAS_COLA);
  var fecha = fechaHoy_();
  var tabla = leerTabla_('COMIDAS_REGISTRO');
  var abierta = tabla.filas.some(function (f) {
    return f.obj.usuario_id === usuario.id_usuario && soloFecha_(f.obj.fecha) === fecha && !f.obj.hora_fin;
  });
  if (abierta) throw new Error('Ya tienes un registro de comida abierto hoy.');

  var tareaPausada = pausarTareaEnCursoPorComida_(usuario);

  var sh = hoja_('COMIDAS_REGISTRO');
  var encabezados = encabezados_(sh);
  var id = generarIdComida_();
  sh.appendRow(objetoAFila_(encabezados, {
    id: id,
    usuario_id: usuario.id_usuario,
    fecha: fecha,
    hora_inicio: new Date(),
    hora_fin: ''
  }));
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'INICIAR_COMIDA', 'COMIDAS_REGISTRO', id, '', '');
  return { ok: true, id: id, tarea_pausada: tareaPausada, estado: obtenerEstadoComidaHoy(token), cola: tareaPausada ? construirColaDelDia_(fecha) : null };
}

function terminarComida(token) {
  var usuario = requierePermiso_(token, PERMISOS.EJECUTAR_TAREAS_COLA);
  var fecha = fechaHoy_();
  var tabla = leerTabla_('COMIDAS_REGISTRO');
  var fila = null;
  tabla.filas.forEach(function (f) {
    if (fila) return;
    if (f.obj.usuario_id === usuario.id_usuario && soloFecha_(f.obj.fecha) === fecha && !f.obj.hora_fin) fila = f;
  });
  if (!fila) throw new Error('No tienes un registro de comida abierto.');

  setCell_(tabla, fila.indiceFila, 'hora_fin', new Date());
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'TERMINAR_COMIDA', 'COMIDAS_REGISTRO', fila.obj.id, '', '');
  return { ok: true, estado: obtenerEstadoComidaHoy(token) };
}

function obtenerEstadoComidaHoy(token) {
  var usuario = requiereSesion_(token);
  var fecha = fechaHoy_();
  var tabla = leerTabla_('COMIDAS_REGISTRO');
  var fila = null;
  var acumuladoSegundosPrevios = 0;
  var sesionesPrevias = 0;
  tabla.filas.forEach(function (f) {
    if (f.obj.usuario_id !== usuario.id_usuario || soloFecha_(f.obj.fecha) !== fecha) return;
    if (!f.obj.hora_fin) { fila = f; return; }
    var ini = new Date(f.obj.hora_inicio), fin = new Date(f.obj.hora_fin);
    if (!isNaN(ini.getTime()) && !isNaN(fin.getTime())) {
      acumuladoSegundosPrevios += Math.max(0, Math.round((fin - ini) / 1000));
      sesionesPrevias++;
    }
  });
  return {
    enComida: !!fila,
    horaInicio: fila ? fila.obj.hora_inicio : '',
    acumuladoMinutosPrevios: Math.round(acumuladoSegundosPrevios / 60),
    sesionesPrevias: sesionesPrevias
  };
}

/** Resumen del día para todos los técnicos (para el módulo de control de comidas de administración). */
function listarComidasHoyTodos(token) {
  var usuario = requierePermiso_(token, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  var fecha = fechaHoy_();
  var nombresPorId = {};
  leerTabla_(HOJAS.USUARIOS).filas.forEach(function (f) { nombresPorId[f.obj.id_usuario] = f.obj.nombre_completo; });

  var porUsuario = {};
  leerTabla_('COMIDAS_REGISTRO').filas.forEach(function (f) {
    if (soloFecha_(f.obj.fecha) !== fecha) return;
    var id = f.obj.usuario_id;
    if (!porUsuario[id]) {
      porUsuario[id] = { usuario_id: id, nombre_completo: nombresPorId[id] || id, acumuladoSegundos: 0, enComida: false, horaInicio: '', sesiones: 0 };
    }
    if (!f.obj.hora_fin) {
      porUsuario[id].enComida = true;
      porUsuario[id].horaInicio = f.obj.hora_inicio;
    } else {
      var ini = new Date(f.obj.hora_inicio), fin = new Date(f.obj.hora_fin);
      if (!isNaN(ini.getTime()) && !isNaN(fin.getTime())) {
        porUsuario[id].acumuladoSegundos += Math.max(0, Math.round((fin - ini) / 1000));
        porUsuario[id].sesiones++;
      }
    }
  });
  return Object.keys(porUsuario).map(function (id) {
    var r = porUsuario[id];
    r.acumuladoMinutos = Math.round(r.acumuladoSegundos / 60);
    delete r.acumuladoSegundos;
    return r;
  }).sort(function (a, b) { return String(a.nombre_completo).localeCompare(String(b.nombre_completo)); });
}

// ----------------------------------------------------------------------------
// WEB APP
// ----------------------------------------------------------------------------

