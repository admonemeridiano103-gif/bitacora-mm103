function rolesDisponibles_() {
  var encabezados = encabezados_(hoja_(HOJAS.ROLES));
  return encabezados.slice(2); // columna 1 = clave_permiso, columna 2 = descripcion
}

function rolesDisponibles(token) {
  var usuario = requiereSesion_(token);
  return rolesDisponibles_();
}

/** Devuelve { CLAVE_PERMISO: true/false, ... } para un rol dado. Cacheado 30 min; se invalida en actualizarPermiso(). */
function obtenerPermisos(rol) {
  var cache = CacheService.getScriptCache();
  var clave = 'PERMISOS_' + rol;
  var cacheado = cache.get(clave);
  if (cacheado) return JSON.parse(cacheado);

  var tabla = leerTabla_(HOJAS.ROLES);
  var permisos = {};
  tabla.filas.forEach(function (f) {
    permisos[f.obj.clave_permiso] = (f.obj[rol] === true || f.obj[rol] === 'TRUE' || f.obj[rol] === 'VERDADERO');
  });
  cache.put(clave, JSON.stringify(permisos), 1800);
  return permisos;
}

/** Matriz completa para pintar en el panel de administración. */
function obtenerMatrizPermisos(token) {
  var usuario = requiereSesion_(token);
  var tabla = leerTabla_(HOJAS.ROLES);
  var roles = rolesDisponibles_();
  return {
    roles: roles,
    filas: tabla.filas.map(function (f) {
      return {
        clave_permiso: f.obj.clave_permiso,
        descripcion: f.obj.descripcion,
        valores: roles.map(function (r) { return !!(f.obj[r] === true || f.obj[r] === 'TRUE'); })
      };
    })
  };
}

function actualizarPermiso(token, clavePermiso, rol, valor) {
  var usuario = requierePermiso_(token, PERMISOS.EDITAR_PERMISOS_ROLES);
  var roles = rolesDisponibles_();
  if (roles.indexOf(rol) === -1) throw new Error('El rol "' + rol + '" no existe en ROLES_PERMISOS.');
  var encontrado = buscarFilaPorValor_(HOJAS.ROLES, 'clave_permiso', clavePermiso, false);
  if (!encontrado) throw new Error('El permiso "' + clavePermiso + '" no existe.');
  var col = encontrado.tabla.encabezados.indexOf(rol) + 1;
  var anterior = !!encontrado.fila.obj[rol];
  encontrado.tabla.sh.getRange(encontrado.fila.indiceFila, col).setValue(!!valor);
  CacheService.getScriptCache().remove('PERMISOS_' + rol);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EDITAR_PERMISO', 'ROLES_PERMISOS', clavePermiso + '/' + rol, anterior, !!valor);
  return { ok: true };
}

function usuarioTienePermiso_(usuario, clavePermiso) {
  if (!usuario) return false;
  var permisos = obtenerPermisos(usuario.rol);
  return !!permisos[clavePermiso];
}

// ----------------------------------------------------------------------------
// AUTENTICACIÓN PROPIA (usuario y contraseña, ya NO Session.getActiveUser)
// ----------------------------------------------------------------------------
// Cada persona tiene su propio usuario y contraseña, elegidos por ella misma
// la primera vez que entra, después de comprobar que es dueña del correo con
// el que el administrador la dio de alta (código de 6 dígitos por correo).
// El cliente guarda el token de sesión en localStorage y lo manda en cada
// llamada. ANTES DE USAR: ejecutar una vez prepararAutenticacion().
// ----------------------------------------------------------------------------

function generarSal_() {
  return Utilities.getUuid();
}

