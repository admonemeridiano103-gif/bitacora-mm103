/**
 * ============================================================================
 * BITÁCORA DE MANTENIMIENTO MM103 — Bloques 1-4 + autenticación propia (v15)
 * Modelo de datos, usuarios y permisos, cola de tareas diarias, checklist de
 * equipos + almacén con descuento automático, tickets/indicaciones, y login
 * propio por usuario y contraseña.
 * Condominio Maestro Meridiano 103
 *
 * Este script va AMARRADO a la hoja de cálculo "BD_Bitacora_Mantenimiento_MM103"
 * (Extensiones > Apps Script desde esa hoja). Es una aplicación nueva e
 * independiente del Apps Script del almacén.
 *
 * AUTENTICACIÓN: ya NO se usa la cuenta de Google de quien abre la app
 * (Session.getActiveUser). Cada persona tiene su propio usuario y contraseña,
 * elegidos por ella misma la primera vez que entra, después de comprobar que
 * es dueña del correo con el que el administrador la dio de alta (código de
 * 6 dígitos enviado por correo). El cliente guarda un token de sesión y lo
 * manda en cada llamada al servidor.
 *
 * ANTES DE USAR ESTA VERSIÓN: desde el editor de Apps Script, ejecuta UNA VEZ
 * la función prepararAutenticacion() (o usa el menú "Bitácora Mantenimiento >
 * Preparar usuario y contraseña" desde la hoja). Es segura de ejecutar varias
 * veces: si ya existe lo que necesita, no toca nada.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// CONFIGURACIÓN / CONSTANTES
// ----------------------------------------------------------------------------

var HOJAS = {
  USUARIOS: 'USUARIOS',
  ROLES: 'ROLES_PERMISOS',
  HORARIOS: 'HORARIOS',
  CONFIG: 'CONFIG_SISTEMA',
  LOG: 'LOG_AUDITORIA',
  SESIONES: 'SESIONES',
  CAT_TAREAS: 'CATALOGO_TAREAS_DIARIAS',
  CAT_PASOS: 'CATALOGO_PASOS_TAREA',
  CAT_MATERIALES: 'CATALOGO_MATERIALES_POR_TAREA',
  COLA: 'COLA_TRABAJO_DIARIO',
  EXTRA: 'TRABAJOS_EXTRA_PROGRAMADOS'
};

var ESTADOS_USUARIO = ['Activo', 'Inactivo'];

// Permisos que se requieren para cada acción administrativa de este bloque.
var PERMISOS = {
  ALTA_BAJA_USUARIOS: 'ALTA_BAJA_USUARIOS',
  EDITAR_PERMISOS_ROLES: 'EDITAR_PERMISOS_ROLES',
  CONFIGURAR_HORARIOS: 'CONFIGURAR_HORARIOS',
  CONFIGURAR_SISTEMA: 'CONFIGURAR_SISTEMA',
  CARGAR_MODIFICAR_TAREAS: 'CARGAR_MODIFICAR_TAREAS',
  GENERAR_CODIGO_SALTO: 'GENERAR_CODIGO_SALTO',
  EJECUTAR_TAREAS_COLA: 'EJECUTAR_TAREAS_COLA',
  REGISTRAR_LECTURA_EQUIPO: 'REGISTRAR_LECTURA_EQUIPO',
  REGISTRAR_ENTRADA_MATERIAL: 'REGISTRAR_ENTRADA_MATERIAL',
  REGISTRAR_SALIDA_MATERIAL: 'REGISTRAR_SALIDA_MATERIAL',
  REGISTRAR_CONSUMO_MATERIAL: 'REGISTRAR_CONSUMO_MATERIAL',
  AUDITORIA_INVENTARIO: 'AUDITORIA_INVENTARIO',
  ENVIAR_TICKET: 'ENVIAR_TICKET',
  ATENDER_TICKET: 'ATENDER_TICKET',
  CONTROL_CIERRE_GAS: 'CONTROL_CIERRE_GAS'
};

var ESTADOS_TAREA_COLA = ['Pendiente', 'En proceso', 'Completada', 'Saltada', 'Pausado'];
var ESTADOS_TRABAJO_EXTRA = ['Pendiente', 'En proceso', 'Completado', 'Cancelado'];
var ESTADOS_TICKET = ['Abierto', 'Atendido', 'Cancelado'];

// Parámetros de autenticación (usuario y contraseña propios, ya no Session.getActiveUser)
var DURACION_SESION_HORAS = 12;      // cuánto dura una sesión iniciada antes de pedir login otra vez
var DURACION_CODIGO_MINUTOS = 15;    // vigencia del código que se manda por correo
var LONGITUD_CODIGO = 6;             // dígitos del código de activación / recuperación
var MAX_INTENTOS_FALLIDOS = 5;       // intentos de contraseña antes de bloquear temporalmente
var BLOQUEO_MINUTOS = 15;            // cuánto dura el bloqueo temporal

// ----------------------------------------------------------------------------
// UTILIDADES DE HOJA DE CÁLCULO
// ----------------------------------------------------------------------------

function doGet(e) {
  var salida = HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Bitácora de Mantenimiento MM103')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
  // El ícono nunca debe impedir que la app abra: si algo falla, se queda sin ícono.
  try { salida.setFaviconUrl(urlIconoApp_()); } catch (err) { console.error('Icono de la app: ' + err); }
  return salida;
}

/**
 * Inserta el contenido de un archivo HTML del proyecto dentro de index.html
 * (estilos y módulos de JavaScript separados por tema).
 */
