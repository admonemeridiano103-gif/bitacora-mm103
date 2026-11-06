/**
 * ============================================================================
 * API OFFLINE — Bitácora de Mantenimiento MM103
 * Fase 1 (30 oct 2026): login de dispositivo + snapshot.
 * Fase 2 (30 oct 2026): la app completa funciona desde la PWA.
 * ----------------------------------------------------------------------------
 * Archivo NUEVO: no modifica ninguna función existente; solo las llama.
 *
 * La PWA (GitHub Pages) manda POST con cuerpo JSON (Content-Type text/plain):
 *   { accion: 'ping' }
 *   { accion: 'fuente' }                       -> la interfaz completa (index + estilos + js_*)
 *   { accion: 'login', usuario, password, dispositivo }
 *   { accion: 'call', fn, args }               -> llama cualquier función pública de la app
 *   { accion: 'ops', ops: [{opId, fn, args, ts}] } -> cambios hechos sin internet (idempotente)
 *   { accion: 'snapshot', token }  /  { accion: 'cerrarSesion', token }
 *
 * - En args[0] la PWA manda su token de dispositivo (30 días); aquí se cambia por
 *   una sesión normal interna, así las funciones de siempre no se enteran.
 * - En 'ops', mientras corre la función, la hora del servidor se sustituye por la
 *   hora real en que el técnico hizo la acción (ts), para que hora_inicio,
 *   hora_fin, fechas de lecturas, etc. queden correctas aunque se suban después.
 * - Cada op se registra en SYNC_LOG con su opId: si llega dos veces, no se repite.
 * ============================================================================
 */

var API_OFFLINE_VERSION = 'F2.1-2026.10.30';
var HOJA_SYNC_LOG = 'SYNC_LOG';
var HOJA_SESIONES_DISPOSITIVO = 'SESIONES_DISPOSITIVO';
var DURACION_SESION_DISPOSITIVO_DIAS = 30;

// Funciones públicas que NO se pueden llamar desde la PWA (mantenimiento / disparadores).
var API_PROHIBIDAS = {
  doGet: 1, doPost: 1, onOpen: 1, prepararAutenticacion: 1, crearHojasFuturas: 1, crearHojasBloque2: 1,
  rolloverJornadaProgramado: 1, regenerarIconoApp: 1, prepararApiOffline: 1, probarApiOffline: 1
};
// Funciones públicas que no reciben token como primer argumento.
var API_SIN_TOKEN = { login: 1, solicitarCodigoAcceso: 1, crearCredenciales: 1, restablecerPassword: 1, obtenerPermisos: 1 };

function doPost(e) {
  var cuerpo;
  try {
    cuerpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return apiRespuesta_({ ok: false, mensaje: 'Solicitud inválida.' });
  }
  var t0 = Date.now();
  try {
    var r;
    switch (cuerpo.accion) {
      case 'ping': r = { ok: true, version: API_OFFLINE_VERSION, servidor: new Date().toISOString(), hoy: fechaHoy_() }; break;
      case 'fuente': r = apiFuente_(); break;
      case 'login': r = apiLogin_(cuerpo); break;
      case 'call': r = apiCall_(cuerpo.fn, cuerpo.args || []); break;
      case 'ops': r = apiOps_(cuerpo.ops || []); break;
      case 'snapshot': r = apiSnapshot_(cuerpo.token); break;
      case 'cerrarSesion': r = apiCerrarSesion_(cuerpo.token); break;
      default: r = { ok: false, mensaje: 'Acción no reconocida.' };
    }
    if (r && typeof r === 'object' && !Array.isArray(r)) r.ms_servidor = Date.now() - t0;
    return apiRespuesta_(r);
  } catch (err) {
    console.error('API offline: ' + (err && err.stack || err));
    var msg = String(err && err.message || err);
    return apiRespuesta_({ ok: false, mensaje: msg, sesion_invalida: esErrorSesionApi_(msg), ms_servidor: Date.now() - t0 });
  }
}

function esErrorSesionApi_(msg) {
  return /SESION_INVALIDA|sesi[oó]n expir|no es v[aá]lida|vuelve a iniciar sesi[oó]n|inicia sesi[oó]n de nuevo/i.test(String(msg || ''));
}

