/* MM103 · Clasificador de dígitos de rodillo (red neuronal pequeña, 100% local).
 * normalizar(lienzoCelda) -> Float32Array(20*28) ; clasificar(vector) -> [p0..p9, pNoDigito]
 * Los pesos (modelo_digitos.json) se entrenan con pruebas/entrenar.js usando ESTA misma normalización.
 */
(function (global) {
  'use strict';
  var AN = 20, AL = 28;
  var tmp = null;
  function normalizar(fuente, sx, sy, sw, sh, tintaClara) {
    if (!tmp) { tmp = document.createElement('canvas'); tmp.width = AN; tmp.height = AL; }
    var x = tmp.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.clearRect(0, 0, AN, AL);
    if (sw != null) x.drawImage(fuente, sx, sy, sw, sh, 0, 0, AN, AL); else x.drawImage(fuente, 0, 0, AN, AL);
    var d = x.getImageData(0, 0, AN, AL).data, n = AN * AL, g = new Float32Array(n), i, j;
    for (i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.2 * d[j] + 0.65 * d[j + 1] + 0.15 * d[j + 2];
    // polaridad: el trazo es minoría en la zona central
    // contraste con la zona central (sin bordes del marco ni bandas negras arriba/abajo)
    var centro = []; for (var cy = 4; cy < AL - 4; cy++) for (var cx = 2; cx < AN - 2; cx++) centro.push(g[cy * AN + cx]);
    var orden = centro.sort(function (a, b) { return a - b; }), nc = orden.length;
    var lo = orden[Math.floor(nc * 0.04)], hi = orden[Math.floor(nc * 0.96)], med = 0, cnt = 0, osc = 0;
    var t = (lo + hi) / 2;
    for (var yy = 5; yy < AL - 5; yy++) for (var xx = 4; xx < AN - 4; xx++) { cnt++; if (g[yy * AN + xx] < t) osc++; }
    var claroSobreOscuro = tintaClara == null ? osc > cnt * 0.5 : !!tintaClara;
    var rango = Math.max(12, hi - lo), v = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var z = (g[i] - lo) / rango; z = z < 0 ? 0 : z > 1 ? 1 : z;
      v[i] = claroSobreOscuro ? z : 1 - z;          // 1 = tinta
    }
    void med;
    return v;
  }
  var M = null;
  function decodificar(b64, n, escala) {
    var s = atob(b64), o = new Float32Array(n);
    for (var i = 0; i < n; i++) { var c = s.charCodeAt(i); o[i] = (c > 127 ? c - 256 : c) * escala; }
    return o;
  }
  function cargar(datos) {
    M = datos.capas.map(function (c) {
      return { ent: c.ent, sal: c.sal, W: decodificar(c.W, c.ent * c.sal, c.eW), b: decodificar(c.b, c.sal, c.eb) };
    });
    return M;
  }
  function clasificar(v) {
    var a = v;
    for (var k = 0; k < M.length; k++) {
      var c = M[k], o = new Float32Array(c.sal);
      for (var j = 0; j < c.sal; j++) {
        var s = c.b[j], base = j * c.ent;
        for (var i = 0; i < c.ent; i++) s += a[i] * c.W[base + i];
        o[j] = (k < M.length - 1) ? (s > 0 ? s : 0) : s;
      }
      a = o;
    }
    var mx = -1e9; for (j = 0; j < a.length; j++) mx = Math.max(mx, a[j]);
    var su = 0, p = new Float32Array(a.length); for (j = 0; j < a.length; j++) { p[j] = Math.exp(a[j] - mx); su += p[j]; }
    for (j = 0; j < a.length; j++) p[j] /= su;
    return p;
  }
  global.MM103Digitos = { AN: AN, AL: AL, normalizar: normalizar, cargar: cargar, clasificar: clasificar, listo: function () { return !!M; } };
})(window);
