function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function hoja_(nombre) {
  var sh = ss_().getSheetByName(nombre);
  if (!sh) {
    throw new Error('No existe la hoja "' + nombre + '". Revisa el modelo de datos.');
  }
  return sh;
}

function encabezados_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0];
}

function filaAObjeto_(encabezados, fila) {
  var obj = {};
  for (var i = 0; i < encabezados.length; i++) {
    var v = fila[i];
    // Las celdas con formato de fecha llegan como objetos Date nativos.
    // google.script.run no los serializa de forma confiable (el cliente
    // recibe null en vez de un error), así que se convierten a texto ISO
    // antes de que el objeto salga de esta función.
    if (v instanceof Date) v = v.toISOString();
    obj[encabezados[i]] = v;
  }
  return obj;
}

function objetoAFila_(encabezados, obj) {
  return encabezados.map(function (h) {
    return (obj[h] === undefined || obj[h] === null) ? '' : obj[h];
  });
}

/**
 * Devuelve { sh, encabezados, filas: [{obj, indiceFila}] } para una hoja,
 * donde indiceFila es el número de fila real en la hoja (1-based, incluye
 * encabezado), útil para escribir de vuelta con setValues/getRange.
 */
function leerTabla_(nombreHoja) {
  var sh = hoja_(nombreHoja);
  var encabezados = encabezados_(sh);
  var lastRow = sh.getLastRow();
  var filas = [];
  if (lastRow > 1) {
    var valores = sh.getRange(2, 1, lastRow - 1, encabezados.length).getValues();
    for (var i = 0; i < valores.length; i++) {
      filas.push({ obj: filaAObjeto_(encabezados, valores[i]), indiceFila: i + 2 });
    }
  }
  return { sh: sh, encabezados: encabezados, filas: filas };
}

function buscarFilaPorValor_(nombreHoja, columna, valor, comparacionInsensible) {
  var tabla = leerTabla_(nombreHoja);
  var norm = function (v) {
    v = (v === undefined || v === null) ? '' : String(v);
    return comparacionInsensible ? v.trim().toLowerCase() : v.trim();
  };
  var buscado = norm(valor);
  for (var i = 0; i < tabla.filas.length; i++) {
    if (norm(tabla.filas[i].obj[columna]) === buscado) {
      return { tabla: tabla, fila: tabla.filas[i] };
    }
  }
  return null;
}

/** Escribe uno o varios campos de una fila ya localizada (objeto de buscarFilaPorValor_). */
/** Escribe varios campos del mismo renglón. Con 2+ campos hace 1 sola lectura y 1 sola escritura (batch); con 1 campo, escritura directa. */
function escribirCamposFila_(encontrado, campos) {
  var tabla = encontrado.tabla;
  var claves = Object.keys(campos).filter(function (campo) { return tabla.encabezados.indexOf(campo) !== -1; });
  if (claves.length > 1) {
    var rangoFila = tabla.sh.getRange(encontrado.fila.indiceFila, 1, 1, tabla.encabezados.length);
    var valoresFila = rangoFila.getValues()[0];
    claves.forEach(function (campo) {
      valoresFila[tabla.encabezados.indexOf(campo)] = campos[campo];
      encontrado.fila.obj[campo] = campos[campo];
    });
    rangoFila.setValues([valoresFila]);
  } else if (claves.length === 1) {
    var campo = claves[0];
    var col = tabla.encabezados.indexOf(campo) + 1;
    tabla.sh.getRange(encontrado.fila.indiceFila, col).setValue(campos[campo]);
    encontrado.fila.obj[campo] = campos[campo];
  }
  if (tabla.sh.getName() === HOJAS.USUARIOS && encontrado.fila.obj.id_usuario) {
    invalidarCacheUsuario_(encontrado.fila.obj.id_usuario);
  }
}

// ----------------------------------------------------------------------------
// AUDITORÍA
// ----------------------------------------------------------------------------

/**
 * idUsuarioEjecuta / correoEjecuta: quién hizo la acción. Para acciones sin
 * sesión todavía (activar cuenta, recuperar contraseña, preparación del
 * sistema) se manda '' y '(sistema)'.
 */
