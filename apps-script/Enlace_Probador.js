/**
 * ENLACE CON "PROBADOR OCR MEDIDORES" (Fase 2, experimento de solo lectura)
 * Abre la hoja de datos del Probador y cuenta filas por tabla. NO escribe nada.
 * Ejecutar a mano desde el editor: experimentoEnlaceProbador(). El resultado queda en Registro de ejecución.
 */
var PROBADOR_SHEET_ID = '1eaqB0TXHblsG5iCqBTd7FBUGWtxG-srEB0B9VoUDu-o';
var PROBADOR_URL_POR_DEFECTO = 'https://script.google.com/macros/s/AKfycbwbIxbRDfycLXiKFqulvHrltowyImQQP7WrhNPjFKpT3B8CcZTgfcF8zAxfOyEB97bI/exec';
var PROBADOR_TABLAS = ['Usuarios', 'Medidores', 'Periodos', 'Lecturas', 'CierreImportes', 'CierreMontos', 'CierreEstado', 'CierreProrrogas', 'CierreSolicitudes', 'Bitacora'];

function experimentoEnlaceProbador() {
  var res = { cuenta: Session.getEffectiveUser().getEmail() || '(no visible)', ok: false, tablas: {}, muestra: {} };
  try {
    var ss = SpreadsheetApp.openById(PROBADOR_SHEET_ID);
    res.hoja = ss.getName();
    PROBADOR_TABLAS.forEach(function (n) {
      var sh = ss.getSheetByName(n);
      if (!sh) { res.tablas[n] = 'NO EXISTE'; return; }
      var filas = Math.max(0, sh.getLastRow() - 1);
      res.tablas[n] = filas;
      if (filas > 0 && (n === 'Lecturas' || n === 'CierreEstado' || n === 'CierreProrrogas')) {
        var cols = sh.getLastColumn();
        var enc = sh.getRange(1, 1, 1, cols).getValues()[0];
        var ult = sh.getRange(sh.getLastRow(), 1, 1, cols).getValues()[0];
        var o = {}; enc.forEach(function (c, i) { if (c !== 'Email' && c !== 'FotoId') o[c] = String(ult[i]).slice(0, 40); });
        res.muestra[n] = o;
      }
    });
    res.ok = true;
  } catch (e) {
    res.error = String(e && e.message ? e.message : e);
  }
  var txt = JSON.stringify(res, null, 2);
  Logger.log(txt);
  return txt;
}

/* ---------------------------------------------------------------------------------------------
 * Pantalla "Lecturas y gas (Probador)": enlace + resumen de solo lectura.
 * La direccion del Probador se guarda en Propiedades del script (PROBADOR_URL) con
 * configurarEnlaceProbador('https://...'), ejecutado una vez desde el editor.
 * --------------------------------------------------------------------------------------------- */
function configurarEnlaceProbador(url) {
  url = String(url || '').trim();
  if (!/^https:\/\//.test(url)) throw new Error('La direccion debe empezar con https://');
  PropertiesService.getScriptProperties().setProperty('PROBADOR_URL', url);
  CacheService.getScriptCache().remove('PROBADOR_RESUMEN');
  return 'Enlace guardado: ' + url;
}

function filasProbador_(ss, nombre) {
  var sh = ss.getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues(), enc = v[0];
  return v.slice(1).map(function (r) { var o = {}; enc.forEach(function (c, i) { o[c] = r[i]; }); return o; });
}

function contarPor_(filas, campo) {
  var m = {}; filas.forEach(function (f) { var k = String(f[campo] || '(vacio)'); m[k] = (m[k] || 0) + 1; }); return m;
}

/** Resumen sin datos personales (sin correos ni fotos). Cache de 5 minutos. */
function obtenerResumenProbador(token) {
  requiereSesion_(token);
  return resumenProbador_();
}

/** Parte sin sesion, para probarla desde el editor. */
function resumenProbador_() {
  var url = PropertiesService.getScriptProperties().getProperty('PROBADOR_URL') || PROBADOR_URL_POR_DEFECTO;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('PROBADOR_RESUMEN');
  if (hit) { var o = JSON.parse(hit); o.url = url; return o; }
  var res = { url: url, ok: false };
  try {
    var ss = SpreadsheetApp.openById(PROBADOR_SHEET_ID);
    var periodos = filasProbador_(ss, 'Periodos');
    var lecturas = filasProbador_(ss, 'Lecturas');
    var estado = filasProbador_(ss, 'CierreEstado');
    var prorrogas = filasProbador_(ss, 'CierreProrrogas');
    var ultimo = periodos.length ? periodos[periodos.length - 1] : null;
    var delPeriodo = ultimo ? lecturas.filter(function (l) { return l.PeriodoId === ultimo.PeriodoId; }) : lecturas;
    res.periodo = ultimo ? { servicio: ultimo.Servicio, mes: String(ultimo.Mes), estado: ultimo.Estado } : null;
    res.lecturas = { total: delPeriodo.length, por_servicio: contarPor_(delPeriodo, 'Servicio'), por_estado: contarPor_(delPeriodo, 'Estado') };
    res.gas = { unidades: estado.length, por_estado: contarPor_(estado.filter(function (e) { return e.Servicio === 'gas'; }), 'Estado') };
    res.prorrogas = contarPor_(prorrogas, 'Estado');
    res.ok = true;
    cache.put('PROBADOR_RESUMEN', JSON.stringify(res), 300);
  } catch (e) {
    res.error = 'No se pudo leer el Probador: ' + String(e && e.message ? e.message : e);
  }
  return res;
}

function probarResumenProbador() { var r = resumenProbador_(); Logger.log(JSON.stringify(r, null, 1)); return r.ok; }

/** Compara correos de la Bitacora contra la hoja Usuarios del Probador (solo lectura). */
function compararUsuariosProbador() {
  var buscar = ['meridiano054@gmail.com', 'tecnicomantenimiento573@gmail.com', 'conciergem103@gmail.com'];
  var filas = filasProbador_(SpreadsheetApp.openById(PROBADOR_SHEET_ID), 'Usuarios');
  var por = {}; filas.forEach(function (f) { por[String(f.Email).trim().toLowerCase()] = f; });
  var out = buscar.map(function (c) { var f = por[c]; return c + ' -> ' + (f ? 'SI esta (rol ' + f.Rol + ', activo ' + f.Activo + ')' : 'FALTA en el Probador'); });
  var otros = filas.filter(function (f) { return buscar.indexOf(String(f.Email).trim().toLowerCase()) < 0; })
    .map(function (f) { return String(f.Nombre) + ' (' + f.Rol + ', activo ' + f.Activo + ') ' + String(f.Email).replace(/^(.{3}).*(@.*)$/, '$1***$2'); });
  Logger.log(out.join('\n') + '\nOtros en el Probador:\n' + otros.join('\n'));
  return out;
}