function apiRespuesta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Crea las hojas nuevas de la API si no existen. Idempotente. */
function asegurarHojasApiOffline_() {
  var libro = ss_();
  if (!libro.getSheetByName(HOJA_SESIONES_DISPOSITIVO)) {
    var s1 = libro.insertSheet(HOJA_SESIONES_DISPOSITIVO);
    s1.appendRow(['token_dispositivo', 'id_usuario', 'dispositivo', 'creada', 'expira', 'ultimo_uso', 'activa']);
    s1.setFrozenRows(1);
  }
  if (!libro.getSheetByName(HOJA_SYNC_LOG)) {
    var s2 = libro.insertSheet(HOJA_SYNC_LOG);
    s2.appendRow(['op_id', 'id_usuario', 'tipo', 'ts_dispositivo', 'recibida', 'resultado', 'detalle']);
    s2.setFrozenRows(1);
  }
}

/** Para ejecutar una vez a mano desde el editor (o lo hace solo el primer login). */
function prepararApiOffline() {
  asegurarHojasApiOffline_();
  return 'Hojas ' + HOJA_SESIONES_DISPOSITIVO + ' y ' + HOJA_SYNC_LOG + ' listas.';
}

/** Prueba sin escribir datos: confirma que la sustitución de hora funciona. */
function probarApiOffline() {
  var hace3h = Date.now() - 3 * 3600000;
  var dentro = conHoraDispositivo_(hace3h, function () {
    return { now: Date.now(), nuevo: new Date().getTime(), hoy: fechaHoy_(), esDate: (new Date() instanceof Date) };
  });
  var fuera = Date.now();
  var res = 'dentro desfase(min)=' + Math.round((fuera - dentro.now) / 60000) + ' nuevo=' + Math.round((fuera - dentro.nuevo) / 60000) +
    ' hoy=' + dentro.hoy + ' esDate=' + dentro.esDate + ' | restaurado=' + (Date.now() - fuera < 5000) + ' fuente=' + apiFuente_().html.length;
  console.log(res);
  return res;
}

// ----------------------------------------------------------------------------
// Interfaz completa
// ----------------------------------------------------------------------------
function apiFuente_() {
  var html = HtmlService.createTemplateFromFile('index').evaluate().getContent();
  var dig = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, html, Utilities.Charset.UTF_8);
  var hash = dig.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  return { ok: true, hash: hash, html: html, version: API_OFFLINE_VERSION };
}

// ----------------------------------------------------------------------------
// Sesión de dispositivo
// ----------------------------------------------------------------------------
function crearSesionDispositivo_(usuario, dispositivo, tokenNormal) {
  asegurarHojasApiOffline_();
  var tokenDisp = generarTokenSesion_();
  var ahora = new Date();
  var expira = new Date(ahora.getTime() + DURACION_SESION_DISPOSITIVO_DIAS * 86400000);
  hoja_(HOJA_SESIONES_DISPOSITIVO).appendRow([tokenDisp, usuario.id_usuario, String(dispositivo || '').slice(0, 120), ahora, expira, ahora, true]);
  var cache = CacheService.getScriptCache();
  cache.put('DISP_' + tokenDisp, JSON.stringify({ id_usuario: usuario.id_usuario, expira: expira.getTime() }), 600);
  if (tokenNormal) cache.put('APIT_' + tokenDisp, tokenNormal, 6 * 3600);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'LOGIN_APP_OFFLINE', 'SESIONES_DISPOSITIVO', '', '', String(dispositivo || ''));
  return { token: tokenDisp, expira: expira };
}

function apiLogin_(c) {
  var r = login(c.usuario, c.password); // reutiliza intentos fallidos, bloqueo, etc.
  if (!r || !r.ok) return r || { ok: false, mensaje: 'No se pudo iniciar sesión.' };
  var usuario = validarToken_(r.token);
  if (!usuario) return { ok: false, mensaje: 'No se pudo validar la sesión.' };
  var s = crearSesionDispositivo_(usuario, c.dispositivo, r.token);
  return { ok: true, token: s.token, expira: s.expira.toISOString(), usuario: usuarioParaCliente_(usuario) };
}