/** SHA-256 de (password + ':' + sal), en hexadecimal. La contraseña nunca se guarda en claro. */
function hashPassword_(password, sal) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password) + ':' + String(sal));
  return bytes.map(function (b) {
    var v = (b + 256) % 256;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function generarCodigoVerificacion_() {
  var min = Math.pow(10, LONGITUD_CODIGO - 1);
  var max = Math.pow(10, LONGITUD_CODIGO) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

function generarTokenSesion_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function validarUsuario_(usuario) {
  var re = /^[a-z0-9._-]{3,20}$/;
  return re.test(String(usuario || '').trim().toLowerCase());
}

/** true si ya se ejecutó prepararAutenticacion() al menos una vez. */
function columnasAuthListas_() {
  var encabezados = encabezados_(hoja_(HOJAS.USUARIOS));
  return encabezados.indexOf('password_hash') !== -1 && !!ss_().getSheetByName(HOJAS.SESIONES);
}

var MENSAJE_AUTH_NO_PREPARADA_ =
  'El sistema todavía no está listo para usuario y contraseña. Pide a un administrador que ejecute ' +
  '"Preparar usuario y contraseña" desde el menú Bitácora Mantenimiento de la hoja de cálculo.';

function validarPassword_(password) {
  return String(password || '').length >= 8;
}

function enviarCorreoCodigo_(correo, nombre, codigo, tipo) {
  var asunto = tipo === 'activacion'
    ? 'Activa tu cuenta – Bitácora de Mantenimiento MM103'
    : 'Código para restablecer tu contraseña – Bitácora MM103';
  var cuerpo =
    'Hola ' + (nombre || '') + ',\n\n' +
    (tipo === 'activacion'
      ? 'Tu código para activar tu cuenta en la Bitácora de Mantenimiento MM103 es:\n\n'
      : 'Tu código para restablecer tu contraseña en la Bitácora de Mantenimiento MM103 es:\n\n') +
    '    ' + codigo + '\n\n' +
    'Este código vence en ' + DURACION_CODIGO_MINUTOS + ' minutos. Si tú no lo solicitaste, ignora este correo.\n\n' +
    'Condominio Maestro Meridiano 103';
  MailApp.sendEmail(correo, asunto, cuerpo);
}

// --------------------------------------------------------------------------------
// ACTIVACIÓN DE CUENTA Y RECUPERACIÓN DE CONTRASEÑA (sin sesión todavía)
// --------------------------------------------------------------------------------

/**
 * Primer paso, tanto para activar una cuenta nueva como para recuperar una
 * contraseña olvidada: se manda un código de 6 dígitos al correo con el que
 * el administrador dio de alta a la persona.
 */
/** Busca un usuario por correo o por nombre de usuario (detecta cuál es según si trae "@"). */
function buscarUsuarioPorIdentificador_(identificador) {
  identificador = String(identificador || '').trim();
  if (!identificador) return null;
  if (identificador.indexOf('@') !== -1) {
    return buscarFilaPorValor_(HOJAS.USUARIOS, 'correo', identificador.toLowerCase(), true);
  }
  return buscarFilaPorValor_(HOJAS.USUARIOS, 'usuario', identificador.toLowerCase(), true);
}

function solicitarCodigoAcceso(identificador) {
  if (!columnasAuthListas_()) return { ok: false, mensaje: MENSAJE_AUTH_NO_PREPARADA_ };
  identificador = String(identificador || '').trim();
  if (!identificador) return { ok: false, mensaje: 'Escribe tu correo o usuario.' };

  var encontrado = buscarUsuarioPorIdentificador_(identificador);
  if (!encontrado) {
    return { ok: false, mensaje: 'Ese correo o usuario no está dado de alta en la Bitácora. Pide a un administrador que te agregue primero.' };
  }
  var obj = encontrado.fila.obj;
  if (obj.estado !== 'Activo') {
    return { ok: false, mensaje: 'Tu cuenta está desactivada. Contacta a un administrador.' };
  }

  var codigo = generarCodigoVerificacion_();
  var expira = new Date(Date.now() + DURACION_CODIGO_MINUTOS * 60000);
  escribirCamposFila_(encontrado, { token_codigo: codigo, token_expira: expira });

  var yaTieneCredenciales = !!obj.password_hash;
  enviarCorreoCodigo_(obj.correo, obj.nombre_completo, codigo, yaTieneCredenciales ? 'recuperacion' : 'activacion');

  return {
    ok: true,
    yaActivada: yaTieneCredenciales,
    mensaje: 'Te enviamos un código a ' + obj.correo + '. Revisa tu bandeja de entrada (y spam); vence en ' + DURACION_CODIGO_MINUTOS + ' minutos.'
  };
}

/** Segundo paso para una cuenta NUEVA: valida el código y fija usuario + contraseña elegidos por la persona. */
function crearCredenciales(correo, codigo, usuarioDeseado, password) {
  if (!columnasAuthListas_()) throw new Error(MENSAJE_AUTH_NO_PREPARADA_);
  correo = String(correo || '').trim().toLowerCase();
  var encontrado = buscarFilaPorValor_(HOJAS.USUARIOS, 'correo', correo, true);
  if (!encontrado) throw new Error('Ese correo no está dado de alta.');
  var obj = encontrado.fila.obj;

  if (!obj.token_codigo || String(obj.token_codigo).trim() !== String(codigo).trim()) {
    throw new Error('El código no es correcto.');
  }
  if (!obj.token_expira || new Date(obj.token_expira).getTime() < Date.now()) {
    throw new Error('El código venció. Solicita uno nuevo.');
  }

  var usuario = String(usuarioDeseado || '').trim().toLowerCase();
  if (!validarUsuario_(usuario)) {
    throw new Error('El usuario debe tener entre 3 y 20 caracteres: letras, números, puntos, guiones o guion bajo, sin espacios.');
  }
  if (!validarPassword_(password)) {
    throw new Error('La contraseña debe tener al menos 8 caracteres.');
  }
  var choque = buscarFilaPorValor_(HOJAS.USUARIOS, 'usuario', usuario, true);
  if (choque && choque.fila.obj.id_usuario !== obj.id_usuario) {
    throw new Error('Ese nombre de usuario ya lo tiene alguien más. Elige otro.');
  }

  var sal = generarSal_();
  var hash = hashPassword_(password, sal);
  escribirCamposFila_(encontrado, {
    usuario: usuario,
    password_hash: hash,
    password_salt: sal,
    cuenta_activada: true,
    token_codigo: '',
    token_expira: '',
    intentos_fallidos: 0,
    bloqueado_hasta: ''
  });

  registrarAuditoria_(obj.id_usuario, correo, 'ACTIVAR_CUENTA', 'USUARIOS', obj.id_usuario, '', 'usuario=' + usuario);

  var token = crearSesion_(obj.id_usuario);
  return { ok: true, token: token, usuario: usuarioParaCliente_(obj) };
}

/** Segundo paso para RECUPERAR contraseña de una cuenta que ya existía. */
function restablecerPassword(identificador, codigo, nuevaPassword) {
  if (!columnasAuthListas_()) throw new Error(MENSAJE_AUTH_NO_PREPARADA_);
  identificador = String(identificador || '').trim();
  var encontrado = buscarUsuarioPorIdentificador_(identificador);
  if (!encontrado) throw new Error('Ese correo o usuario no está dado de alta.');
  var obj = encontrado.fila.obj;

  if (!obj.token_codigo || String(obj.token_codigo).trim() !== String(codigo).trim()) {
    throw new Error('El código no es correcto.');
  }
  if (!obj.token_expira || new Date(obj.token_expira).getTime() < Date.now()) {
    throw new Error('El código venció. Solicita uno nuevo.');
  }
  if (!validarPassword_(nuevaPassword)) {
    throw new Error('La contraseña debe tener al menos 8 caracteres.');
  }

  var sal = generarSal_();
  var hash = hashPassword_(nuevaPassword, sal);
  escribirCamposFila_(encontrado, {
    password_hash: hash,
    password_salt: sal,
    token_codigo: '',
    token_expira: '',
    intentos_fallidos: 0,
    bloqueado_hasta: ''
  });
  invalidarSesionesDeUsuario_(obj.id_usuario);
  registrarAuditoria_(obj.id_usuario, obj.correo, 'RESTABLECER_PASSWORD', 'USUARIOS', obj.id_usuario, '', '');
  return { ok: true };
}

// --------------------------------------------------------------------------------
// SESIÓN (login por usuario y contraseña, con token propio — ya no hay
// Session.getActiveUser()). El cliente guarda el token en localStorage y lo
// manda en cada llamada.
// --------------------------------------------------------------------------------

function crearSesion_(idUsuario) {
  var sh = hoja_(HOJAS.SESIONES);
  var token = generarTokenSesion_();
  var ahora = new Date();
  var expira = new Date(ahora.getTime() + DURACION_SESION_HORAS * 3600000);
  sh.appendRow([token, idUsuario, ahora, expira]);
  return token;
}

function obtenerUsuarioPorId_(idUsuario) {
  var cache = CacheService.getScriptCache();
  var clave = 'USR_' + idUsuario;
  var cacheado = cache.get(clave);
  if (cacheado) return JSON.parse(cacheado);

  var encontrado = buscarFilaPorValor_(HOJAS.USUARIOS, 'id_usuario', idUsuario, false);
  if (!encontrado) return null;
  cache.put(clave, JSON.stringify(encontrado.fila.obj), 600);
  return encontrado.fila.obj;
}

/** Se llama desde escribirCamposFila_ cuando se edita un renglón de USUARIOS. */
function invalidarCacheUsuario_(idUsuario) {
  if (idUsuario) CacheService.getScriptCache().remove('USR_' + idUsuario);
}

/** Valida un token contra SESIONES; si es válido, extiende la sesión (expiración deslizante). */
function validarToken_(token) {
  if (!token) return null;

  // Caché de sesión (10 min): evita leer y escribir la hoja SESIONES en cada llamada.
  // Si la sesión está en caché y no ha expirado, solo se valida que el usuario siga Activo.
  var cacheSes = CacheService.getScriptCache();
  var claveSes = 'SES_' + token;
  try {
    var enCache = cacheSes.get(claveSes);
    if (enCache) {
      var datosSes = JSON.parse(enCache);
      if (datosSes.expira > Date.now()) {
        var usuarioCache = obtenerUsuarioPorId_(datosSes.id_usuario);
        if (usuarioCache && usuarioCache.estado === 'Activo') return usuarioCache;
      }
      cacheSes.remove(claveSes);
    }
  } catch (e) { /* si falla la caché, se valida contra la hoja como siempre */ }

  var encontrado = buscarFilaPorValor_(HOJAS.SESIONES, 'token_sesion', token, false);
  if (!encontrado) return null;
  if (new Date(encontrado.fila.obj.expira).getTime() < Date.now()) return null;

  var usuario = obtenerUsuarioPorId_(encontrado.fila.obj.id_usuario);
  if (!usuario || usuario.estado !== 'Activo') return null;

  var nuevaExpira = new Date(Date.now() + DURACION_SESION_HORAS * 3600000);
  var colExpira = encontrado.tabla.encabezados.indexOf('expira') + 1;
  encontrado.tabla.sh.getRange(encontrado.fila.indiceFila, colExpira).setValue(nuevaExpira);

  try {
    cacheSes.put(claveSes, JSON.stringify({ id_usuario: usuario.id_usuario, expira: nuevaExpira.getTime() }), 600);
  } catch (e) { /* sin caché: la siguiente llamada vuelve a validar contra la hoja */ }

  return usuario;
}

function requiereSesion_(token) {
  var usuario = validarToken_(token);
  if (!usuario) throw new Error('Tu sesión expiró o no es válida. Vuelve a iniciar sesión.');
  return usuario;
}

function requierePermiso_(token, clavePermiso) {
  var usuario = requiereSesion_(token);
  if (!usuarioTienePermiso_(usuario, clavePermiso)) {
    throw new Error('Tu perfil (' + usuario.rol + ') no tiene el permiso "' + clavePermiso + '" para hacer esto.');
  }
  return usuario;
}

function invalidarSesionesDeUsuario_(idUsuario) {
  var tabla = leerTabla_(HOJAS.SESIONES);
  for (var i = tabla.filas.length - 1; i >= 0; i--) {
    if (tabla.filas[i].obj.id_usuario === idUsuario) {
      try { CacheService.getScriptCache().remove('SES_' + tabla.filas[i].obj.token_sesion); } catch (e) { }
      tabla.sh.deleteRow(tabla.filas[i].indiceFila);
    }
  }
}

/** Forma reducida y segura del usuario que sí se manda al navegador. */
function usuarioParaCliente_(obj) {
  return {
    id_usuario: obj.id_usuario,
    nombre_completo: obj.nombre_completo,
    correo: obj.correo,
    usuario: obj.usuario,
    rol: obj.rol,
    codigo_personal: obj.codigo_personal,
    estado: obj.estado,
    horario_id: obj.horario_id,
    permisos: obtenerPermisos(obj.rol)
  };
}

/** Login con usuario y contraseña. Devuelve token de sesión si es correcto. */
function login(usuario, password) {
  if (!columnasAuthListas_()) return { ok: false, mensaje: MENSAJE_AUTH_NO_PREPARADA_ };
  usuario = String(usuario || '').trim().toLowerCase();
  var encontrado = buscarFilaPorValor_(HOJAS.USUARIOS, 'usuario', usuario, true);
  if (!encontrado) return { ok: false, mensaje: 'Usuario o contraseña incorrectos.' };

  var obj = encontrado.fila.obj;
  if (obj.estado !== 'Activo') {
    return { ok: false, mensaje: 'Tu cuenta está desactivada. Contacta a un administrador.' };
  }
  if (obj.bloqueado_hasta && new Date(obj.bloqueado_hasta).getTime() > Date.now()) {
    return { ok: false, mensaje: 'Cuenta bloqueada temporalmente por varios intentos fallidos. Espera unos minutos o recupera tu contraseña.' };
  }
  if (!obj.password_hash) {
    return { ok: false, mensaje: 'Todavía no activas tu cuenta. Usa la opción "Primera vez / activar mi cuenta".' };
  }

  var hash = hashPassword_(password, obj.password_salt);
  if (hash !== obj.password_hash) {
    var intentos = (parseInt(obj.intentos_fallidos, 10) || 0) + 1;
    var campos = { intentos_fallidos: intentos };
    if (intentos >= MAX_INTENTOS_FALLIDOS) {
      campos.bloqueado_hasta = new Date(Date.now() + BLOQUEO_MINUTOS * 60000);
      campos.intentos_fallidos = 0;
    }
    escribirCamposFila_(encontrado, campos);
    return { ok: false, mensaje: 'Usuario o contraseña incorrectos.' };
  }

  escribirCamposFila_(encontrado, { intentos_fallidos: 0, bloqueado_hasta: '' });
  var token = crearSesion_(obj.id_usuario);
  registrarAuditoria_(obj.id_usuario, obj.correo, 'LOGIN', 'USUARIOS', obj.id_usuario, '', '');
  return { ok: true, token: token, usuario: usuarioParaCliente_(obj) };
}

/** El cliente llama esto al abrir la app (con el token guardado en localStorage, si tiene uno). */
function validarSesion(token) {
  var usuario = validarToken_(token);
  if (!usuario) return { ok: false, motivo: 'SESION_INVALIDA', mensaje: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
  return { ok: true, usuario: usuarioParaCliente_(usuario) };
}

function cerrarSesion(token) {
  try { CacheService.getScriptCache().remove('SES_' + token); } catch (e) { }
  var encontrado = buscarFilaPorValor_(HOJAS.SESIONES, 'token_sesion', token, false);
  if (encontrado) {
    var usuario = obtenerUsuarioPorId_(encontrado.fila.obj.id_usuario);
    encontrado.tabla.sh.deleteRow(encontrado.fila.indiceFila);
    if (usuario) registrarAuditoria_(usuario.id_usuario, usuario.correo, 'LOGOUT', 'USUARIOS', usuario.id_usuario, '', '');
  }
  return { ok: true };
}

/** Cambiar mi propia contraseña, ya con sesión iniciada. */
function cambiarMiPassword(token, passwordActual, passwordNueva) {
  var usuario = requiereSesion_(token);
  var encontrado = buscarFilaPorValor_(HOJAS.USUARIOS, 'id_usuario', usuario.id_usuario, false);
  var hashActual = hashPassword_(passwordActual, encontrado.fila.obj.password_salt);
  if (hashActual !== encontrado.fila.obj.password_hash) throw new Error('Tu contraseña actual no es correcta.');
  if (!validarPassword_(passwordNueva)) throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');

  var sal = generarSal_();
  var hash = hashPassword_(passwordNueva, sal);
  escribirCamposFila_(encontrado, { password_hash: hash, password_salt: sal });
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'CAMBIAR_PASSWORD', 'USUARIOS', usuario.id_usuario, '', '');
  return { ok: true };
}

/** Cambiar mi propio nombre de usuario, ya con sesión iniciada. */
function cambiarMiUsuario(token, nuevoUsuario) {
  var usuario = requiereSesion_(token);
  nuevoUsuario = String(nuevoUsuario || '').trim().toLowerCase();
  if (!validarUsuario_(nuevoUsuario)) {
    throw new Error('El usuario debe tener entre 3 y 20 caracteres: letras, números, puntos, guiones o guion bajo, sin espacios.');
  }
  var choque = buscarFilaPorValor_(HOJAS.USUARIOS, 'usuario', nuevoUsuario, true);
  if (choque && choque.fila.obj.id_usuario !== usuario.id_usuario) {
    throw new Error('Ese nombre de usuario ya lo tiene alguien más.');
  }
  var encontrado = buscarFilaPorValor_(HOJAS.USUARIOS, 'id_usuario', usuario.id_usuario, false);
  var anterior = encontrado.fila.obj.usuario;
  escribirCamposFila_(encontrado, { usuario: nuevoUsuario });
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'CAMBIAR_USUARIO', 'USUARIOS', usuario.id_usuario, anterior, nuevoUsuario);
  return { ok: true, usuario: nuevoUsuario };
}

// ----------------------------------------------------------------------------
// GENERADORES DE ID / CÓDIGO PERSONAL
// ----------------------------------------------------------------------------

function generarIdUsuario_() {
  var tabla = leerTabla_(HOJAS.USUARIOS);
  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^USR-(\d+)$/.exec(String(f.obj.id_usuario || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var siguiente = max + 1;
  return 'USR-' + ('000' + siguiente).slice(-3);
}

function generarCodigoPersonal_() {
  var longitud = parseInt(obtenerConfig_('LONGITUD_CODIGO_PERSONAL', 4), 10) || 4;
  var tabla = leerTabla_(HOJAS.USUARIOS);
  var existentes = {};
  tabla.filas.forEach(function (f) {
    if (f.obj.codigo_personal !== '') existentes[String(f.obj.codigo_personal)] = true;
  });
  var min = Math.pow(10, longitud - 1);
  var max = Math.pow(10, longitud) - 1;
  for (var intento = 0; intento < 200; intento++) {
    var candidato = String(Math.floor(min + Math.random() * (max - min + 1)));
    if (!existentes[candidato]) return candidato;
  }
  throw new Error('No fue posible generar un código personal único. Revisa la hoja USUARIOS.');
}

// ----------------------------------------------------------------------------
// USUARIOS — ALTA / EDICIÓN / BAJA LÓGICA / CONSULTA
// ----------------------------------------------------------------------------

/** Igual que el objeto de fila crudo pero sin campos sensibles (password_hash, password_salt,
 * token_codigo, token_expira, intentos_fallidos, bloqueado_hasta): evita exponerlos al cliente. */
function usuarioParaListado_(obj) {
  return {
    id_usuario: obj.id_usuario, nombre_completo: obj.nombre_completo, correo: obj.correo,
    usuario: obj.usuario, rol: obj.rol, codigo_personal: obj.codigo_personal,
    estado: obj.estado, telefono: obj.telefono, horario_id: obj.horario_id, notas: obj.notas,
    fecha_alta: obj.fecha_alta, fecha_baja: obj.fecha_baja,
    cuenta_activada: !!obj.cuenta_activada || !!obj.password_hash
  };
}

function listarUsuarios(token, soloActivos) {
  var usuario = requiereSesion_(token);
  var tabla = leerTabla_(HOJAS.USUARIOS);
  var filas = tabla.filas.map(function (f) { return usuarioParaListado_(f.obj); });
  if (soloActivos) filas = filas.filter(function (u) { return u.estado === 'Activo'; });
  return filas;
}

function obtenerUsuario(token, idUsuario) {
  var usuario = requiereSesion_(token);
  var encontrado = buscarFilaPorValor_(HOJAS.USUARIOS, 'id_usuario', idUsuario, false);
  return encontrado ? usuarioParaListado_(encontrado.fila.obj) : null;
}

function altaUsuario(token, datos) {
  var usuario = requierePermiso_(token, PERMISOS.ALTA_BAJA_USUARIOS);

  var nombre = String(datos && datos.nombre_completo || '').trim();
  var correo = String(datos && datos.correo || '').trim().toLowerCase();
  var rol = String(datos && datos.rol || '').trim();

  if (!nombre) throw new Error('Falta el nombre completo.');
  if (!validarCorreo_(correo)) throw new Error('El correo "' + correo + '" no es válido.');
  var roles = rolesDisponibles_();
  if (roles.indexOf(rol) === -1) throw new Error('El rol debe ser uno de: ' + roles.join(', '));

  var yaExiste = buscarFilaPorValor_(HOJAS.USUARIOS, 'correo', correo, true);
  if (yaExiste) {
    throw new Error('Ya existe un usuario con ese correo (estado: ' + yaExiste.fila.obj.estado +
      '). Si estaba inactivo, reactívalo en vez de crear uno nuevo.');
  }

  var sh = hoja_(HOJAS.USUARIOS);
  var encabezados = encabezados_(sh);
  var nuevo = {
    id_usuario: generarIdUsuario_(),
    nombre_completo: nombre,
    correo: correo,
    rol: rol,
    codigo_personal: generarCodigoPersonal_(),
    estado: 'Activo',
    telefono: datos.telefono || '',
    fecha_alta: new Date(),
    fecha_baja: '',
    horario_id: datos.horario_id || '',
    notas: datos.notas || ''
  };
  sh.appendRow(objetoAFila_(encabezados, nuevo));
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'ALTA_USUARIO', 'USUARIOS', nuevo.id_usuario, '', correo + ' / ' + rol);
  return nuevo;
}

/**
 * cambios puede incluir: nombre_completo, correo, rol, telefono, horario_id, notas.
 * No permite cambiar id_usuario, estado, fecha_alta, fecha_baja ni codigo_personal
 * (para eso están cambiarEstadoUsuario y regenerarCodigoUsuario).
 */
function editarUsuario(token, idUsuario, cambios) {
  var usuario = requierePermiso_(token, PERMISOS.ALTA_BAJA_USUARIOS);
  var encontrado = buscarFilaPorValor_(HOJAS.USUARIOS, 'id_usuario', idUsuario, false);
  if (!encontrado) throw new Error('No existe el usuario "' + idUsuario + '".');

  var CAMPOS_EDITABLES = ['nombre_completo', 'correo', 'usuario', 'rol', 'telefono', 'horario_id', 'notas'];
  var tabla = encontrado.tabla;
  var obj = encontrado.fila.obj;

  if (cambios.correo !== undefined) {
    var nuevoCorreo = String(cambios.correo).trim().toLowerCase();
    if (!validarCorreo_(nuevoCorreo)) throw new Error('El correo "' + nuevoCorreo + '" no es válido.');
    if (nuevoCorreo !== obj.correo) {
      var choque = buscarFilaPorValor_(HOJAS.USUARIOS, 'correo', nuevoCorreo, true);
      if (choque) throw new Error('Ese correo ya lo usa otro usuario.');
    }
    cambios.correo = nuevoCorreo;
  }
  if (cambios.usuario !== undefined) {
    var nuevoUsuario = String(cambios.usuario).trim().toLowerCase();
    if (nuevoUsuario === '') {
      delete cambios.usuario;
    } else {
      if (!validarUsuario_(nuevoUsuario)) {
        throw new Error('El usuario debe tener entre 3 y 20 caracteres: letras, números, puntos, guiones o guion bajo, sin espacios.');
      }
      if (nuevoUsuario !== obj.usuario) {
        var choqueUsuario = buscarFilaPorValor_(HOJAS.USUARIOS, 'usuario', nuevoUsuario, true);
        if (choqueUsuario && choqueUsuario.fila.obj.id_usuario !== obj.id_usuario) {
          throw new Error('Ese nombre de usuario ya lo tiene alguien más. Elige otro.');
        }
      }
      cambios.usuario = nuevoUsuario;
    }
  }
  if (cambios.rol !== undefined) {
    var roles = rolesDisponibles_();
    if (roles.indexOf(cambios.rol) === -1) throw new Error('El rol debe ser uno de: ' + roles.join(', '));
  }

  var cambiosAplicados = [];
  CAMPOS_EDITABLES.forEach(function (campo) {
    if (cambios[campo] !== undefined && String(cambios[campo]) !== String(obj[campo])) {
      var col = tabla.encabezados.indexOf(campo) + 1;
      tabla.sh.getRange(encontrado.fila.indiceFila, col).setValue(cambios[campo]);
      cambiosAplicados.push({ campo: campo, anterior: obj[campo], nuevo: cambios[campo] });
      obj[campo] = cambios[campo];
    }
  });

  cambiosAplicados.forEach(function (c) {
    registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EDITAR_USUARIO', 'USUARIOS', idUsuario, campoTexto_(c.campo, c.anterior), campoTexto_(c.campo, c.nuevo));
  });

  return usuarioParaListado_(obj);
}

function cambiarEstadoUsuario(token, idUsuario, nuevoEstado, motivo) {
  var usuario = requierePermiso_(token, PERMISOS.ALTA_BAJA_USUARIOS);
  if (ESTADOS_USUARIO.indexOf(nuevoEstado) === -1) {
    throw new Error('Estado inválido. Usa: ' + ESTADOS_USUARIO.join(' o '));
  }
  var encontrado = buscarFilaPorValor_(HOJAS.USUARIOS, 'id_usuario', idUsuario, false);
  if (!encontrado) throw new Error('No existe el usuario "' + idUsuario + '".');

  var tabla = encontrado.tabla;
  var obj = encontrado.fila.obj;
  var estadoAnterior = obj.estado;
  var colEstado = tabla.encabezados.indexOf('estado') + 1;
  var colBaja = tabla.encabezados.indexOf('fecha_baja') + 1;

  tabla.sh.getRange(encontrado.fila.indiceFila, colEstado).setValue(nuevoEstado);
  if (nuevoEstado === 'Inactivo') {
    tabla.sh.getRange(encontrado.fila.indiceFila, colBaja).setValue(new Date());
  } else {
    tabla.sh.getRange(encontrado.fila.indiceFila, colBaja).setValue('');
  }

  registrarAuditoria_(usuario.id_usuario, usuario.correo, 
    nuevoEstado === 'Inactivo' ? 'BAJA_USUARIO' : 'REACTIVAR_USUARIO',
    'USUARIOS', idUsuario, estadoAnterior, nuevoEstado + (motivo ? ' (' + motivo + ')' : '')
  );
  return { ok: true, id_usuario: idUsuario, estado: nuevoEstado };
}

function regenerarCodigoUsuario(token, idUsuario) {
  var usuario = requierePermiso_(token, PERMISOS.ALTA_BAJA_USUARIOS);
  var encontrado = buscarFilaPorValor_(HOJAS.USUARIOS, 'id_usuario', idUsuario, false);
  if (!encontrado) throw new Error('No existe el usuario "' + idUsuario + '".');
  var tabla = encontrado.tabla;
  var col = tabla.encabezados.indexOf('codigo_personal') + 1;
  var anterior = encontrado.fila.obj.codigo_personal;
  var nuevo = generarCodigoPersonal_();
  tabla.sh.getRange(encontrado.fila.indiceFila, col).setValue(nuevo);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'REGENERAR_CODIGO', 'USUARIOS', idUsuario, anterior, nuevo);
  return { ok: true, codigo_personal: nuevo };
}

// ----------------------------------------------------------------------------
// HORARIOS (100% configurables, ver nota en la hoja)
// ----------------------------------------------------------------------------

function listarHorarios(token) {
  var usuario = requiereSesion_(token);
  return leerTabla_(HOJAS.HORARIOS).filas.map(function (f) { return f.obj; });
}

function guardarHorario(token, datos) {
  var usuario = requierePermiso_(token, PERMISOS.CONFIGURAR_HORARIOS);
  var sh = hoja_(HOJAS.HORARIOS);
  var encabezados = encabezados_(sh);

  if (datos.horario_id) {
    var encontrado = buscarFilaPorValor_(HOJAS.HORARIOS, 'horario_id', datos.horario_id, false);
    if (!encontrado) throw new Error('No existe el horario "' + datos.horario_id + '".');
    var anterior = JSON.stringify(encontrado.fila.obj);
    encabezados.forEach(function (h, idx) {
      if (h === 'horario_id') return;
      if (datos[h] !== undefined) {
        encontrado.tabla.sh.getRange(encontrado.fila.indiceFila, idx + 1).setValue(datos[h]);
      }
    });
    registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EDITAR_HORARIO', 'HORARIOS', datos.horario_id, anterior, JSON.stringify(datos));
    return { ok: true, horario_id: datos.horario_id };
  }

  var tabla = leerTabla_(HOJAS.HORARIOS);
  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^HOR-(\d+)$/.exec(String(f.obj.horario_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var nuevoId = 'HOR-' + ('000' + (max + 1)).slice(-3);
  var nuevo = {
    horario_id: nuevoId,
    nombre_horario: datos.nombre_horario || '',
    dias_aplicables: datos.dias_aplicables || '',
    hora_entrada: datos.hora_entrada || '',
    hora_salida: datos.hora_salida || '',
    usuario_id_asignado: datos.usuario_id_asignado || '',
    activo: datos.activo === undefined ? true : !!datos.activo
  };
  sh.appendRow(objetoAFila_(encabezados, nuevo));
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'ALTA_HORARIO', 'HORARIOS', nuevoId, '', JSON.stringify(nuevo));
  return nuevo;
}

// ----------------------------------------------------------------------------
// AUDITORÍA — lectura para el panel
// ----------------------------------------------------------------------------

function listarAuditoriaReciente(token, limite) {
  var usuario = requiereSesion_(token);
  var tabla = leerTabla_(HOJAS.LOG);
  var filas = tabla.filas.map(function (f) { return f.obj; });
  filas.reverse();
  return filas.slice(0, limite || 100);
}


// ----------------------------------------------------------------------------
// BLOQUE 2 — CATÁLOGO DE TAREAS DIARIAS, PASOS, MATERIALES Y TRABAJOS PROGRAMADOS
// ----------------------------------------------------------------------------