function incluir_(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Bitácora Mantenimiento')
    .addItem('Abrir panel de administración', 'menuAbrirPanel_')
    .addSeparator()
    .addItem('Preparar usuario y contraseña (una sola vez)', 'prepararAutenticacion')
    .addItem('Crear hojas de Bloque 2: tareas y cola de trabajo (una sola vez)', 'crearHojasBloque2')
    .addItem('Crear hojas de bloques futuros (una sola vez)', 'crearHojasFuturas')
    .addToUi();
}

function menuAbrirPanel_() {
  var html = HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif">Abre el panel desde la URL de la aplicación web publicada ' +
    '(Implementar &gt; Administrar implementaciones). Este menú es solo un recordatorio.</p>'
  ).setWidth(420).setHeight(140);
  SpreadsheetApp.getUi().showModalDialog(html, 'Panel de administración');
}

// ----------------------------------------------------------------------------
// PREPARACIÓN DE AUTENTICACIÓN — ejecutar UNA VEZ desde el editor o el menú.
// Agrega las columnas de usuario/contraseña a USUARIOS (si faltan) y crea la
// hoja SESIONES (si no existe). Es segura de ejecutar varias veces: si algo ya
// existe, se deja igual. Esta función se ejecuta desde el editor de Apps
// Script o el menú de la hoja (con la cuenta de quien tiene permiso de
// edición sobre la hoja de cálculo), no desde la app web — por eso no pide
// token.
// ----------------------------------------------------------------------------

