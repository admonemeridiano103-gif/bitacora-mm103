/* MM103 · Motor de lectura de medidores (100% local, sin internet)
 * Preprocesado en Canvas + Tesseract.js (LSTM) + decisión con la lectura anterior.
 * Uso: const r = await MM103OCR.leer(canvas, { previa, promedio, maximo, enteros, decimales });
 *      r = { valor, texto, confianza, seguro, pases, motivo, candidatos, ms }
 */
(function (global) {
  'use strict';
  var BASE = (global.MM103_OCR_BASE || (function () {
    var s = document.currentScript && document.currentScript.src; return s ? s.replace(/[^/]*$/, '') : './';
  })());
  // Tesseract (segunda opinión) desde jsDelivr; el service worker lo guarda para usarlo sin internet
  var TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/', CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.1.2/', LANG = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/';
  if (global.MM103_TESS_LOCAL) { TESS = CORE = LANG = BASE; }
  var CONF = {                       // calibrado con pruebas/estres.js (ver README)
    alturaObjetivo: 72,              // px de alto del renglón de dígitos que recibe Tesseract
    margen: 18,                      // px de borde blanco alrededor
    salidaConfianza: 88,             // confianza mínima para salir antes de agotar los pases
    seguroConfianza: 75,
    pases: 6
  };
  var CONFUSIONES = { '0': '869', '1': '74', '2': '7', '3': '85', '4': '1', '5': '63', '6': '508', '7': '12', '8': '3069', '9': '80' };

  // ------------------------------------------------------------------ Tesseract
  var trabajador = null, cargando = null;
  function motor() {
    if (trabajador) return Promise.resolve(trabajador);
    if (cargando) return cargando;
    cargando = (global.Tesseract ? Promise.resolve() : cargarScript(TESS + 'tesseract.min.js')).then(function () {
      return global.Tesseract.createWorker('eng', 1, {
        workerPath: TESS + 'worker.min.js', corePath: CORE, langPath: LANG, gzip: true, workerBlobURL: !global.MM103_TESS_LOCAL
      });
    }).then(function (w) {
      return w.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '7',          // un solo renglón
        user_defined_dpi: '300',
        load_system_dawg: '0', load_freq_dawg: '0'
      }).then(function () { trabajador = w; return w; });
    });
    cargando.catch(function () { cargando = null; });
    return cargando;
  }
  function cargarScript(src) {
    return new Promise(function (ok, mal) {
      var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { mal(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }

  // ------------------------------------------------------------------ utilidades de imagen
  function lienzo(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function aGris(img) {                     // canal con más contraste para rodillos negros y rojos
    var d = img.data, n = img.width * img.height, g = new Float32Array(n);
    for (var i = 0, j = 0; i < n; i++, j += 4) g[i] = 0.2 * d[j] + 0.65 * d[j + 1] + 0.15 * d[j + 2];
    return { w: img.width, h: img.height, p: g };
  }
  function brillos(img) {                  // máscara de reflejo: zona grande casi blanca y sin color (no los trazos de los dígitos)
    var d = img.data, w = img.width, h = img.height, n = w * h, m = new Uint8Array(n), I = new Float64Array((w + 1) * (h + 1));
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var mx = Math.max(d[j], d[j + 1], d[j + 2]), mn = Math.min(d[j], d[j + 1], d[j + 2]);
      m[i] = (mx > 236 && mx - mn < 26) ? 1 : 0;
    }
    for (var y = 0; y < h; y++) { var s = 0; for (var x = 0; x < w; x++) { s += m[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; } }
    var r = Math.max(3, Math.round(h / 7)), o = new Uint8Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      var x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
      var c = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      if (c / ((x1 - x0) * (y1 - y0)) > 0.62) o[y * w + x] = 1;
    }
    return o;
  }
  function percentil(p, q) {
    var h = new Uint32Array(256), n = p.length; for (var i = 0; i < n; i++) h[Math.max(0, Math.min(255, p[i] | 0))]++;
    var objetivo = n * q, s = 0; for (var k = 0; k < 256; k++) { s += h[k]; if (s >= objetivo) return k; } return 255;
  }
  function estirar(G, bajo, alto) {
    var a = percentil(G.p, bajo), b = percentil(G.p, alto); if (b - a < 8) b = a + 8;
    var o = new Float32Array(G.p.length), f = 255 / (b - a);
    for (var i = 0; i < o.length; i++) { var v = (G.p[i] - a) * f; o[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
    return { w: G.w, h: G.h, p: o };
  }
  function desenfocar(G, r) {               // caja separable 2 veces ≈ gaussiano
    var w = G.w, h = G.h, a = G.p, b = new Float32Array(a.length), c = new Float32Array(a.length);
    function pasada(src, dst, horiz) {
      var L = horiz ? w : h, M = horiz ? h : w;
      for (var m = 0; m < M; m++) {
        var s = 0, k;
        for (k = -r; k <= r; k++) s += src[idx(Math.max(0, Math.min(L - 1, k)), m)];
        for (var l = 0; l < L; l++) {
          dst[idx(l, m)] = s / (2 * r + 1);
          s += src[idx(Math.min(L - 1, l + r + 1), m)] - src[idx(Math.max(0, l - r), m)];
        }
      }
      function idx(l, m) { return horiz ? m * w + l : l * w + m; }
    }
    pasada(a, b, true); pasada(b, c, false); pasada(c, b, true); pasada(b, c, false);
    return { w: w, h: h, p: c };
  }
  function enfocar(G, r, cantidad) {        // máscara de enfoque (unsharp mask)
    var B = desenfocar(G, r), o = new Float32Array(G.p.length);
    for (var i = 0; i < o.length; i++) { var v = G.p[i] + cantidad * (G.p[i] - B.p[i]); o[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
    return { w: G.w, h: G.h, p: o };
  }
  function otsu(p) {
    var h = new Float64Array(256), n = p.length, i;
    for (i = 0; i < n; i++) h[Math.max(0, Math.min(255, p[i] | 0))]++;
    var suma = 0; for (i = 0; i < 256; i++) suma += i * h[i];
    var sB = 0, wB = 0, mejor = 0, t = 127;
    for (i = 0; i < 256; i++) {
      wB += h[i]; if (!wB) continue; var wF = n - wB; if (!wF) break;
      sB += i * h[i]; var mB = sB / wB, mF = (suma - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > mejor) { mejor = v; t = i; }
    }
    return t;
  }
  function binOtsu(G) { var t = otsu(G.p), o = new Uint8Array(G.p.length); for (var i = 0; i < o.length; i++) o[i] = G.p[i] > t ? 1 : 0; return { w: G.w, h: G.h, b: o }; }
  function binSauvola(G, r, k) {            // umbral adaptativo con imágenes integrales
    var w = G.w, h = G.h, p = G.p, I = new Float64Array((w + 1) * (h + 1)), I2 = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) { var s = 0, s2 = 0; for (var x = 0; x < w; x++) { var v = p[y * w + x]; s += v; s2 += v * v; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; I2[(y + 1) * (w + 1) + x + 1] = I2[y * (w + 1) + x + 1] + s2; } }
    var o = new Uint8Array(w * h);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1), n = (x1 - x0) * (y1 - y0);
      var a = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      var b = I2[y1 * (w + 1) + x1] - I2[y0 * (w + 1) + x1] - I2[y1 * (w + 1) + x0] + I2[y0 * (w + 1) + x0];
      var m = a / n, sd = Math.sqrt(Math.max(0, b / n - m * m));
      o[y * w + x] = p[y * w + x] > m * (1 + k * (sd / 128 - 1)) ? 1 : 0;
    }
    return { w: w, h: h, b: o };
  }
  function morfologia(B, op) {              // 'abrir' quita puntos sueltos, 'cerrar' une trazos rotos (texto = 0)
    function paso(src, erosionTexto) {
      var w = B.w, h = B.h, o = new Uint8Array(src.length);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var t = erosionTexto ? 1 : 0, i = y * w + x;
        // texto=0. Erosionar texto => si algún vecino es fondo (1) queda fondo.
        var r = src[i];
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          var v = src[yy * w + xx]; if (erosionTexto ? v === 1 : v === 0) r = v;
        }
        o[i] = r; void t;
      }
      return o;
    }
    var b = op === 'abrir' ? paso(paso(B.b, true), false) : paso(paso(B.b, false), true);
    return { w: B.w, h: B.h, b: b };
  }
  function polaridad(B) {                   // Tesseract quiere texto oscuro sobre fondo claro
    var n = B.b.length, osc = 0; for (var i = 0; i < n; i++) if (!B.b[i]) osc++;
    if (osc > n * 0.5) for (i = 0; i < n; i++) B.b[i] = B.b[i] ? 0 : 1;
    return B;
  }
  function quitarBordes(B) {                // borra manchas pegadas al borde (marco del visor, sombras)
    var w = B.w, h = B.h, b = B.b, pila = [], i;
    function sembrar(x, y) { var k = y * w + x; if (!b[k]) { b[k] = 1; pila.push(k); } }
    for (var x = 0; x < w; x++) { sembrar(x, 0); sembrar(x, h - 1); }
    for (var y = 0; y < h; y++) { sembrar(0, y); sembrar(w - 1, y); }
    while (pila.length) {
      i = pila.pop(); var px = i % w, py = (i / w) | 0;
      if (px > 0) sembrar(px - 1, py); if (px < w - 1) sembrar(px + 1, py); if (py > 0) sembrar(px, py - 1); if (py < h - 1) sembrar(px, py + 1);
    }
    return B;
  }
  function energia(G) {                    // magnitud de gradiente (bordes de dígitos y de la ventana)
    var w = G.w, h = G.h, p = G.p, e = new Float32Array(w * h);
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) { var i = y * w + x; e[i] = Math.abs(p[i + 1] - p[i - 1]) + Math.abs(p[i + w] - p[i - w]); }
    return e;
  }
  function anguloInclinacion(G) {           // perfil de proyección de bordes: el ángulo que deja picos más nítidos
    var E = energia(G), w = G.w, h = G.h, mejor = 0, mejorV = -1;
    for (var a = -14; a <= 14; a += 1) {
      var tn = Math.tan(a * Math.PI / 180), perfil = new Float64Array(h * 3);
      for (var y = 1; y < h - 1; y += 1) for (var x = 1; x < w - 1; x += 2) { var v = E[y * w + x]; if (v < 30) continue; var yy = Math.round(y - (x - w / 2) * tn + h); if (yy >= 0 && yy < h * 3) perfil[yy] += v; }
      var s = 0; for (var k = 0; k < perfil.length; k++) s += perfil[k] * perfil[k];
      if (s > mejorV) { mejorV = s; mejor = a; }
    }
    return mejor;
  }
  // Ubica la franja: busca un renglón de manchas con forma de dígito (misma altura, alineadas), en ambas polaridades.
  function componentes(B, invertir) {
    var w = B.w, h = B.h, b = B.b, vis = new Uint8Array(w * h), cajas = [], pila = new Int32Array(w * h);
    var texto = invertir ? 1 : 0;
    for (var i0 = 0; i0 < w * h; i0++) {
      if (vis[i0] || b[i0] !== texto) continue;
      var sp = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, n = 0; pila[sp++] = i0; vis[i0] = 1;
      while (sp) {
        var i = pila[--sp], x = i % w, y = (i / w) | 0; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && !vis[i - 1] && b[i - 1] === texto) { vis[i - 1] = 1; pila[sp++] = i - 1; }
        if (x < w - 1 && !vis[i + 1] && b[i + 1] === texto) { vis[i + 1] = 1; pila[sp++] = i + 1; }
        if (y > 0 && !vis[i - w] && b[i - w] === texto) { vis[i - w] = 1; pila[sp++] = i - w; }
        if (y < h - 1 && !vis[i + w] && b[i + w] === texto) { vis[i + w] = 1; pila[sp++] = i + w; }
      }
      var cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      if (ch < h * 0.1 || ch > h * 0.85 || cw > ch * 1.1 || cw < ch * 0.12) continue;
      var llen = n / (cw * ch); if (llen < 0.12 || llen > 0.92) continue;
      if (x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1) continue;
      cajas.push({ x: x0, y: y0, w: cw, h: ch, cy: (y0 + y1) / 2 });
    }
    return cajas;
  }
  function renglon(cajas, esperados, alto) {
    var mejor = null;
    cajas.forEach(function (ref) {
      var g = cajas.filter(function (c) { return Math.abs(c.cy - ref.cy) < ref.h * 0.3 && c.h > ref.h * 0.8 && c.h < ref.h * 1.25; });
      if (g.length < 2) return;
      g.sort(function (a, b) { return a.x - b.x; });
      // separa grupos lejanos (más de 2.5 alturas entre dígitos)
      var grupos = [[g[0]]]; for (var i = 1; i < g.length; i++) { var u = grupos[grupos.length - 1], prev = u[u.length - 1]; if (g[i].x - (prev.x + prev.w) > ref.h * 2.5) grupos.push([g[i]]); else u.push(g[i]); }
      grupos.forEach(function (gr) {
        var alturas = gr.map(function (c) { return c.h; }).sort(function (a, b) { return a - b; }), hm = alturas[alturas.length >> 1];
        var cy = gr.reduce(function (a, c) { return a + c.cy; }, 0) / gr.length, centro = 1 - Math.min(1, Math.abs(cy - alto / 2) / (alto / 2));
        var puntos = Math.min(gr.length, esperados + 1) * hm * (0.1 + centro * centro);   // el marco guía está al centro: premia lo centrado
        if (!mejor || puntos > mejor.puntos) mejor = { cajas: gr, puntos: puntos, h: hm };
      });
    });
    return mejor;
  }
  function localizar(G, esperados) {
    var w = G.w, h = G.h, D = desenfocar(G, 1), mejor = null, inv = false;
    [24, 12, 6].forEach(function (div) {
      [0.2, 0.4].forEach(function (k) {
        var B = binSauvola(D, Math.max(5, Math.round(h / div)), k);
        [false, true].forEach(function (invertir) {
          var r = renglon(componentes(B, invertir), esperados || 5, h);
          if (r && (!mejor || r.puntos > mejor.puntos)) { mejor = r; inv = invertir; }
        });
      });
    });
    if (!mejor || mejor.cajas.length < 3) return { x: 0, y: 0, w: w, h: h, claroSobreOscuro: null, digitos: 0 };
    var cs = mejor.cajas, x0 = cs[0].x, x1 = cs[cs.length - 1].x + cs[cs.length - 1].w, y0 = h, y1 = 0;
    cs.forEach(function (c) { y0 = Math.min(y0, c.y); y1 = Math.max(y1, c.y + c.h); });
    var gaps = []; for (var i = 1; i < cs.length; i++) gaps.push((cs[i].x + cs[i].w / 2) - (cs[i - 1].x + cs[i - 1].w / 2));
    gaps.sort(function (a, b) { return a - b; });
    var paso = gaps.length ? gaps[0 + (gaps.length >> 1) * 0] : mejor.h * 0.8; if (gaps.length > 2) paso = gaps[(gaps.length - 1) >> 1];
    var mv = Math.round(mejor.h * 0.45), mh = Math.round(paso * 0.6);
    // si faltan dígitos (tapados por reflejo, ceros tenues, decimales rojos) amplía hacia ambos lados
    var faltan = Math.max(0, (esperados || 0) - cs.length);
    var ix = Math.max(0, x0 - mh - Math.round(faltan * paso)), dx = Math.min(w - 1, x1 + mh + Math.round(faltan * paso));
    ix = 0; dx = w - 1;   // el marco guía ya limita a lo ancho: solo se ubica el renglón (alto)
    var iy = Math.max(0, y0 - mv), dy = Math.min(h - 1, y1 + mv);
    // rodillo a medio giro: un dígito notablemente más bajo o desplazado respecto a los demás
    var hs = cs.map(function (c) { return c.h; }).sort(function (a, b) { return a - b; }), hm = hs[hs.length >> 1], cym = cs.map(function (c) { return c.cy; }).sort(function (a, b) { return a - b; })[cs.length >> 1];
    var ult = cs[cs.length - 1], girando = cs.length >= (esperados || 0) - 1 && cs.length >= 3 && (ult.h < hm * 0.8 || Math.abs(ult.cy - cym) > hm * 0.2);
    return { x: ix, y: iy, w: dx - ix + 1, h: dy - iy + 1, claroSobreOscuro: inv, digitos: cs.length, cajas: cs, girando: girando };
  }
  function suavizar(a, r) { var o = new Float64Array(a.length); for (var i = 0; i < a.length; i++) { var s = 0, n = 0; for (var k = -r; k <= r; k++) { var j = i + k; if (j >= 0 && j < a.length) { s += a[j]; n++; } } o[i] = s / n; } return o; }
  function nitidez(G) {                     // varianza del laplaciano (foto borrosa < ~60)
    var w = G.w, h = G.h, p = G.p, s = 0, s2 = 0, n = 0;
    for (var y = 1; y < h - 1; y += 2) for (var x = 1; x < w - 1; x += 2) {
      var l = 4 * p[y * w + x] - p[y * w + x - 1] - p[y * w + x + 1] - p[(y - 1) * w + x] - p[(y + 1) * w + x];
      s += l; s2 += l * l; n++;
    }
    var m = s / n; return s2 / n - m * m;
  }
  function aLienzo(B, margen) {
    var c = lienzo(B.w + margen * 2, B.h + margen * 2), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    var im = x.getImageData(margen, margen, B.w, B.h), d = im.data;
    for (var i = 0, j = 0; i < B.b.length; i++, j += 4) { var v = B.b[i] ? 255 : 0; d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255; }
    x.putImageData(im, margen, margen); return c;
  }
  function grisALienzo(G, margen, invertir) {
    var c = lienzo(G.w + margen * 2, G.h + margen * 2), x = c.getContext('2d');
    x.fillStyle = invertir ? '#000' : '#fff'; x.fillRect(0, 0, c.width, c.height);
    var im = x.getImageData(margen, margen, G.w, G.h), d = im.data;
    for (var i = 0, j = 0; i < G.p.length; i++, j += 4) { var v = invertir ? 255 - G.p[i] : G.p[i]; d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255; }
    x.putImageData(im, margen, margen); return c;
  }
  function oscuroMayoria(G) {               // decide con la zona central (donde están los dígitos), no con los bordes
    var w = G.w, h = G.h, y0 = Math.round(h * 0.25), y1 = Math.round(h * 0.75), x0 = Math.round(w * 0.1), x1 = Math.round(w * 0.9), v = [];
    for (var y = y0; y < y1; y++) for (var x = x0; x < x1; x++) v.push(G.p[y * w + x]);
    var t = otsu(v), n = 0; for (var i = 0; i < v.length; i++) if (v[i] <= t) n++; return n > v.length * 0.5;
  }

  // Recorta (con holgura alrededor del marco guía), endereza, ubica la franja y la escala a la altura objetivo.
  function prepararFranja(fuente, recorte, esperados) {
    var sw = fuente.videoWidth || fuente.naturalWidth || fuente.width, sh = fuente.videoHeight || fuente.naturalHeight || fuente.height;
    var r = recorte || { x: 0, y: 0, w: 1, h: 1 }, hx = r.w * 0.05, hy = r.h * 0.12;
    var rx = Math.max(0, r.x - hx), ry = Math.max(0, r.y - hy), rw = Math.min(1 - rx, r.w + 2 * hx), rh = Math.min(1 - ry, r.h + 2 * hy);
    var cx = Math.round(rx * sw), cy = Math.round(ry * sh), cw = Math.round(rw * sw), ch = Math.round(rh * sh);
    var escala = Math.min(3, 520 / cw);
    var W = Math.max(60, Math.round(cw * escala)), H = Math.max(30, Math.round(ch * escala));
    var c = lienzo(W, H), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high'; x.drawImage(fuente, cx, cy, cw, ch, 0, 0, W, H);
    var G = aGris(x.getImageData(0, 0, W, H)), ang = anguloInclinacion(G);
    if (Math.abs(ang) >= 1) {
      var c2 = lienzo(W, H), x2 = c2.getContext('2d', { willReadFrequently: true });
      x2.translate(W / 2, H / 2); x2.rotate(-ang * Math.PI / 180); x2.translate(-W / 2, -H / 2);
      x2.drawImage(c, -W * 0.2, 0, W * 1.4, H, -W * 0.2, 0, W * 1.4, H); x2.drawImage(c, 0, 0); x2.setTransform(1, 0, 0, 1, 0, 0);
      c = c2; x = x2; G = aGris(x.getImageData(0, 0, W, H));
    }
    var L = localizar(G, esperados), c3 = lienzo(L.w, L.h); c3.getContext('2d').drawImage(c, L.x, L.y, L.w, L.h, 0, 0, L.w, L.h);
    var f = CONF.alturaObjetivo / L.h, c4 = lienzo(Math.max(20, Math.round(L.w * f)), CONF.alturaObjetivo);
    var x4 = c4.getContext('2d', { willReadFrequently: true }); x4.imageSmoothingQuality = 'high'; x4.drawImage(c3, 0, 0, c4.width, c4.height);
    var img = x4.getImageData(0, 0, c4.width, c4.height);
    var rojoX = fronteraRoja(img);
    var BR = brillos(img), nb = 0; for (var q = 0; q < BR.length; q++) nb += BR[q];
    return { img: img, gris: aGris(img), brillo: BR, reflejo: nb / BR.length, rojoX: rojoX, rojoFin: img._rojoFin, angulo: ang, zona: L, claro: L.claroSobreOscuro, girando: !!L.girando };
  }
  // Donde empiezan los rodillos rojos (decimales). null si no hay.
  function fronteraRoja(img) {
    var d = img.data, w = img.width, h = img.height, y0 = Math.round(h * 0.2), y1 = Math.round(h * 0.8), col = new Float32Array(w);
    for (var x = 0; x < w; x++) { var n = 0; for (var y = y0; y < y1; y++) { var j = (y * w + x) * 4, r = d[j], g = d[j + 1], b = d[j + 2]; if (r > 90 && r - g > 45 && r - b > 30) n++; } col[x] = n / (y1 - y0); }
    var corrida = 0, ini = null;
    for (x = Math.round(w * 0.25); x < w; x++) { if (col[x] > 0.3) { corrida++; if (corrida >= 4) { ini = x - 3; break; } } else corrida = 0; }
    if (ini == null) return null;
    var fin = ini; for (x = ini; x < w; x++) if (col[x] > 0.25) fin = x;
    img._rojoFin = fin;
    return ini;
  }
  function girarF(F) {               // la franja girada 180°
    var w = F.img.width, h = F.img.height, src = F.img.data, im = new ImageData(w, h), d = im.data;
    for (var i = 0, n = w * h; i < n; i++) { var j = (n - 1 - i) * 4, k = i * 4; d[k] = src[j]; d[k + 1] = src[j + 1]; d[k + 2] = src[j + 2]; d[k + 3] = 255; }
    var M = new Uint8Array(F.brillo.length); for (i = 0; i < M.length; i++) M[i] = F.brillo[M.length - 1 - i];
    return { img: im, gris: aGris(im), brillo: M, reflejo: F.reflejo, rojoX: fronteraRoja(im), rojoFin: im._rojoFin, angulo: F.angulo, zona: F.zona, claro: F.claro, girando: F.girando };
  }
  function quitarReflejo(G, M) {            // rellena el reflejo con el promedio de su vecindario (sin brillo)
    var w = G.w, h = G.h, o = new Float32Array(G.p), r = 4, hay = 0;
    for (var i = 0; i < M.length; i++) if (M[i]) { hay++; }
    if (!hay) return G;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var k = y * w + x; if (!M[k]) continue;
      var s = 0, n = 0;
      for (var dy = -r; dy <= r; dy += 2) for (var dx = -r; dx <= r; dx += 2) { var yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue; var q = yy * w + xx; if (!M[q]) { s += G.p[q]; n++; } }
      if (n) o[k] = s / n;
    }
    return { w: w, h: h, p: o, reflejo: hay / M.length };
  }

  // Deja solo las manchas con forma de dígito (quita marco, separadores de rodillos, letras y brillos)
  function digitosLimpios(F) {
    var G = estirar(quitarReflejo(F.gris, F.brillo), 0.02, 0.98), D = desenfocar(G, 1), mejor = null;
    [10, 5, 3].forEach(function (div) {
      [0.15, 0.3].forEach(function (k) {
        var B = binSauvola(D, Math.max(4, Math.round(G.h / div)), k);
        [false, true].forEach(function (inv) {
          var cs = todasLasManchas(B, inv), r = renglon(cs.filter(esDigito(B)), 9, B.h);
          if (r && r.cajas.length >= 3 && (!mejor || r.puntos > mejor.puntos)) mejor = { r: r, B: B, inv: inv, cs: cs };
        });
      });
    });
    if (!mejor) return null;
    var hm = mejor.r.h, ys = mejor.r.cajas.map(function (c) { return c.cy; }).sort(function (a, b) { return a - b; }), cy = ys[ys.length >> 1];
    var top = cy - hm * 0.62, bot = cy + hm * 0.62;
    // conserva piezas dentro del renglón (dígitos partidos incluidos) y descarta líneas y bloques
    var piezas = mejor.cs.filter(function (c) {
      return c.y >= top && c.y + c.h <= bot && c.h >= hm * 0.18 && c.h <= hm * 1.2 && c.w <= hm * 1.1 && !(c.w < hm * 0.12 && c.h > hm * 0.8 && c.llen > 0.85);
    });
    // agrupa piezas que se traslapan a lo ancho en un mismo glifo
    piezas.sort(function (a, b) { return a.x - b.x; });
    var glifos = [];
    piezas.forEach(function (c) {
      var g = glifos[glifos.length - 1];
      if (g && c.x < g.x + g.w - Math.min(c.w, g.w) * 0.35) { var x1 = Math.max(g.x + g.w, c.x + c.w), y1 = Math.max(g.y + g.h, c.y + c.h); g.x = Math.min(g.x, c.x); g.y = Math.min(g.y, c.y); g.w = x1 - g.x; g.h = y1 - g.y; g.piezas.push(c); }
      else glifos.push({ x: c.x, y: c.y, w: c.w, h: c.h, piezas: [c] });
    });
    glifos = glifos.filter(function (g) { return g.h >= hm * 0.45; });
    if (glifos.length < 3) return null;
    // dibuja los glifos limpios en negro sobre blanco
    var B = mejor.B, w = B.w, h = B.h, limpio = new Uint8Array(w * h).fill(1), texto = mejor.inv ? 1 : 0;
    glifos.forEach(function (g) { g.piezas.forEach(function (c) { for (var i = 0; i < c.px.length; i++) limpio[c.px[i]] = 0; }); });
    void texto;
    return { B: { w: w, h: h, b: limpio }, glifos: glifos, hm: hm, inv: mejor.inv };
  }
  function todasLasManchas(B, invertir) {
    var w = B.w, h = B.h, b = B.b, vis = new Uint8Array(w * h), out = [], pila = new Int32Array(w * h), texto = invertir ? 1 : 0;
    for (var i0 = 0; i0 < w * h; i0++) {
      if (vis[i0] || b[i0] !== texto) continue;
      var sp = 0, x0 = w, x1 = 0, y0 = h, y1 = 0, px = []; pila[sp++] = i0; vis[i0] = 1;
      while (sp) {
        var i = pila[--sp], x = i % w, y = (i / w) | 0; px.push(i);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && !vis[i - 1] && b[i - 1] === texto) { vis[i - 1] = 1; pila[sp++] = i - 1; }
        if (x < w - 1 && !vis[i + 1] && b[i + 1] === texto) { vis[i + 1] = 1; pila[sp++] = i + 1; }
        if (y > 0 && !vis[i - w] && b[i - w] === texto) { vis[i - w] = 1; pila[sp++] = i - w; }
        if (y < h - 1 && !vis[i + w] && b[i + w] === texto) { vis[i + w] = 1; pila[sp++] = i + w; }
      }
      if (px.length < 6 || px.length > w * h * 0.25) continue;
      var cw = x1 - x0 + 1, ch = y1 - y0 + 1;
      out.push({ x: x0, y: y0, w: cw, h: ch, cy: (y0 + y1) / 2, llen: px.length / (cw * ch), px: px, borde: x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1 });
    }
    return out;
  }
  function esDigito(B) {
    return function (c) { return !c.borde && c.h >= B.h * 0.25 && c.h <= B.h * 0.95 && c.w <= c.h * 1.0 && c.w >= c.h * 0.12 && c.llen > 0.1 && c.llen < 0.9; };
  }
  function glifoALienzo(L, g) {
    var pad = Math.round(L.hm * 0.35), W = g.w + 2 * pad, H = g.h + 2 * pad, c = lienzo(W, H), x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    var im = x.getImageData(0, 0, W, H), d = im.data, w = L.B.w;
    g.piezas.forEach(function (p) { for (var i = 0; i < p.px.length; i++) { var q = p.px[i], xx = q % w - g.x + pad, yy = ((q / w) | 0) - g.y + pad, j = (yy * W + xx) * 4; d[j] = d[j + 1] = d[j + 2] = 0; } });
    x.putImageData(im, 0, 0); return c;
  }

  // ------------------------------------------------------------------ celdas + red neuronal
  var modeloCargando = null;
  function cargarModelo() {
    if (global.MM103Digitos && global.MM103Digitos.listo()) return Promise.resolve(true);
    if (modeloCargando) return modeloCargando;
    modeloCargando = (global.MM103Digitos ? Promise.resolve() : cargarScript(BASE + 'digitos.js')).then(function () {
      return fetch(BASE + 'modelo_digitos.json').then(function (r) { return r.json(); }).then(function (m) { global.MM103Digitos.cargar(m); return true; });
    }).catch(function (e) { modeloCargando = null; console.warn('modelo', e); return false; });
    return modeloCargando;
  }
  function lienzoDe(img) { var c = lienzo(img.width, img.height); c.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0); return c; }   // en memoria (CPU): evita copiar de la GPU en cada celda
  // Periodo dominante de las columnas (separación entre rodillos), por autocorrelación de bordes.
  function periodos(F) {
    var G = F.gris, w = G.w, h = G.h, col = new Float64Array(w), y0 = Math.round(h * 0.2), y1 = Math.round(h * 0.8);
    for (var x = 1; x < w - 1; x++) { var t = 0; for (var y = y0; y < y1; y++) t += Math.abs(G.p[y * w + x + 1] - G.p[y * w + x - 1]); col[x] = t; }
    var m = 0; for (x = 0; x < w; x++) m += col[x]; m /= w; for (x = 0; x < w; x++) col[x] -= m;
    var lo = Math.max(6, Math.round(h * 0.35)), hi = Math.min(Math.round(w / 3), Math.round(h * 1.5)), ac = [];
    for (var L = lo; L <= hi; L++) { var s2 = 0; for (x = 0; x + L < w; x++) s2 += col[x] * col[x + L]; ac.push({ L: L, v: s2 / (w - L) }); }
    var picos = ac.filter(function (a, i) { return i > 0 && i < ac.length - 1 && a.v > ac[i - 1].v && a.v >= ac[i + 1].v && a.v > 0; });
    picos.sort(function (a, b) { return b.v - a.v; });
    return picos.slice(0, 3).map(function (p) { return p.L; });
  }
  function inicioNegro(F) {            // borde izquierdo de la ventana oscura de rodillos (gas)
    var G = F.gris, w = G.w, h = G.h, y0 = Math.round(h * 0.3), y1 = Math.round(h * 0.7), col = [];
    for (var x = 0; x < w; x++) { var t = 0; for (var y = y0; y < y1; y++) t += G.p[y * w + x]; col.push(t / (y1 - y0)); }
    var dentro = col.slice(Math.round(F.rojoX * 0.4), F.rojoX).sort(function (a, b) { return a - b; }), osc = dentro[dentro.length >> 1];
    var fuera = Math.max.apply(null, col.slice(0, Math.max(1, Math.round(F.rojoX * 0.15))));
    if (fuera - osc < 30) return null;
    var umbral = (osc + fuera) / 2;
    for (x = Math.round(F.rojoX * 0.6); x > 0; x--) if (col[x] > umbral && col[x - 1] > umbral) return x + 1;
    return null;
  }
  function clasificarRejilla(F, paso, fase, alto, cy, tinta) {
    var W = F.img.width, fuente = F.lienzo || (F.lienzo = lienzoDe(F.img)), lista = [];
    for (var c = fase - paso * Math.floor(fase / paso); c < W + paso * 0.2; c += paso) {
      var x0 = c - paso * 0.5; if (x0 < -paso * 0.25 || x0 + paso > W + paso * 0.25) continue;
      var v = global.MM103Digitos.normalizar(fuente, x0, cy - alto / 2, paso, alto, tinta);
      lista.push({ cx: c, p: global.MM103Digitos.clasificar(v) });
    }
    return lista;
  }
  function calidad(lista, N) {          // qué tan "dígito" se ven las mejores N celdas consecutivas
    var mejor = -1e9;
    for (var a = 0; a + N <= lista.length; a++) { var s = 0; for (var b = a; b < a + N; b++) { var p = lista[b].p, mx = 0; for (var j = 0; j < 10; j++) mx = Math.max(mx, p[j]); s += Math.log(mx + 1e-3); } mejor = Math.max(mejor, s); }
    return mejor;
  }
  // Divide la franja en celdas de rodillo (busca paso y fase que mejor encajan) y clasifica cada una.
  function celdas(F, o) {
    var N = o.enteros + (o.decimales || 0), h = F.img.height;
    var L = F.limpio === undefined ? (F.limpio = digitosLimpios(F)) : F.limpio;
    var tinta = F.rojoX != null ? true : (L ? !!L.inv : (F.claro == null ? null : !!F.claro));
    var hm = L ? L.hm : h * 0.62, cy = h / 2;
    if (L) { var ys = L.glifos.map(function (g) { return g.y + g.h / 2; }).sort(function (a, b) { return a - b; }); cy = ys[ys.length >> 1]; }
    var alto = Math.min(h, hm * 1.3);
    var pasos = periodos(F);
    if (L && L.glifos.length >= 3) {
      var cx = L.glifos.map(function (g) { return g.x + g.w / 2; }), gaps = [];
      for (var i = 1; i < cx.length; i++) gaps.push(cx[i] - cx[i - 1]);
      gaps.sort(function (a, b) { return a - b; }); pasos.push(gaps[gaps.length >> 1]);
    }
    for (var f = 0.62; f <= 1.75; f *= 1.09) pasos.push(hm * f);              // barrido geométrico de pasos
    pasos = pasos.filter(function (p) { return p >= hm * 0.6 && p <= hm * 2.2; });
    if (F.rojoX != null && F.rojoFin != null && F.rojoFin - F.rojoX > hm) pasos.push((F.rojoFin - F.rojoX) / (o.rodillosRojos || 3));
    if (F.rojoX != null) { var ni = inicioNegro(F); if (ni != null) [4, 5, 6].forEach(function (k) { var q = (F.rojoX - ni) / k; if (q >= hm * 0.6 && q <= hm * 2.2) pasos.push(q); }); }
    var R = rango(o), mejor = null, mejorLibre = null;
    pasos.forEach(function (paso) {
      var fases = [];
      if (F.rojoX != null) { var f0 = ((F.rojoX + paso / 2) % paso + paso) % paso; fases.push(f0, f0 - paso * 0.08, f0 + paso * 0.08); }
      else for (var k = 0; k < 5; k++) fases.push(paso * k / 5);
      fases.forEach(function (fase) {
        var lista = clasificarRejilla(F, paso, fase, alto, cy, tinta); if (lista.length < Math.min(3, N)) return;
        var q;
        if (R) { var cand = ventanas(lista, F, o, N).map(armar), mq = -1e9; cand.forEach(function (c) { var d = decodificar(c, o); if (d) mq = Math.max(mq, d.ll - Math.max(0, d.brecha - 4) + c.esDigito * 0.7); }); q = mq; }
        else q = calidad(lista, Math.min(N, lista.length));
        if (!mejor || q > mejor.q) mejor = { q: q, lista: lista, paso: paso, fase: fase };
        var ql = calidad(lista, Math.min(N, lista.length));
        if (!mejorLibre || ql > mejorLibre.q) mejorLibre = { q: ql, lista: lista, paso: paso, fase: fase };
      });
    });
    if (!mejor) return null;
    var lista = mejor.lista, opciones = ventanas(lista, F, o, N);
    var res = opciones.map(function (el) { return armar(el); });
    res.forEach(function (r) { r.paso = mejor.paso; r.celdas = lista.length; r.lista = lista; });
    var elegido = res.length === 1 ? res[0] : elegirVentana(res, o);
    // lectura "a ciegas": rejilla y ventana elegidas SIN la lectura anterior (para verificar que no forzamos el resultado)
    if (mejorLibre) {
      var vl = ventanas(mejorLibre.lista, F, o, N).map(armar);
      vl.sort(function (a, b) { return (b.esDigito * 1.5 + Math.log(b.conf / 100) * b.probs.length) - (a.esDigito * 1.5 + Math.log(a.conf / 100) * a.probs.length); });
      elegido.ciego = vl[0] ? vl[0].texto : '';
    }
    return elegido;
  }
  function ventanas(lista, F, o, N) {
    var opciones = [];
    if (F.rojoX != null && o.decimales) {
      var izq = lista.filter(function (k) { return k.cx < F.rojoX; }), der = lista.filter(function (k) { return k.cx >= F.rojoX; });
      if (der.length >= o.decimales) { var e = izq.slice(-o.enteros).concat(der.slice(0, o.decimales)); while (e.length < N) e.unshift(null); opciones.push(e); }
    }
    if (!opciones.length) for (var a = Math.max(0, lista.length - N - 4); a + N <= lista.length; a++) opciones.push(lista.slice(a, a + N));
    if (!opciones.length) { var e2 = lista.slice(); while (e2.length < N) e2.unshift(null); opciones.push(e2); }
    return opciones;
  }
  function armar(elegidas) {
    var probs = elegidas.map(function (k) {
      if (!k) { var u = new Float32Array(10); u[0] = 0.6; for (var j = 1; j < 10; j++) u[j] = 0.4 / 9; return u; }
      var q = new Float32Array(10), t = 0; for (var j2 = 0; j2 < 10; j2++) { q[j2] = k.p[j2] + 2e-3; t += q[j2]; }
      for (j2 = 0; j2 < 10; j2++) q[j2] /= t; return q;
    });
    var nd = elegidas.reduce(function (s, k) { return s + (k ? Math.log(1.0001 - k.p[10]) : Math.log(0.5)); }, 0);
    var texto = probs.map(function (q) { var m = 0; for (var j = 1; j < 10; j++) if (q[j] > q[m]) m = j; return String(m); }).join('');
    var confs = probs.map(function (q) { return 100 * Math.max.apply(null, Array.prototype.slice.call(q)); });
    return { texto: texto, conf: confs.reduce(function (x, y) { return x + y; }, 0) / confs.length, simbolos: texto.split('').map(function (ch, i) { return { c: ch, conf: confs[i] }; }), probs: probs, esDigito: nd };
  }
  function elegirVentana(res, o) {      // con lectura anterior: la ventana que mejor la explica; sin ella, la que más parece dígitos (prefiere la derecha)
    var R = rango(o);
    res.forEach(function (r, i) {
      var d = R ? decodificar(r, o) : null;
      r._nota = r.esDigito * 1.5 + (d ? d.ll - Math.max(0, d.brecha - 3) : Math.log(r.conf / 100) * r.probs.length) + i * 0.05;
    });
    res.sort(function (a, b) { return b._nota - a._nota; });
    return res[0];
  }
  // Decodificación bayesiana: el valor más probable dentro del rango esperado según las probabilidades de cada rodillo.
  function decodificar(C, o) {
    var N = C.probs.length, esc = Math.pow(10, o.decimales || 0);
    function ll(entero) { var s = String(entero); while (s.length < N) s = '0' + s; if (s.length > N) return -1e9; var t = 0; for (var i = 0; i < N; i++) t += Math.log(C.probs[i][+s[i]]); return t; }
    var libre = 0; C.probs.forEach(function (q) { libre += Math.log(Math.max.apply(null, Array.prototype.slice.call(q))); });
    var R = rango(o); if (!R) return null;
    var a = Math.round(R.min * esc), b = Math.round(R.max * esc), lista = [];
    if (b - a > 200000) return null;
    for (var v = a; v <= b; v++) lista.push({ v: v, ll: ll(v) });
    lista.sort(function (x, y) { return y.ll - x.ll; });
    var mx = lista[0].ll, z = 0; lista.forEach(function (x) { z += Math.exp(x.ll - mx); });
    return { valor: lista[0].v / esc, ll: mx, libre: libre, post: 1 / z, segundo: lista[1] ? lista[1].v / esc : null, brecha: libre - mx };
  }

  // ------------------------------------------------------------------ pases
  var PASES = [
    function (F) {                                    // 0: solo dígitos limpios (sin marco ni separadores)
      F.limpio = F.limpio === undefined ? digitosLimpios(F) : F.limpio;
      return F.limpio ? aLienzo(F.limpio.B, CONF.margen) : null;
    },
    function (F) {                                    // 1: cada dígito por separado (modo carácter)
      F.limpio = F.limpio === undefined ? digitosLimpios(F) : F.limpio;
      return F.limpio ? { celdas: F.limpio } : null;
    },
    function (F) {                                    // 1: gris + estirado suave
      var G = estirar(F.gris, 0.01, 0.99); return grisALienzo(G, CONF.margen, F.claro == null ? oscuroMayoria(G) : F.claro);
    },
    function (F) {                                    // 2: reflejo + estirado fuerte + enfoque
      var G = estirar(enfocar(estirar(quitarReflejo(F.gris, F.brillo), 0.03, 0.97), 2, 1.6), 0.01, 0.99);
      return grisALienzo(G, CONF.margen, F.claro == null ? oscuroMayoria(G) : F.claro);
    },
    function (F) {                                    // 3: Otsu + morfología
      var G = enfocar(estirar(quitarReflejo(F.gris, F.brillo), 0.03, 0.97), 2, 1.2);
      var B = quitarBordes(polaridad(binOtsu(desenfocar(G, 1))));
      return aLienzo(morfologia(B, 'abrir'), CONF.margen);
    },
    function (F) {                                    // 4: adaptativo (Sauvola) para luz dispareja + cerrar trazos
      var G = estirar(quitarReflejo(F.gris, F.brillo), 0.02, 0.98);
      var B = quitarBordes(polaridad(binSauvola(desenfocar(G, 1), Math.max(8, Math.round(G.h / 3)), 0.18)));
      return aLienzo(morfologia(B, 'cerrar'), CONF.margen);
    }
  ];

  function reconocerCeldas(w, L) {
    var simbolos = [];
    return w.setParameters({ tessedit_pageseg_mode: '10' }).then(function () {
      return L.glifos.reduce(function (pr, g) {
        return pr.then(function () {
          return w.recognize(glifoALienzo(L, g), {}, { text: true, blocks: true }).then(function (r) {
            var t = (r.data.text || '').replace(/\D/g, '').slice(0, 1);
            if (t) simbolos.push({ c: t, conf: r.data.confidence || 0, b: { x0: g.x + CONF.margen, x1: g.x + g.w + CONF.margen, y0: g.y + CONF.margen, y1: g.y + g.h + CONF.margen } });
          });
        });
      }, Promise.resolve());
    }).then(function () { return w.setParameters({ tessedit_pageseg_mode: '7' }); }).then(function () {
      return { texto: simbolos.map(function (x) { return x.c; }).join(''), conf: simbolos.length ? simbolos.reduce(function (a, x) { return a + x.conf; }, 0) / simbolos.length : 0, simbolos: simbolos };
    });
  }
  function reconocer(w, c) {
    if (!c) return Promise.resolve({ texto: '', conf: 0, simbolos: [] });
    if (c.celdas) return reconocerCeldas(w, c.celdas);
    return w.recognize(c, {}, { text: true, blocks: true }).then(function (r) {
      var simbolos = [];
      (r.data.blocks || []).forEach(function (b) { (b.paragraphs || []).forEach(function (p) { (p.lines || []).forEach(function (l) { (l.words || []).forEach(function (wd) { (wd.symbols || []).forEach(function (s) { if (/\d/.test(s.text)) simbolos.push({ c: s.text, conf: s.confidence, b: s.bbox }); }); }); }); }); });
      var texto = simbolos.map(function (s) { return s.c; }).join('') || (r.data.text || '').replace(/\D/g, '');
      var conf = simbolos.length ? simbolos.reduce(function (a, s) { return a + s.conf; }, 0) / simbolos.length : (r.data.confidence || 0);
      return { texto: texto, conf: conf, simbolos: simbolos };
    });
  }

  // ------------------------------------------------------------------ decisión con la lectura anterior
  function aValor(dig, enteros, decimales) {
    if (!dig) return null;
    if (decimales && dig.length === enteros + decimales) return Number(dig.slice(0, enteros) + '.' + dig.slice(enteros));
    if (decimales && dig.length > decimales && dig.length < enteros + decimales) return Number(dig.slice(0, dig.length - decimales) + '.' + dig.slice(dig.length - decimales));
    return Number(dig);
  }
  function rango(o) {
    var p = o.previa; if (p == null || isNaN(p)) return null;
    var tope = Math.max(o.maximo ? o.maximo * 3 : 0, o.promedio ? o.promedio * 6 : 0, o.tipo === 'GAS' ? 15 : 25);
    return { min: p, max: p + tope, esperado: p + (o.promedio || 0) };
  }
  function plausible(v, R) { return R ? (v >= R.min - 1e-9 && v <= R.max) : true; }
  function formatear(v, enteros, decimales) {
    var s = Number(v).toFixed(decimales || 0).replace('.', ''); while (s.length < enteros + (decimales || 0)) s = '0' + s; return s;
  }
  // Repara confusiones típicas (8↔3, 1↔7…) en los dígitos menos confiables hasta caer en el rango esperado.
  function reparar(lect, o, R) {
    if (!R) return null;
    var s = lect.texto, n = s.length; if (!n) return null;
    var orden = lect.simbolos.length === n ? lect.simbolos.map(function (x, i) { return { i: i, c: x.conf }; }) : s.split('').map(function (x, i) { return { i: i, c: 50 }; });
    orden.sort(function (a, b) { return a.c - b.c; });
    var mejores = [];
    function probar(t, cambios) {
      var v = aValor(t, o.enteros, o.decimales);
      if (v != null && plausible(v, R)) mejores.push({ v: v, t: t, cambios: cambios, d: Math.abs(v - R.esperado) });
    }
    var bajos = orden.slice(0, 3);
    bajos.forEach(function (a) {
      (CONFUSIONES[s[a.i]] || '').split('').forEach(function (c) { probar(s.slice(0, a.i) + c + s.slice(a.i + 1), 1); });
    });
    for (var x = 0; x < bajos.length; x++) for (var y = x + 1; y < bajos.length; y++) {
      var A = bajos[x].i, B = bajos[y].i;
      (CONFUSIONES[s[A]] || '').split('').forEach(function (ca) { (CONFUSIONES[s[B]] || '').split('').forEach(function (cb) {
        var t = s.split(''); t[A] = ca; t[B] = cb; probar(t.join(''), 2);
      }); });
    }
    // Dígitos que faltan o sobran: alinea contra la lectura anterior
    var ref = formatear(o.previa, o.enteros, o.decimales), N = ref.length;
    function insertar(t, m, cambios) {           // completa dígitos tapados (reflejo) probando cada posición
      if (!m) return probar(t, cambios);
      for (var k = 0; k <= t.length; k++) for (var d = 0; d <= 9; d++) insertar(t.slice(0, k) + d + t.slice(k), m - 1, cambios + 1);
    }
    if (n < N && N - n <= 2) insertar(s, N - n, 0);
    if (n > N && n - N <= 3) {                    // sobran dígitos (marcas, tornillos, brillo): prueba quitarlos
      (function quitar(t, m, desde) { if (!m) return probar(t, n - N); for (var k = desde; k < t.length; k++) quitar(t.slice(0, k) + t.slice(k + 1), m - 1, k); })(s, n - N, 0);
    }
    if (!mejores.length) return null;
    mejores.sort(function (a, b) { return a.cambios - b.cambios || a.d - b.d; });
    return mejores[0];
  }
  // Voto por posición entre pases de la misma longitud (pesa la confianza de cada dígito)
  function votar(lecturas, largo) {
    var mismas = lecturas.filter(function (l) { return l.texto.length === largo; }); if (mismas.length < 2) return null;
    var res = '', confs = [];
    for (var i = 0; i < largo; i++) {
      var urna = {};
      mismas.forEach(function (l) { var c = l.texto[i], w = l.simbolos.length === largo ? l.simbolos[i].conf : l.conf; urna[c] = (urna[c] || 0) + w; });
      var gan = Object.keys(urna).sort(function (a, b) { return urna[b] - urna[a]; })[0];
      var total = 0; for (var k in urna) total += urna[k];
      res += gan; confs.push(100 * urna[gan] / total);
    }
    return { texto: res, conf: confs.reduce(function (a, b) { return a + b; }, 0) / largo, simbolos: res.split('').map(function (c, i) { return { c: c, conf: confs[i] }; }) };
  }

  // Último dígito más bajo o desplazado que los demás = rodillo a medio giro
  function girandoPorCajas(l) {
    var ss = l.simbolos.filter(function (x) { return x.b; }); if (ss.length < 4 || l.conf < 60) return false;
    var hs = ss.slice(0, -1).map(function (x) { return x.b.y1 - x.b.y0; }).sort(function (a, b) { return a - b; }), hm = hs[hs.length >> 1];
    var cs = ss.slice(0, -1).map(function (x) { return (x.b.y0 + x.b.y1) / 2; }).sort(function (a, b) { return a - b; }), cm = cs[cs.length >> 1];
    var u = ss[ss.length - 1].b, hu = u.y1 - u.y0, cu = (u.y0 + u.y1) / 2;
    return hu < hm * 0.86 || hu > hm * 1.18 || Math.abs(cu - cm) > hm * 0.12;
  }
  // Con rodillos rojos: lo que está a la izquierda del rojo son enteros y lo de la derecha decimales.
  function porColor(l, F, o, giro) {
    if (F.rojoX == null || !o.decimales || !l.simbolos.length || !l.simbolos.every(function (x) { return x.b; })) return l;
    var W = F.img.width + 2 * CONF.margen, frontera = F.rojoX + CONF.margen;
    var ent = '', dec = '', ce = [], cd = [];
    l.simbolos.forEach(function (x) {
      var cx = (x.b.x0 + x.b.x1) / 2; void W; void giro;
      if (cx < frontera) { ent += x.c; ce.push(x); } else { dec += x.c; cd.push(x); }
    });
    if (!ent || !dec) return l;
    if (ent.length > o.enteros) { ent = ent.slice(-o.enteros); ce = ce.slice(-o.enteros); }
    while (ent.length < o.enteros) { ent = '0' + ent; ce.unshift({ c: '0', conf: 60 }); }
    dec = dec.slice(0, o.decimales); cd = cd.slice(0, o.decimales);
    if (dec.length < o.decimales) return l;
    var ss = ce.concat(cd);
    return { texto: ent + dec, conf: ss.reduce(function (a, x) { return a + x.conf; }, 0) / ss.length, simbolos: ss, crudo: l.texto };
  }
  function decidir(lecturas, o) {
    var R = rango(o), cand = {};
    function sumar(texto, conf, origen, cambios) {
      var v = aValor(texto, o.enteros, o.decimales); if (v == null || isNaN(v)) return;
      var k = v.toFixed(o.decimales || 0);
      if (!cand[k]) cand[k] = { valor: v, texto: texto, votos: 0, conf: 0, origenes: [], cambios: cambios || 0 };
      cand[k].votos++; cand[k].conf = Math.max(cand[k].conf, conf); cand[k].origenes.push(origen);
      cand[k].cambios = Math.min(cand[k].cambios, cambios || 0);
    }
    lecturas.forEach(function (l, i) { sumar(l.texto, l.conf, 'pase' + (i + 1), 0); });
    var largos = {}; lecturas.forEach(function (l) { largos[l.texto.length] = 1; });
    Object.keys(largos).forEach(function (L) { var v = votar(lecturas, +L); if (v) sumar(v.texto, v.conf, 'voto', 0); });
    var lista = Object.keys(cand).map(function (k) {
      var c = cand[k], ok = plausible(c.valor, R);
      c.plausible = ok;
      c.puntos = c.conf + 12 * (c.votos - 1) + (ok ? 40 : -60) - 25 * c.cambios - (R && ok ? Math.min(15, Math.abs(c.valor - R.esperado)) : 0);
      return c;
    }).sort(function (a, b) { return b.puntos - a.puntos; });
    var mejor = lista[0] || null, motivo = '';
    if (R && (!mejor || !mejor.plausible)) {
      var base = lecturas.slice().sort(function (a, b) { return b.conf - a.conf; });
      for (var i = 0; i < base.length; i++) {
        var rp = reparar(base[i], o, R);
        if (rp) { mejor = { valor: rp.v, texto: rp.t, votos: 0, conf: Math.max(0, base[i].conf - 20 * rp.cambios), plausible: true, cambios: rp.cambios, origenes: ['reparado'] }; motivo = 'Se corrigieron ' + rp.cambios + ' dígito(s) dudoso(s) usando la lectura anterior.'; break; }
      }
    }
    if (!mejor) return { valor: null, texto: '', confianza: 0, seguro: false, motivo: 'No se reconocieron dígitos.', candidatos: lista };
    var largoOk = !o.enteros || mejor.texto.length === o.enteros + (o.decimales || 0) || String(mejor.texto).replace(/^0+/, '').length === String(Math.round(mejor.valor * Math.pow(10, o.decimales || 0))).length;
    var seguro = mejor.plausible && !mejor.cambios && largoOk && mejor.conf >= CONF.seguroConfianza && (mejor.votos >= 2 || mejor.conf >= CONF.salidaConfianza) && !o._girando && !(o._reflejo > 0.015);
    if (!motivo && mejor.plausible && o._reflejo > 0.015) motivo = 'Hay reflejo sobre los números: confirma la lectura (o inclina un poco el teléfono y repite).';
    if (!motivo && mejor.plausible && o._girando) motivo = 'Un rodillo está girando: confirma el último dígito (se toma el número menor).';
    if (!motivo) motivo = !mejor.plausible ? (R && mejor.valor < R.min ? 'La lectura es MENOR que la anterior.' : 'Consumo fuera de lo normal para este medidor.') : seguro ? 'Lectura consistente.' : 'Confianza baja: revisa el número.';
    return { valor: mejor.valor, texto: mejor.texto, confianza: Math.round(mejor.conf), seguro: seguro, plausible: mejor.plausible, motivo: motivo, candidatos: lista.slice(0, 5) };
  }

  // ------------------------------------------------------------------ API pública
  function leer(fuente, o) {
    o = o || {}; o.enteros = o.enteros || 5; o.decimales = o.decimales == null ? 0 : o.decimales;
    var t0 = performance.now();
    return cargarModelo().then(function (hayModelo) {
      var F = prepararFranja(fuente, o.recorte, o.enteros + o.decimales), giro = false, R = rango(o);
      var info = { nitidez: Math.round(nitidez(F.gris)), angulo: F.angulo };
      var C = null;
      if (hayModelo) {
        var F2 = girarF(F), C0 = o.forzar180 === true ? null : celdas(F, o), C1 = (o.probar180 === false || o.forzar180 != null) ? null : celdas(F2, o);
        var rojoIzq = F.rojoX != null && F.rojoX < F.img.width * 0.4, rojoDer = F.rojoX != null && F.rojoX > F.img.width * 0.5;
        function nota(c) {
          if (!c) return -1e9;
          if (R) { var dd = decodificar(c, o); if (dd) return dd.ll - Math.max(0, dd.brecha - 3) * 2; }
          return Math.log(c.conf / 100) * c.probs.length;
        }
        if (o.forzar180 === true) { F = F2; C = celdas(F2, o); giro = true; }          // el técnico indicó que está de cabeza
        else if (o.forzar180 === false) C = C0;
        else if (C1 && (rojoIzq || (!rojoDer && nota(C1) > nota(C0) + 1))) { F = F2; C = C1; giro = true; } else C = C0;
      }
      function base(d) {
        o._reflejo = F.reflejo; o._girando = F.girando;
        d.pases = d.pases || 0; d.ms = Math.round(performance.now() - t0); d.girado180 = giro;
        d.reflejo = Math.round(F.reflejo * 1000) / 10; d.nitidez = info.nitidez; d.angulo = info.angulo; d.borrosa = info.nitidez < 40;
        return d;
      }
      if (C) {
        var libre = aValor(C.texto, o.enteros, o.decimales), D = R ? decodificar(C, o) : null, minConf = Math.min.apply(null, C.simbolos.map(function (x) { return x.conf; }));
        var d;
        if (D && D.brecha <= 7) {
          var ciego = C.ciego ? aValor(C.ciego, o.enteros, o.decimales) : null;
          var seguro = D.post >= 0.9 && D.brecha <= 2.5 && F.reflejo <= 0.015 && ciego != null && Math.abs(ciego - D.valor) < 1e-9;
          d = { valor: D.valor, texto: C.texto, confianza: Math.round(100 * D.post), seguro: seguro, plausible: true,
            motivo: seguro ? 'Lectura consistente.' : (D.valor !== libre ? 'Dígito dudoso resuelto con la lectura anterior: confírmalo.' : 'Confianza baja: revisa el número.'),
            alternativa: D.segundo, metodo: 'celdas+previa' };
          if (!seguro && F.reflejo > 0.015) d.motivo = 'Hay reflejo sobre los números: confirma la lectura (o inclina un poco el teléfono y repite).';
        } else {
          d = { valor: libre, texto: C.texto, confianza: Math.round(C.conf), seguro: !R && C.conf >= 92 && minConf >= 75, plausible: R ? plausible(libre, R) : true, metodo: 'celdas' };
          d.motivo = R ? (libre < R.min ? 'La lectura es MENOR que la anterior.' : 'Consumo fuera de lo normal para este medidor.') : (d.seguro ? 'Lectura clara (sin lectura anterior para comparar).' : 'Confianza baja: revisa el número.');
        }
        d.lecturas = [C.texto + '@' + Math.round(C.conf)];
        if (d.seguro || o.soloCeldas) return base(d);
        // segunda opinión con Tesseract cuando la red no está segura
        return leerTesseract(F, o, R, giro).then(function (t) {
          d.lecturas = d.lecturas.concat(t.lecturas || []); d.pases = (t.pases || 0) + 1;
          if (t.valor != null && d.valor != null && Math.abs(t.valor - d.valor) < 1e-9 && t.plausible !== false && d.plausible) { d.seguro = d.confianza >= 60 && F.reflejo <= 0.015; d.motivo = d.seguro ? 'Lectura consistente (dos métodos coinciden).' : d.motivo; }
          else if (t.valor != null && t.plausible !== false && (t.seguro || d.valor == null || !d.plausible || (t.confianza || 0) > (d.confianza || 0) + 10)) {
            t.metodo = 'tesseract'; t.alternativa = d.valor; t.lecturas = d.lecturas; return base(t);
          }
          return base(d);
        }, function () { return base(d); });
      }
      if (!C && o.forzar180 === true && !giro) { F = girarF(F); giro = true; }
      return leerTesseract(F, o, R, giro).then(base);
    });
  }
  function leerTesseract(F, o, R, giro) {
    return motor().then(function (w) {
      var lecturas = [], i = 0;
      function siguiente() {
        if (i >= Math.min(CONF.pases, PASES.length)) return terminar();
        var c = PASES[i](F); i++;
        if (o.depurar && c && c.toDataURL) o.depurar(i, c);
        return reconocer(w, c).then(function (l) {
          l = porColor(l, F, o, giro);
          lecturas.push(l);
          var v = aValor(l.texto, o.enteros, o.decimales);
          if (v != null && l.conf >= CONF.salidaConfianza && plausible(v, R) && (i >= 2 || !R)) {
            if (i >= 2 && lecturas[0].texto !== l.texto) return siguiente();
            return terminar();
          }
          return siguiente();
        });
      }
      function terminar() {
        o._reflejo = F.reflejo; o._girando = F.girando || lecturas.some(girandoPorCajas);
        var d = decidir(lecturas, o);
        d.pases = lecturas.length; d.lecturas = lecturas.map(function (l) { return l.texto + '@' + Math.round(l.conf); });
        return d;
      }
      return siguiente();
    });
  }

  global.MM103OCR = {
    leer: leer, precargar: motor, conf: CONF,
    _interno: { girarF: girarF, celdas: celdas, decodificar: decodificar, cargarModelo: cargarModelo, aLienzo: aLienzo, digitosLimpios: digitosLimpios, componentes: componentes, binSauvola: binSauvola, desenfocar: desenfocar, aGris: aGris, renglon: renglon, prepararFranja: prepararFranja, decidir: decidir, reparar: reparar, aValor: aValor, nitidez: nitidez, PASES: PASES }
  };
})(window);
