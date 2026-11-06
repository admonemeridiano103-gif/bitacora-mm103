function generarIdMaterialAlmacen_() {
  var tabla = leerTabla_('ALMACEN_CATALOGO_MATERIALES');
  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^ALM-(\d+)$/.exec(String(f.obj.material_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'ALM-' + ('0000' + (max + 1)).slice(-4);
}

function generarIdMovimientoAlmacen_() {
  var tabla = leerTabla_('ALMACEN_MOVIMIENTOS');
  var max = 0;
  tabla.filas.forEach(function (f) {
    var m = /^MOV-(\d+)$/.exec(String(f.obj.movimiento_id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'MOV-' + ('0000' + (max + 1)).slice(-4);
}

function listarAlmacen(token) {
  var usuario = requiereSesion_(token);
  var tienePermiso = usuarioTienePermiso_(usuario, PERMISOS.REGISTRAR_ENTRADA_MATERIAL) ||
    usuarioTienePermiso_(usuario, PERMISOS.REGISTRAR_SALIDA_MATERIAL) ||
    usuarioTienePermiso_(usuario, PERMISOS.REGISTRAR_CONSUMO_MATERIAL) ||
    usuarioTienePermiso_(usuario, PERMISOS.AUDITORIA_INVENTARIO);
  if (!tienePermiso) throw new Error('Tu perfil no tiene acceso al almacén.');
  return leerTabla_('ALMACEN_CATALOGO_MATERIALES').filas.map(function (f) { return f.obj; })
    .sort(function (a, b) { return String(a.nombre || '').localeCompare(String(b.nombre || '')); });
}

function guardarMaterialAlmacen(token, datos) {
  var usuario = requiereSesion_(token);
  var tienePermiso = usuarioTienePermiso_(usuario, PERMISOS.REGISTRAR_ENTRADA_MATERIAL) ||
    usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  if (!tienePermiso) throw new Error('Tu perfil no tiene permiso para dar de alta materiales en el almacén.');

  var nombre = String(datos && datos.nombre || '').trim();
  if (!nombre) throw new Error('Falta el nombre del material.');

  if (datos.material_id) {
    var encontrado = buscarFilaPorValor_('ALMACEN_CATALOGO_MATERIALES', 'material_id', datos.material_id, false);
    if (!encontrado) throw new Error('No existe el material "' + datos.material_id + '".');
    ['nombre', 'unidad_medida', 'stock_minimo', 'ubicacion', 'tipo', 'categoria'].forEach(function (c) {
      if (datos[c] !== undefined) setCell_(encontrado.tabla, encontrado.fila.indiceFila, c, datos[c]);
    });
    return { ok: true, material_id: datos.material_id };
  }

  var sh = hoja_('ALMACEN_CATALOGO_MATERIALES');
  var encabezados = encabezados_(sh);
  var nuevo = {
    material_id: generarIdMaterialAlmacen_(),
    nombre: nombre,
    unidad_medida: datos.unidad_medida || '',
    stock_actual: Number(datos.stock_inicial) || 0,
    stock_minimo: (datos.stock_minimo === undefined || datos.stock_minimo === '') ? '' : Number(datos.stock_minimo),
    ubicacion: datos.ubicacion || '',
    tipo: datos.tipo || 'Consumible',
    categoria: datos.categoria || ''
  };
  sh.appendRow(objetoAFila_(encabezados, nuevo));
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'ALTA_MATERIAL_ALMACEN', 'ALMACEN_CATALOGO_MATERIALES', nuevo.material_id, '', nombre);
  return nuevo;
}

function ajustarExistenciaMaterial(token, materialId, nuevaExistencia, motivo) {
  var usuario = requiereSesion_(token);
  var tienePermiso = usuarioTienePermiso_(usuario, PERMISOS.REGISTRAR_ENTRADA_MATERIAL) ||
    usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  if (!tienePermiso) throw new Error('Tu perfil no tiene permiso para ajustar existencias del almacén.');

  var motivoLimpio = String(motivo || '').trim();
  if (!motivoLimpio) throw new Error('Escribe el motivo del ajuste (ej. conteo físico, corrección de migración).');

  var nuevoValor = Number(nuevaExistencia);
  if (nuevaExistencia === '' || nuevaExistencia === undefined || nuevaExistencia === null || isNaN(nuevoValor) || nuevoValor < 0) {
    throw new Error('La existencia debe ser un número mayor o igual a cero.');
  }

  var encontrado = buscarFilaPorValor_('ALMACEN_CATALOGO_MATERIALES', 'material_id', materialId, false);
  if (!encontrado) throw new Error('No existe el material "' + materialId + '".');
  var valorAnterior = encontrado.fila.obj.stock_actual;

  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'stock_actual', nuevoValor);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'AJUSTAR_EXISTENCIA_MATERIAL', 'ALMACEN_CATALOGO_MATERIALES', materialId, valorAnterior, nuevoValor + ' (motivo: ' + motivoLimpio + ')');
  return { ok: true, material_id: materialId, stock_actual: nuevoValor };
}

function registrarMovimientoAlmacen_(token, materialId, tipo, cantidad, tareaRelacionadaId, notas) {
  var usuario = requiereSesion_(token);
  cantidad = Number(cantidad);
  if (!cantidad || cantidad <= 0) throw new Error('La cantidad debe ser mayor a cero.');
  var encontrado = buscarFilaPorValor_('ALMACEN_CATALOGO_MATERIALES', 'material_id', materialId, false);
  if (!encontrado) throw new Error('No existe el material "' + materialId + '" en el almacén.');

  // Validación de tipo de recurso: una Herramienta solo admite Salida (préstamo) o Entrada
  // (devolución); un Material/Consumible solo admite Consumo o Entrada. Nunca Salida de
  // consumible ni Consumo de herramienta, tanto si lo intenta la interfaz como si alguien
  // llama la API directamente.
  var esHerramienta = encontrado.fila.obj.tipo === 'Herramienta';
  if (tipo === 'Salida' && !esHerramienta) {
    throw new Error('"' + encontrado.fila.obj.nombre + '" es un material de consumo: no se registra Salida, usa Consumo.');
  }
  if (tipo === 'Consumo' && esHerramienta) {
    throw new Error('"' + encontrado.fila.obj.nombre + '" es una herramienta: no se consume, usa Salida (préstamo) o Entrada (devolución).');
  }

  var stockActual = Number(encontrado.fila.obj.stock_actual) || 0;
  var delta = (tipo === 'Entrada') ? cantidad : -cantidad;
  var nuevoStock = stockActual + delta;
  if (nuevoStock < 0) {
    throw new Error('No hay suficiente existencia de "' + encontrado.fila.obj.nombre + '" (disponible: ' + stockActual + ').');
  }
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'stock_actual', nuevoStock);

  var shMov = hoja_('ALMACEN_MOVIMIENTOS');
  var encMov = encabezados_(shMov);
  var movimientoId = generarIdMovimientoAlmacen_();
  shMov.appendRow(objetoAFila_(encMov, {
    movimiento_id: movimientoId,
    fecha_hora: new Date(),
    material_id: materialId,
    tipo: tipo,
    cantidad: cantidad,
    usuario_id: usuario.id_usuario,
    tarea_relacionada_id: tareaRelacionadaId || '',
    notas: notas || ''
  }));
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'MOVIMIENTO_ALMACEN_' + tipo.toUpperCase(), 'ALMACEN_CATALOGO_MATERIALES', materialId, stockActual, nuevoStock);
  return { ok: true, movimiento_id: movimientoId, stock_actual: nuevoStock };
}

function registrarEntradaMaterial(token, materialId, cantidad, notas) {
  var usuario = requierePermiso_(token, PERMISOS.REGISTRAR_ENTRADA_MATERIAL);
  return registrarMovimientoAlmacen_(token, materialId, 'Entrada', cantidad, '', notas);
}

function registrarSalidaMaterial(token, materialId, cantidad, notas) {
  var usuario = requierePermiso_(token, PERMISOS.REGISTRAR_SALIDA_MATERIAL);
  return registrarMovimientoAlmacen_(token, materialId, 'Salida', cantidad, '', notas);
}

function registrarConsumoMaterial(token, materialId, cantidad, tareaRelacionadaId, notas) {
  var usuario = requierePermiso_(token, PERMISOS.REGISTRAR_CONSUMO_MATERIAL);
  return registrarMovimientoAlmacen_(token, materialId, 'Consumo', cantidad, tareaRelacionadaId, notas);
}

/** Asegura que una hoja tenga una columna con el encabezado dado; si no existe, la agrega al final. */
function carpetaFotosAlmacen_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CARPETA_FOTOS_ALMACEN_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* la carpeta ya no existe: se recrea abajo */ }
  }
  var carpeta = DriveApp.createFolder('MM103 - Fotos de Almacén');
  props.setProperty('CARPETA_FOTOS_ALMACEN_ID', carpeta.getId());
  return carpeta;
}