/** Devuelve { usuario, token } con una sesión normal válida, o null si no es token de dispositivo. */
function sesionDispositivo_(tokenDisp) {
  if (!tokenDisp || typeof tokenDisp !== 'string') return null;
  var cache = CacheService.getScriptCache();
  var info = null;
  var enCache = cache.get('DISP_' + tokenDisp);
  if (enCache) {
    info = JSON.parse(enCache);
  } else {
    var sh = ss_().getSheetByName(HOJA_SESIONES_DISPOSITIVO);
    if (!sh) return null;
    var enc = buscarFilaPorValor_(HOJA_SESIONES_DISPOSITIVO, 'token_dispositivo', tokenDisp, false);
    if (!enc) return null;
    var o = enc.fila.obj;
    var activa = (o.activa === true || o.activa === 'TRUE' || o.activa === 'VERDADERO');
    if (!activa) throw new Error('SESION_INVALIDA: cerraste sesión en este dispositivo, vuelve a entrar.');
    var expira = new Date(o.expira).getTime();
    // Renovación deslizante: solo escribe si ya pasó más de un día.
    if (expira - Date.now() < (DURACION_SESION_DISPOSITIVO_DIAS - 1) * 86400000 && expira > Date.now()) {
      expira = Date.now() + DURACION_SESION_DISPOSITIVO_DIAS * 86400000;
      escribirCamposFila_(enc, { expira: new Date(expira), ultimo_uso: new Date() });
    }
    info = { id_usuario: o.id_usuario, expira: expira };
    cache.put('DISP_' + tokenDisp, JSON.stringify(info), 600);
  }
  if (info.expira < Date.now()) throw new Error('SESION_INVALIDA: tu sesión expiró, vuelve a entrar.');
  var usuario = obtenerUsuarioPorId_(info.id_usuario);
  if (!usuario || usuario.estado !== 'Activo') throw new Error('SESION_INVALIDA: tu cuenta no está activa.');

  var interno = cache.get('APIT_' + tokenDisp);
  if (!interno || !validarToken_(interno)) {
    interno = crearSesion_(usuario.id_usuario);
    cache.put('APIT_' + tokenDisp, interno, 6 * 3600);
  }
  return { usuario: usuario, token: interno };
}

/** Compatibilidad con la Fase 1. */
function apiSesion_(tokenDisp) {
  var s = sesionDispositivo_(tokenDisp);
  if (!s) throw new Error('SESION_INVALIDA: inicia sesión de nuevo.');
  return s;
}

function apiCerrarSesion_(tokenDisp) {
  var sh = tokenDisp && ss_().getSheetByName(HOJA_SESIONES_DISPOSITIVO);
  var enc = sh && buscarFilaPorValor_(HOJA_SESIONES_DISPOSITIVO, 'token_dispositivo', tokenDisp, false);
  if (enc) escribirCamposFila_(enc, { activa: false, ultimo_uso: new Date() });
  var cache = CacheService.getScriptCache();
  var interno = cache.get('APIT_' + tokenDisp);
  if (interno) { try { cerrarSesion(interno); } catch (e) {} }
  cache.remove('APIT_' + tokenDisp);
  cache.remove('DISP_' + tokenDisp);
  return { ok: true };
}

// ----------------------------------------------------------------------------
// Llamadas a las funciones de la app
// ----------------------------------------------------------------------------
function apiFuncionPermitida_(fn) {
  return typeof fn === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(fn) && !API_PROHIBIDAS[fn] &&
    typeof globalThis[fn] === 'function';
}

/** Ejecuta fn(args) cambiando el token de dispositivo por una sesión interna. Lanza errores tal cual. */
function ejecutarFuncionApp_(fn, args) {
  if (!apiFuncionPermitida_(fn)) throw new Error('Función no disponible: ' + fn);
  args = Array.isArray(args) ? args.slice() : [];
  var tokenDisp = null;
  if (fn === 'cerrarSesion') return apiCerrarSesion_(args[0]);
  if (!API_SIN_TOKEN[fn] && args.length) {
    var s = sesionDispositivo_(args[0]);
    if (s) { tokenDisp = args[0]; args[0] = s.token; }
  }
  var r = globalThis[fn].apply(null, args);
  // Activar cuenta devuelve una sesión normal: se entrega token de dispositivo.
  if (fn === 'crearCredenciales' && r && r.ok && r.token) {
    var u = validarToken_(r.token);
    if (u) r.token = crearSesionDispositivo_(u, 'activación desde la app', r.token).token;
  }
  return r === undefined ? null : r;
}

function apiCall_(fn, args) {
  try {
    return { ok: true, resultado: ejecutarFuncionApp_(fn, args) };
  } catch (err) {
    var msg = String(err && err.message || err);
    return { ok: false, error: msg, sesion_invalida: esErrorSesionApi_(msg) };
  }
}

/**
 * Corre fn() con la hora del servidor sustituida por la hora del dispositivo (ts).
 * Solo si ts es del pasado (más de 1 minuto y menos de 7 días); si no, hora normal.
 */