function registrarAuditoria_(idUsuarioEjecuta, correoEjecuta, accion, entidad, idEntidad, valorAnterior, valorNuevo) {
  var sh = hoja_(HOJAS.LOG);
  sh.appendRow([
    new Date(),
    idUsuarioEjecuta || '',
    correoEjecuta || '(sistema)',
    accion,
    entidad,
    idEntidad || '',
    valorAnterior === undefined || valorAnterior === null ? '' : String(valorAnterior),
    valorNuevo === undefined || valorNuevo === null ? '' : String(valorNuevo)
  ]);
}

// ----------------------------------------------------------------------------
// CONFIG_SISTEMA
// ----------------------------------------------------------------------------

function obtenerConfig_(clave, porDefecto) {
  var encontrado = buscarFilaPorValor_(HOJAS.CONFIG, 'clave', clave, false);
  if (!encontrado) return porDefecto;
  var v = encontrado.fila.obj.valor;
  return (v === '' || v === undefined || v === null) ? porDefecto : v;
}

function listarConfig(token) {
  var usuario = requiereSesion_(token);
  return leerTabla_(HOJAS.CONFIG).filas.map(function (f) { return f.obj; });
}

function actualizarConfig(token, clave, nuevoValor) {
  var usuario = requierePermiso_(token, PERMISOS.CONFIGURAR_SISTEMA);
  var encontrado = buscarFilaPorValor_(HOJAS.CONFIG, 'clave', clave, false);
  if (!encontrado) throw new Error('No existe el parámetro "' + clave + '" en CONFIG_SISTEMA.');
  var col = encontrado.tabla.encabezados.indexOf('valor') + 1;
  var anterior = encontrado.fila.obj.valor;
  encontrado.tabla.sh.getRange(encontrado.fila.indiceFila, col).setValue(nuevoValor);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'EDITAR_CONFIG', 'CONFIG_SISTEMA', clave, anterior, nuevoValor);
  return { ok: true };
}

// ----------------------------------------------------------------------------
// ROLES Y PERMISOS (matriz 100% editable, sin roles fijos en código)
// ----------------------------------------------------------------------------

/** Nombres de rol = encabezados de ROLES_PERMISOS a partir de la 3a columna. */
function validarCorreo_(correo) {
  var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(correo || '').trim());
}

/**
 * datos: { nombre_completo, correo, rol, telefono, horario_id, notas }
 * Da de alta un usuario nuevo. El código personal y el id se generan aquí.
 * Nunca se borra ni se reutiliza una fila existente: si el correo ya existe
 * (activo o inactivo) se pide reactivarlo o usar otro correo.
 */
function campoTexto_(campo, valor) {
  return campo + '=' + (valor === undefined || valor === null ? '' : valor);
}

/**
 * nuevoEstado: 'Activo' | 'Inactivo'. Baja lógica: la fila NUNCA se borra,
 * solo cambia de estado, para conservar el historial completo.
 */
function setCell_(tabla, indiceFila, campo, valor) {
  var col = tabla.encabezados.indexOf(campo) + 1;
  if (col <= 0) throw new Error('La columna "' + campo + '" no existe en esta hoja.');
  tabla.sh.getRange(indiceFila, col).setValue(valor);
}

function fechaHoy_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Crea (si no existen) las 5 hojas necesarias para el Bloque 2: catálogo de
 * tareas diarias, sus pasos, sus materiales, la cola de trabajo diario y los
 * trabajos extra programados. Segura de ejecutar varias veces.
 */
function soloFecha_(valor) {
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(valor || '');
  return s.length >= 10 ? s.substring(0, 10) : s;
}

function asegurarColumna_(nombreHoja, nombreColumna) {
  var sh = hoja_(nombreHoja);
  var encabezados = encabezados_(sh);
  if (encabezados.indexOf(nombreColumna) === -1) {
    sh.getRange(1, encabezados.length + 1).setValue(nombreColumna);
  }
}

/** Carpeta de Drive donde se guardan las fotos de materiales del almacén (se crea una vez y se reutiliza). */