/**
 * Sube (o reemplaza) la fotografía de referencia de un material del almacén.
 * base64Datos: contenido del archivo en base64 (sin el prefijo "data:...;base64,").
 */
function subirFotoMaterialAlmacen(token, materialId, base64Datos, tipoMime, nombreArchivo) {
  var usuario = requiereSesion_(token);
  var tienePermiso = usuarioTienePermiso_(usuario, PERMISOS.REGISTRAR_ENTRADA_MATERIAL) ||
    usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS);
  if (!tienePermiso) throw new Error('Tu perfil no tiene permiso para subir fotos de materiales.');
  if (!base64Datos) throw new Error('No se recibió ninguna imagen.');
  if (base64Datos.length > 7000000) throw new Error('La imagen es demasiado grande. Usa una foto más ligera.');

  asegurarColumna_('ALMACEN_CATALOGO_MATERIALES', 'foto_url');
  var encontrado = buscarFilaPorValor_('ALMACEN_CATALOGO_MATERIALES', 'material_id', materialId, false);
  if (!encontrado) throw new Error('No existe el material "' + materialId + '".');

  var bytes = Utilities.base64Decode(base64Datos);
  var blob = Utilities.newBlob(bytes, tipoMime || 'image/jpeg', nombreArchivo || (materialId + '.jpg'));
  var carpeta = carpetaFotosAlmacen_();
  var archivo = carpeta.createFile(blob);
  archivo.setName(materialId + ' - ' + (encontrado.fila.obj.nombre || '') + ' - ' + new Date().getTime());
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var url = 'https://drive.google.com/thumbnail?sz=w500&id=' + archivo.getId();

  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'foto_url', url);
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'FOTO_MATERIAL_ALMACEN', 'ALMACEN_CATALOGO_MATERIALES', materialId, '', 'Foto actualizada');
  return { ok: true, material_id: materialId, foto_url: url };
}