function prepararAutenticacion() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (err) { ui = null; }

  var shUsuarios = hoja_(HOJAS.USUARIOS);
  var encabezados = encabezados_(shUsuarios);
  var columnasNuevas = [
    'usuario', 'password_hash', 'password_salt', 'cuenta_activada',
    'token_codigo', 'token_expira', 'intentos_fallidos', 'bloqueado_hasta'
  ];
  var agregadas = [];
  columnasNuevas.forEach(function (col) {
    encabezados = encabezados_(shUsuarios); // refrescar por si se agregó una columna en esta misma pasada
    if (encabezados.indexOf(col) === -1) {
      var siguienteCol = shUsuarios.getLastColumn() + 1;
      shUsuarios.getRange(1, siguienteCol).setValue(col)
        .setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
      agregadas.push(col);
    }
  });

  var libro = ss_();
  var shSesiones = libro.getSheetByName(HOJAS.SESIONES);
  var creoSesiones = false;
  if (!shSesiones) {
    shSesiones = libro.insertSheet(HOJAS.SESIONES);
    shSesiones.getRange(1, 1, 1, 4).setValues([['token_sesion', 'id_usuario', 'creado', 'expira']]);
    shSesiones.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    shSesiones.setFrozenRows(1);
    creoSesiones = true;
  }

  var mensaje =
    (agregadas.length ? 'Columnas agregadas a USUARIOS: ' + agregadas.join(', ') + '. ' : 'USUARIOS ya tenía todas las columnas de acceso. ') +
    (creoSesiones ? 'Se creó la hoja SESIONES.' : 'La hoja SESIONES ya existía.') +
    ' Cada persona ya dada de alta debe entrar a la app y usar "Primera vez / activar mi cuenta" con su correo para crear su usuario y contraseña.';

  try { registrarAuditoria_('', '(sistema)', 'PREPARAR_AUTENTICACION', 'SISTEMA', '', '', mensaje); } catch (err) { /* no truena si LOG_AUDITORIA no existe todavía */ }

  if (ui) { try { ui.alert(mensaje); } catch (err) { /* sin UI si se corre fuera del editor con hoja abierta */ } }
  return { ok: true, mensaje: mensaje, columnasAgregadas: agregadas, seCreoSesiones: creoSesiones };
}

// ----------------------------------------------------------------------------
// BLOQUES FUTUROS — crea únicamente los encabezados de las hojas que usarán
// los bloques 2+ (tareas, cola de trabajo, almacén, hidroneumáticos, etc.),
// para que el modelo de datos completo quede listo en este mismo archivo sin
// tener que volver a subir un libro nuevo. Es seguro ejecutarla varias veces:
// si una hoja ya existe, se deja igual.
// ----------------------------------------------------------------------------