function conHoraDispositivo_(ts, fn) {
  var Real = Date;
  var desfase = Number(ts) - Real.now();
  if (!ts || !isFinite(desfase) || desfase > -60000 || desfase < -7 * 86400000) return fn();
  var Falsa = (function (R, d) {
    return class extends R {
      constructor() {
        if (arguments.length === 0) super(R.now() + d);
        else super(...arguments);
      }
      static now() { return R.now() + d; }
    };
  })(Real, desfase);
  globalThis.Date = Falsa;
  try { return fn(); } finally { globalThis.Date = Real; }
}

function opYaAplicada_(opId) {
  var cache = CacheService.getScriptCache();
  var c = cache.get('OP_' + opId);
  if (c) return JSON.parse(c);
  var sh = ss_().getSheetByName(HOJA_SYNC_LOG);
  if (!sh || sh.getLastRow() < 2) return null;
  var celda = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(opId).matchEntireCell(true).findNext();
  if (!celda) return null;
  var fila = sh.getRange(celda.getRow(), 1, 1, 7).getValues()[0];
  return { ok: fila[5] === 'OK', duplicado: true, error: fila[5] === 'OK' ? '' : String(fila[6] || '') };
}

function apiOps_(ops) {
  asegurarHojasApiOffline_();
  var resultados = [];
  var log = hoja_(HOJA_SYNC_LOG);
  var cache = CacheService.getScriptCache();
  ops.slice(0, 20).forEach(function (op) {
    if (!op || !op.opId || !/^[A-Za-z0-9_-]{8,64}$/.test(op.opId)) {
      resultados.push({ opId: op && op.opId, ok: false, error: 'Operación sin identificador válido.' });
      return;
    }
    var previa = opYaAplicada_(op.opId);
    if (previa) { previa.opId = op.opId; previa.duplicado = true; resultados.push(previa); return; }

    var usuarioId = '';
    var r;
    try {
      var s = (!API_SIN_TOKEN[op.fn] && op.args && op.args.length) ? sesionDispositivo_(op.args[0]) : null;
      if (s) usuarioId = s.usuario.id_usuario;
      var valor = conHoraDispositivo_(op.ts, function () { return ejecutarFuncionApp_(op.fn, op.args || []); });
      r = { opId: op.opId, ok: true, resultado: valor };
    } catch (err) {
      var msg = String(err && err.message || err);
      r = { opId: op.opId, ok: false, error: msg, sesion_invalida: esErrorSesionApi_(msg) };
    }
    // Un error de sesión no se registra como aplicado: se reintenta cuando vuelva a entrar.
    if (!r.sesion_invalida) {
      log.appendRow([op.opId, usuarioId, op.fn, op.ts ? new Date(Number(op.ts)) : '', new Date(), r.ok ? 'OK' : 'ERROR', r.ok ? '' : r.error]);
      cache.put('OP_' + op.opId, JSON.stringify({ ok: r.ok, error: r.ok ? '' : r.error }), 21600);
    }
    resultados.push(r);
  });
  return { ok: true, resultados: resultados };
}

// ----------------------------------------------------------------------------
// Snapshot (Fase 1, se conserva)
// ----------------------------------------------------------------------------
function apiSnapshot_(tokenDisp) {
  var s = apiSesion_(tokenDisp);
  var t = s.token;
  var datos = {}, errores = {};
  function tomar(clave, fn) {
    try { datos[clave] = fn(); } catch (err) { errores[clave] = String(err && err.message || err); }
  }
  tomar('cola', function () { return listarColaDelDia(t); });
  tomar('checklist', function () { return listarChecklistEquiposDelDia(t); });
  tomar('definicion_lecturas', function () { return obtenerDefinicionLecturasEquipo(t); });
  tomar('almacen', function () { return listarAlmacen(t); });
  tomar('tickets', function () { return listarTickets(t); });
  tomar('comida', function () { return obtenerEstadoComidaHoy(t); });
  tomar('catalogo_tareas', function () { return listarCatalogoTareas(t); });
  tomar('pasos', function () { return obtenerCatalogoPasos_(); });
  tomar('materiales_tarea', function () { return obtenerCatalogoMateriales_(); });
  tomar('proximas', function () { return proximasRevisionesProgramadas(t); });
  return {
    ok: true, version: API_OFFLINE_VERSION, servidor: new Date().toISOString(), hoy: fechaHoy_(),
    usuario: usuarioParaCliente_(s.usuario), datos: datos, errores: errores
  };
}