/** Crea la hoja ALMACEN_PRESTAMOS_HERRAMIENTA si todavía no existe (normalmente la crea crearHojasFuturas, pero esto la asegura). */
function asegurarHojaPrestamos_() {
  var libro = ss_();
  var sh = libro.getSheetByName('ALMACEN_PRESTAMOS_HERRAMIENTA');
  if (!sh) {
    sh = libro.insertSheet('ALMACEN_PRESTAMOS_HERRAMIENTA');
    var encabezados = ['prestamo_id', 'herramienta_id', 'usuario_id', 'fecha_prestamo', 'fecha_devolucion_esperada', 'fecha_devolucion_real', 'estado'];
    sh.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
    sh.getRange(1, 1, 1, encabezados.length).setFontWeight('bold').setBackground('#1F4E78').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function generarIdPrestamoHerramienta_() {
  var sh = asegurarHojaPrestamos_();
  var datos = sh.getDataRange().getValues();
  var max = 0;
  for (var i = 1; i < datos.length; i++) {
    var m = /^PRE-(\d+)$/.exec(String(datos[i][0] || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'PRE-' + ('0000' + (max + 1)).slice(-4);
}

/** Registra que un técnico toma prestada una herramienta del almacén (se descuenta como salida temporal). */
function prestarHerramienta(token, materialId, fechaDevolucionEsperada, notas) {
  var usuario = requiereSesion_(token);
  if (!usuarioTienePermiso_(usuario, PERMISOS.REGISTRAR_SALIDA_MATERIAL)) {
    throw new Error('Tu perfil no tiene permiso para registrar préstamo de herramienta.');
  }
  var encontrado = buscarFilaPorValor_('ALMACEN_CATALOGO_MATERIALES', 'material_id', materialId, false);
  if (!encontrado) throw new Error('No existe ese material/herramienta en el almacén.');

  var sh = asegurarHojaPrestamos_();
  var encabezados = encabezados_(sh);
  var prestamoId = generarIdPrestamoHerramienta_();
  sh.appendRow(objetoAFila_(encabezados, {
    prestamo_id: prestamoId,
    herramienta_id: materialId,
    usuario_id: usuario.id_usuario,
    fecha_prestamo: new Date(),
    fecha_devolucion_esperada: fechaDevolucionEsperada || '',
    fecha_devolucion_real: '',
    estado: 'Prestado'
  }));
  registrarMovimientoAlmacen_(token, materialId, 'Salida', 1, '', 'Préstamo de herramienta ' + prestamoId + (notas ? ' — ' + notas : ''));
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'PRESTAR_HERRAMIENTA', 'ALMACEN_PRESTAMOS_HERRAMIENTA', prestamoId, '', 'Prestado a ' + usuario.id_usuario);
  return { ok: true, prestamo_id: prestamoId };
}

/** Marca una herramienta prestada como devuelta y regresa la existencia al almacén. */
function devolverHerramienta(token, prestamoId, notas) {
  var usuario = requiereSesion_(token);
  if (!usuarioTienePermiso_(usuario, PERMISOS.REGISTRAR_SALIDA_MATERIAL)) {
    throw new Error('Tu perfil no tiene permiso para registrar devolución de herramienta.');
  }
  var encontrado = buscarFilaPorValor_('ALMACEN_PRESTAMOS_HERRAMIENTA', 'prestamo_id', prestamoId, false);
  if (!encontrado) throw new Error('No existe el préstamo "' + prestamoId + '".');
  if (encontrado.fila.obj.estado === 'Devuelta') throw new Error('Ese préstamo ya se marcó como devuelto.');

  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'estado', 'Devuelta');
  setCell_(encontrado.tabla, encontrado.fila.indiceFila, 'fecha_devolucion_real', new Date());
  registrarMovimientoAlmacen_(token, encontrado.fila.obj.herramienta_id, 'Entrada', 1, '', 'Devolución de herramienta ' + prestamoId + (notas ? ' — ' + notas : ''));
  registrarAuditoria_(usuario.id_usuario, usuario.correo, 'DEVOLVER_HERRAMIENTA', 'ALMACEN_PRESTAMOS_HERRAMIENTA', prestamoId, 'Prestado', 'Devuelta');
  return { ok: true };
}

/** Lista los préstamos de herramienta activos (aún no devueltos) del usuario que consulta. */
function listarPrestamosHerramientaMios(token) {
  var usuario = requiereSesion_(token);
  var sh = ss_().getSheetByName('ALMACEN_PRESTAMOS_HERRAMIENTA');
  if (!sh) return [];
  var catalogoAlmacen = {};
  leerTabla_('ALMACEN_CATALOGO_MATERIALES').filas.forEach(function (f) { catalogoAlmacen[f.obj.material_id] = f.obj; });
  return leerTabla_('ALMACEN_PRESTAMOS_HERRAMIENTA').filas.map(function (f) { return f.obj; })
    .filter(function (p) { return p.usuario_id === usuario.id_usuario && p.estado === 'Prestado'; })
    .map(function (p) {
      var info = catalogoAlmacen[p.herramienta_id];
      return {
        prestamo_id: p.prestamo_id,
        herramienta_id: p.herramienta_id,
        nombre_herramienta: info ? info.nombre : '(eliminada)',
        fecha_prestamo: p.fecha_prestamo,
        fecha_devolucion_esperada: p.fecha_devolucion_esperada
      };
    });
}


// ----------------------------------------------------------------------------
// MIGRACIÓN DE CATÁLOGO DE ALMACÉN (se ejecuta UNA VEZ desde el editor de Apps Script)
// ----------------------------------------------------------------------------

var MIGRACION_ID_ORIGEN_ = '1uXBeRYZQSwITj1cngl_sDI6clG7FYEA0IoNbyuEvFF8';
var MIGRACION_CARPETA_FOTOS_ORIGEN_ID_ = '1C62s2xRLQ5x8s25MLPfBS2cANVYSoIpQ';

// Códigos cuya unidad de app NO es "pza" (según la pestaña "Porcentaje de Productos" de la hoja de origen).
var MIGRACION_UNIDADES_ESPECIALES_ = {
  'PV313': 'L', 'PV314': 'L', 'PV315': 'L', 'PV316': 'L', 'PV317': 'L', 'PV318': 'L', 'PV319': 'L',
  'PV713': 'L', 'PV714': 'L', 'PV715': 'L',
  'PV829': 'm', 'PV830': 'm', 'PV831': 'm', 'PV832': 'm'
};

// Categorías donde pueden mezclarse herramientas y consumibles: se marcan para revisión manual.
var MIGRACION_CATEGORIAS_AMBIGUAS_ = ['Herreria', 'Electricidad', 'Plomeria', 'Construccion', 'Madera/Carpintería', ''];


// ----------------------------------------------------------------------------
// BLOQUE 4 — TICKETS / INDICACIONES DEL DÍA
// ----------------------------------------------------------------------------