function crearHojasFuturas(token) {
  var usuario = requierePermiso_(token, PERMISOS.CONFIGURAR_SISTEMA);
  var libro = ss_();
  var definiciones = [
    // NOTA: CATALOGO_TAREAS_DIARIAS, CATALOGO_PASOS_TAREA, CATALOGO_MATERIALES_POR_TAREA,
    // COLA_TRABAJO_DIARIO y TRABAJOS_EXTRA_PROGRAMADOS ya se implementaron en el Bloque 2
    // (ver crearHojasBloque2()) y se quitaron de esta lista para no duplicarlas.
    { nombre: 'TICKETS_INDICACIONES', encabezados: ['ticket_id', 'fecha_hora_creacion', 'creado_por', 'dirigido_a', 'mensaje', 'prioridad', 'estado', 'fecha_hora_atendido', 'trabajo_pausado_id'] },
    { nombre: 'PENDIENTES_PREVENTIVOS', encabezados: ['id', 'fecha_deteccion', 'detectado_por', 'area', 'tipo', 'foto_evidencia_url', 'material_disponible', 'material_faltante', 'estado', 'fecha_programada'] },
    { nombre: 'CALIFICACIONES_CIERRE_TURNO', encabezados: ['id', 'fecha', 'registro_cola_id', 'calificado_por', 'resultado', 'observaciones'] },
    { nombre: 'COMIDAS_REGISTRO', encabezados: ['id', 'usuario_id', 'fecha', 'hora_inicio', 'hora_fin'] },
    { nombre: 'ALMACEN_CATALOGO_MATERIALES', encabezados: ['material_id', 'nombre', 'unidad_medida', 'stock_actual', 'stock_minimo', 'ubicacion'] },
    { nombre: 'ALMACEN_MOVIMIENTOS', encabezados: ['movimiento_id', 'fecha_hora', 'material_id', 'tipo', 'cantidad', 'usuario_id', 'tarea_relacionada_id', 'notas'] },
    { nombre: 'ALMACEN_PRESTAMOS_HERRAMIENTA', encabezados: ['prestamo_id', 'herramienta_id', 'usuario_id', 'fecha_prestamo', 'fecha_devolucion_esperada', 'fecha_devolucion_real', 'estado'] },
    { nombre: 'EQUIPO_HIDRO_ALTA_PRESION', encabezados: ['registro_id', 'fecha_hora', 'psi', 'hz', 'amperes', 'bomba_activa', 'usuario_id', 'firma_evidencia_url'] },
    { nombre: 'EQUIPO_HIDRO_BAJA_PRESION', encabezados: ['registro_id', 'fecha_hora', 'psi', 'hz', 'amperes', 'bomba_activa', 'usuario_id', 'firma_evidencia_url'] },
    { nombre: 'EQUIPO_HIDRO_COMERCIO', encabezados: ['registro_id', 'fecha_hora', 'bomba_activa', 'psi_encendido_principal', 'psi_apagado_principal', 'amperes', 'psi_encendido_recuperacion', 'psi_apagado_recuperacion', 'usuario_id', 'firma_evidencia_url'] },
    { nombre: 'EQUIPO_PLANTA_ELECTRICA', encabezados: ['registro_id', 'fecha_hora', 'anticongelante_pct', 'diesel_pct', 'linea1', 'linea2', 'linea3', 'hz', 'rpm', 'tiempo_uso', 'bateria', 'temperatura', 'psi', 'usuario_id', 'firma_evidencia_url'] },
    { nombre: 'EQUIPO_PLANTA_INCENDIOS', encabezados: ['registro_id', 'fecha_hora', 'psi', 'rpm', 'amperes', 'temperatura', 'bateria', 'diesel_pct', 'usuario_id', 'firma_evidencia_url'] },
    { nombre: 'EQUIPO_CATALOGO', encabezados: ['equipo_id', 'nombre', 'hoja_relacionada', 'frecuencia_revision', 'activo'] },
    { nombre: 'EVIDENCIAS_FOTOS', encabezados: ['evidencia_id', 'fecha_hora', 'usuario_id', 'tipo', 'entidad_relacionada_id', 'url_drive'] },
    { nombre: 'MEJORAS_SOLICITADAS', encabezados: ['id', 'fecha', 'usuario_id', 'descripcion_mejora', 'estado', 'notas'] }
  ];

  var creadas = [];
  definiciones.forEach(function (def) {
    if (libro.getSheetByName(def.nombre)) return; // idempotente: no tocar si ya existe
    var sh = libro.insertSheet(def.nombre);
    sh.getRange(1, 1, 1, def.encabezados.length).setValues([def.encabezados]);
    sh.getRange(1, 1, 1, def.encabezados.length).setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    creadas.push(def.nombre);
  });

  // Semilla de EQUIPO_CATALOGO si se acaba de crear y sigue vacío.
  var catEquipo = libro.getSheetByName('EQUIPO_CATALOGO');
  if (catEquipo && catEquipo.getLastRow() === 1) {
    catEquipo.getRange(2, 1, 5, 5).setValues([
      ['EQ-001', 'Hidroneumático Alta Presión', 'EQUIPO_HIDRO_ALTA_PRESION', 'Diaria', true],
      ['EQ-002', 'Hidroneumático Baja Presión', 'EQUIPO_HIDRO_BAJA_PRESION', 'Diaria', true],
      ['EQ-003', 'Hidroneumático Comercio', 'EQUIPO_HIDRO_COMERCIO', 'Diaria', true],
      ['EQ-004', 'Planta Eléctrica de Emergencia', 'EQUIPO_PLANTA_ELECTRICA', 'Diaria', true],
      ['EQ-005', 'Planta Contra Incendios', 'EQUIPO_PLANTA_INCENDIOS', 'Diaria', true]
    ]);
  }

  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'CREAR_HOJAS_FUTURAS', 'SISTEMA', '', '', creadas.join(', ') || '(ninguna nueva, ya existían)');

  var mensaje = creadas.length
    ? 'Se crearon ' + creadas.length + ' hojas nuevas: ' + creadas.join(', ')
    : 'No se creó ninguna hoja nueva: todas ya existían.';
  try { SpreadsheetApp.getUi().alert(mensaje); } catch (err) { /* si se corre fuera del editor, no hay UI */ }
  return { ok: true, creadas: creadas };
}
