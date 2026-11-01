/* MM103 · Lecturas de medidores de agua y gas (módulo de la Bitácora offline).
 * Escanear QR -> foto con marco guía -> lectura automática (sin internet) -> confirmar -> bandeja -> Sheets.
 */
(function (global) {
  'use strict';
  var BASE = (document.currentScript && document.currentScript.src || './lecturas.js').replace(/[^/]*$/, '');
  global.MM103_OCR_BASE = BASE + 'ocr/';
  var FORMATO = { AGUA: { enteros: 5, decimales: 0, aspecto: 4.0 }, GAS: { enteros: 5, decimales: 2, aspecto: 6.4 } };
  var PADRON = [], LOCAL = {}, raiz = null, flujo = null, actual = null, ultimaFoto = null, girarExtra = 0;

  // ------------------------------------------------------------------ almacenamiento local (IndexedDB)
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (ok) {
      var rq; try { rq = indexedDB.open('mm103_lecturas', 1); } catch (e) { return ok(null); }
      rq.onupgradeneeded = function () { rq.result.createObjectStore('lecturas'); };
      rq.onsuccess = function () { ok(rq.result); }; rq.onerror = function () { ok(null); };
    });
    return dbP;
  }
  function guardarLocal(k, v) { LOCAL[k] = v; return db().then(function (d) { if (d) try { d.transaction('lecturas', 'readwrite').objectStore('lecturas').put(v, k); } catch (e) {} }); }
  function cargarLocal() {
    return db().then(function (d) {
      if (!d) return;
      return new Promise(function (ok) {
        var st = d.transaction('lecturas').objectStore('lecturas'), rq = st.openCursor();
        rq.onsuccess = function () { var c = rq.result; if (c) { LOCAL[c.key] = c.value; c.continue(); } else ok(); };
        rq.onerror = function () { ok(); };
      });
    });
  }
  function periodo() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }
  function clave(m) { return periodo() + '|' + m.unidad + '|' + m.tipo; }

  // ------------------------------------------------------------------ padrón
  function cargarPadron() {
    return new Promise(function (ok) {
      var listo = false;
      function respaldo() { fetch(BASE + 'medidores.json').then(function (r) { return r.json(); }).then(function (l) { if (!listo) { listo = true; PADRON = l; ok(); } }).catch(function () { if (!listo) { listo = true; ok(); } }); }
      try {
        global.google.script.run.withSuccessHandler(function (r) {
          if (r && r.ok && r.medidores && r.medidores.length) { listo = true; PADRON = r.medidores; ok(); } else respaldo();
        }).withFailureHandler(respaldo).obtenerPadronMedidores(global.TOKEN);
      } catch (e) { respaldo(); }
      setTimeout(function () { if (!listo) respaldo(); }, 6000);
    });
  }
  function nombreUnidad(m) {
    var u = m.unidad;
    if (/^Local/i.test(u)) return u.toUpperCase();
    if (/^ADM/i.test(u)) return 'ÁREAS COMUNES (' + u + ')';
    return 'DEPTO ' + u.replace(/[A-D]$/, '');
  }
  function fmt(v, dec) { return v == null || v === '' ? '—' : Number(v).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // ------------------------------------------------------------------ interfaz
  var CSS = '#mmL{position:fixed;inset:0;z-index:9000;background:var(--gris,#f3f5f6);color:var(--texto,#14212b);overflow:auto;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-user-select:none;user-select:none}' +
    '#mmL *{box-sizing:border-box}#mmL .bar{position:sticky;top:0;z-index:2;background:#0f5e63;color:#fff;display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 12px 10px}' +
    '#mmL .bar h1{font-size:18px;margin:0;flex:1}#mmL .bar button{background:rgba(255,255,255,.15);color:#fff;border:0;border-radius:12px;min-height:44px;padding:8px 14px;font-size:15px;font-weight:600}' +
    '#mmL .cont{max-width:760px;margin:0 auto;padding:14px 16px 90px}' +
    '#mmL .tarj{background:var(--mm-card,#fff);border:1px solid var(--borde,#dde3e7);border-radius:16px;padding:16px;margin-bottom:14px}' +
    '#mmL .big{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;min-height:110px;border:0;border-radius:18px;font-size:19px;font-weight:700;background:#0f5e63;color:#fff;margin-bottom:12px}' +
    '#mmL .big span{font-size:38px}#mmL .fila{display:flex;gap:10px;flex-wrap:wrap}#mmL .fila>*{flex:1 1 150px}' +
    '#mmL .btn{min-height:54px;border:0;border-radius:14px;font-size:17px;font-weight:700;padding:10px 14px;background:var(--mm-brand-2,#e3f1f1);color:#0f5e63}' +
    '#mmL .btn.pri{background:#0f5e63;color:#fff}#mmL .btn.ok{background:#1e7d3c;color:#fff}#mmL .btn.mal{background:#fbe6e4;color:#b3261e}' +
    '#mmL input[type=search],#mmL input[type=text],#mmL textarea{width:100%;min-height:52px;font-size:17px;border:1px solid var(--borde,#dde3e7);border-radius:14px;padding:10px 14px;background:var(--mm-input,#fff);color:inherit;font-family:inherit}' +
    '#mmL .lectura{width:100%;font-size:44px!important;font-weight:800;text-align:center;letter-spacing:2px;min-height:84px!important;border-radius:16px!important;border:3px solid #0f5e63!important;background:var(--mm-input,#fff);color:inherit;font-family:ui-monospace,Menlo,monospace}' +
    '#mmL .chip{display:inline-block;padding:6px 12px;border-radius:999px;font-size:14px;font-weight:700}' +
    '#mmL .verde{background:#e4f4e8;color:#1e7d3c}#mmL .ambar{background:#fdf1dc;color:#9a5b00}#mmL .rojo{background:#fbe6e4;color:#b3261e}#mmL .gris{background:#eef1f3;color:#5d6b76}' +
    '#mmL .muted{color:var(--mm-muted,#5d6b76);font-size:14px}#mmL .item{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 4px;border-bottom:1px solid var(--borde,#dde3e7)}' +
    '#mmL .item:last-child{border-bottom:0}#mmL .cam{position:relative;background:#000;border-radius:16px;overflow:hidden;aspect-ratio:3/4;max-height:62vh;width:100%}' +
    '#mmL .cam video,#mmL .cam img{width:100%;height:100%;object-fit:cover;display:block}#mmL .guia{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:86%;border:3px solid #39e07a;border-radius:10px;box-shadow:0 0 0 2000px rgba(0,0,0,.45)}' +
    '#mmL .guia i{position:absolute;left:0;right:0;top:-30px;text-align:center;color:#fff;font-style:normal;font-weight:700;font-size:14px;text-shadow:0 1px 3px #000}' +
    '#mmL .qrmarco{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:62%;aspect-ratio:1;border:4px solid #39e07a;border-radius:18px;box-shadow:0 0 0 2000px rgba(0,0,0,.4)}' +
    '#mmL .flot{position:absolute;right:10px;bottom:10px;display:flex;gap:8px}#mmL .flot button{min-height:46px;min-width:46px;border-radius:50%;border:0;background:rgba(255,255,255,.9);font-size:20px}' +
    '#mmL .grande{font-size:30px;font-weight:800;margin:4px 0}#mmL .recorte{width:100%;border-radius:10px;border:1px solid var(--borde,#dde3e7);background:#000;margin-top:8px;display:block}' +
    '#mmL .sel{position:absolute;border:3px solid #39e07a;border-radius:8px;touch-action:none}#mmL .sel b{position:absolute;right:-14px;bottom:-14px;width:28px;height:28px;border-radius:50%;background:#39e07a}' +
    '#mmL .barra{height:10px;border-radius:99px;background:#e3e8eb;overflow:hidden}#mmL .barra div{height:100%;background:#1e7d3c}' +
    '@media (prefers-color-scheme:dark){#mmL .verde{background:#16301f;color:#6fd08c}#mmL .ambar{background:#3a2c12;color:#f2b84b}#mmL .rojo{background:#3d1b19;color:#ff8a80}#mmL .gris{background:#222c33;color:#9aa9b4}}';

  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function abrir() {
    if (!raiz) {
      var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
      raiz = el('<div id="mmL"></div>'); document.body.appendChild(raiz);
    }
    raiz.style.display = 'block'; document.documentElement.style.overflow = 'hidden';
    pintar('<div class="cont"><p class="muted">Cargando padrón de medidores…</p></div>', 'Lecturas de medidores');
    Promise.all([cargarPadron(), cargarLocal()]).then(inicio);
    try { cargarScript(BASE + 'ocr/digitos.js').then(function () { return cargarScript(BASE + 'ocr/ocr.js'); }).then(function () { global.MM103OCR._interno.cargarModelo(); }); } catch (e) {}
  }
  function cerrar() { pararCamara(); if (raiz) raiz.style.display = 'none'; document.documentElement.style.overflow = ''; }
  var scripts = {};
  function cargarScript(src) {
    if (scripts[src]) return scripts[src];
    scripts[src] = new Promise(function (ok, mal) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { delete scripts[src]; mal(new Error('No se pudo cargar ' + src)); }; document.head.appendChild(s); });
    return scripts[src];
  }
  function pintar(html, titulo, atras) {
    raiz.innerHTML = '<div class="bar"><button data-a="atras">' + (atras ? '← Atrás' : '✕ Cerrar') + '</button><h1>' + esc(titulo) + '</h1></div>' + html;
    raiz.querySelector('[data-a=atras]').onclick = function () { pararCamara(); if (atras) atras(); else cerrar(); };
    raiz.scrollTop = 0;
  }

  // ------------------------------------------------------------------ pantalla de inicio
  function inicio() {
    pararCamara();
    var tot = { AGUA: 0, GAS: 0 }, hechos = { AGUA: 0, GAS: 0 };
    PADRON.forEach(function (m) { tot[m.tipo]++; if (LOCAL[clave(m)]) hechos[m.tipo]++; });
    function barra(t) { var p = tot[t] ? Math.round(100 * hechos[t] / tot[t]) : 0; return '<div class="item"><div><b>' + (t === 'AGUA' ? '💧 Agua' : '🔥 Gas') + '</b><div class="muted">' + hechos[t] + ' de ' + tot[t] + ' este mes</div></div><div style="flex:0 0 40%"><div class="barra"><div style="width:' + p + '%"></div></div></div></div>'; }
    pintar('<div class="cont">' +
      '<button class="big" data-a="qr"><span>▦</span>Escanear QR del medidor</button>' +
      '<div class="tarj"><input type="search" placeholder="Buscar: 201A, 1804C, Local 03…" data-a="buscar"><div data-a="res"></div></div>' +
      '<div class="tarj"><b>Avance de ' + periodo() + '</b>' + barra('AGUA') + barra('GAS') +
      '<div class="fila" style="margin-top:10px"><button class="btn" data-a="pend">Ver pendientes</button></div></div>' +
      '<p class="muted">Funciona sin internet. Las lecturas se guardan en la tableta y se suben solas cuando hay señal.</p></div>', 'Lecturas de medidores');
    raiz.querySelector('[data-a=qr]').onclick = escanear;
    raiz.querySelector('[data-a=pend]').onclick = pendientes;
    var b = raiz.querySelector('[data-a=buscar]'), res = raiz.querySelector('[data-a=res]');
    b.oninput = function () {
      var q = b.value.trim().toUpperCase().replace(/\s+/g, ''); if (q.length < 2) { res.innerHTML = ''; return; }
      var l = PADRON.filter(function (m) { return m.unidad.toUpperCase().replace(/\s+/g, '').indexOf(q) !== -1; }).slice(0, 20);
      res.innerHTML = l.map(filaMedidor).join('') || '<p class="muted">Sin resultados.</p>';
      enlazarFilas(res);
    };
  }
  function filaMedidor(m) {
    var hecho = LOCAL[clave(m)];
    return '<div class="item" data-u="' + esc(m.unidad) + '" data-t="' + m.tipo + '"><div><b>' + esc(m.torre) + ' · ' + esc(nombreUnidad(m)) + '</b><div class="muted">' + (m.tipo === 'AGUA' ? '💧 Agua' : '🔥 Gas') + ' · anterior ' + fmt(m.ultima, FORMATO[m.tipo].decimales) + '</div></div>' +
      (hecho ? '<span class="chip verde">✓ ' + fmt(hecho.lectura, FORMATO[m.tipo].decimales) + '</span>' : '<button class="btn pri" style="min-height:44px">Leer</button>') + '</div>';
  }
  function enlazarFilas(cont) {
    Array.prototype.forEach.call(cont.querySelectorAll('.item[data-u]'), function (n) {
      n.onclick = function () { var m = buscarMedidor(n.getAttribute('data-u'), n.getAttribute('data-t')); if (m) tomar(m); };
    });
  }
  function pendientes() {
    var porTorre = {};
    PADRON.forEach(function (m) { if (!LOCAL[clave(m)]) (porTorre[m.torre] = porTorre[m.torre] || []).push(m); });
    var html = Object.keys(porTorre).sort().map(function (t) { return '<div class="tarj"><b>' + esc(t) + ' (' + porTorre[t].length + ')</b>' + porTorre[t].map(filaMedidor).join('') + '</div>'; }).join('');
    pintar('<div class="cont">' + (html || '<div class="tarj">🎉 Todas las lecturas de este mes están tomadas.</div>') + '</div>', 'Pendientes', inicio);
    enlazarFilas(raiz);
  }
  function buscarMedidor(u, t) { for (var i = 0; i < PADRON.length; i++) if (PADRON[i].unidad === u && PADRON[i].tipo === t) return PADRON[i]; return null; }

  // ------------------------------------------------------------------ cámara
  var flujoVideo = null;
  function pararCamara() { if (flujoVideo) { flujoVideo.getTracks().forEach(function (t) { t.stop(); }); flujoVideo = null; } if (flujo) { cancelAnimationFrame(flujo); flujo = null; } }
  function iniciarCamara(video) {
    pararCamara();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('Este navegador no permite usar la cámara en vivo.'));
    return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }).then(function (s) {
      flujoVideo = s; video.srcObject = s; video.setAttribute('playsinline', ''); video.muted = true;
      var tr = s.getVideoTracks()[0];
      try { tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {}); } catch (e) {}
      return video.play().then(function () { return tr; });
    });
  }
  function linterna(tr, on) { try { return tr.applyConstraints({ advanced: [{ torch: on }] }); } catch (e) { return Promise.reject(e); } }

  // ------------------------------------------------------------------ QR
  function escanear() {
    pintar('<div class="cont"><div class="cam"><video></video><div class="qrmarco"></div></div>' +
      '<p class="muted" style="text-align:center">Apunta al código QR de la etiqueta del medidor.</p>' +
      '<div class="fila"><button class="btn" data-a="buscar">Buscar a mano</button></div><p data-a="err" class="muted"></p></div>', 'Escanear QR', inicio);
    raiz.querySelector('[data-a=buscar]').onclick = inicio;
    var video = raiz.querySelector('video'), lienzo = document.createElement('canvas'), cx = lienzo.getContext('2d', { willReadFrequently: true });
    var detector = null; try { if ('BarcodeDetector' in global) detector = new global.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) {}
    var cargaQR = global.jsQR ? Promise.resolve() : cargarScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
    iniciarCamara(video).then(function () {
      var ocupado = false;
      function ciclo() {
        flujo = requestAnimationFrame(ciclo);
        if (ocupado || video.readyState < 2) return; ocupado = true;
        var w = video.videoWidth, h = video.videoHeight, s = Math.min(1, 900 / Math.max(w, h));
        lienzo.width = Math.round(w * s); lienzo.height = Math.round(h * s); cx.drawImage(video, 0, 0, lienzo.width, lienzo.height);
        var p = detector ? detector.detect(lienzo).then(function (r) { return r[0] && r[0].rawValue; }) :
          cargaQR.then(function () { var im = cx.getImageData(0, 0, lienzo.width, lienzo.height), r = global.jsQR(im.data, im.width, im.height, { inversionAttempts: 'dontInvert' }); return r && r.data; });
        p.then(function (txt) { ocupado = false; if (txt) leidoQR(txt); }, function () { ocupado = false; detector = null; });
      }
      ciclo();
    }, function (e) { raiz.querySelector('[data-a=err]').textContent = e.message + ' Usa "Buscar a mano".'; });
  }
  function leidoQR(txt) {
    var u, t;
    try { var j = JSON.parse(txt); u = j.u; t = String(j.t || '').toUpperCase(); } catch (e) { var p = String(txt).split(/[|,;]/); u = p[0]; t = String(p[1] || '').toUpperCase(); }
    var m = buscarMedidor(String(u || '').trim(), t);
    if (!m) { var e2 = raiz.querySelector('[data-a=err]'); if (e2) e2.textContent = 'El QR "' + txt + '" no corresponde a un medidor del padrón.'; return; }
    try { navigator.vibrate && navigator.vibrate(80); } catch (e) {}
    pararCamara(); tomar(m);
  }

  // ------------------------------------------------------------------ toma de lectura
  function orientacion(m) { try { return localStorage.getItem('mm103_or_' + m.unidad + '_' + m.tipo); } catch (e) { return null; } }
  function guardarOrientacion(m, v) { try { localStorage.setItem('mm103_or_' + m.unidad + '_' + m.tipo, v); } catch (e) {} }
  function anteriorDe(m) { var h = LOCAL[clave(m)]; return h && h.anterior != null ? h.anterior : m.ultima; }
  function tomar(m) {
    actual = m; girarExtra = orientacion(m) === 'cabeza' ? 180 : 0; var F = FORMATO[m.tipo], ant = anteriorDe(m);
    pintar('<div class="cont"><div class="tarj"><div class="muted">' + esc(m.torre) + ' · ' + (m.tipo === 'AGUA' ? '💧 AGUA' : '🔥 GAS') + '</div><div class="grande">' + esc(nombreUnidad(m)) + '</div>' +
      '<div>Lectura anterior: <b>' + fmt(ant, F.decimales) + ' m³</b> <span class="muted">' + esc(m.fecha || '') + (m.prom ? ' · promedio ' + fmt(m.prom, 1) + ' m³/mes' : '') + '</span></div></div>' +
      '<div class="cam"><video></video><div class="guia" style="aspect-ratio:' + F.aspecto + '"><i>' + (m.tipo === 'GAS' ? 'Rodillos negros y rojos dentro del marco' : 'Los 5 números dentro del marco') + '</i></div>' +
      '<div class="flot"><button data-a="luz" title="Linterna">🔦</button></div></div>' +
      '<div class="fila" style="margin-top:10px"><button class="btn" data-a="voltear">🔄 Medidor de cabeza: <b data-a="vtxt"></b></button></div>' +
      '<div class="fila" style="margin-top:12px"><button class="btn pri" data-a="foto" style="min-height:64px;font-size:19px">📷 Tomar foto</button></div>' +
      '<div class="fila" style="margin-top:10px"><button class="btn" data-a="gal">🖼️ Elegir de galería</button><button class="btn" data-a="cam2">📱 Cámara del teléfono</button><button class="btn" data-a="mano">⌨️ Escribir</button></div>' +
      '<input type="file" accept="image/*" data-a="fgal" hidden><input type="file" accept="image/*" capture="environment" data-a="fcam" hidden>' +
      '<p class="muted" data-a="msg">Acércate hasta que los números llenen el marco. Si hay reflejo, inclina un poco el teléfono.</p></div>', 'Tomar lectura', inicio);
    var video = raiz.querySelector('video'), guia = raiz.querySelector('.guia'), pista = null, luz = false;
    function pintarOrientacion() {   // la vista se voltea para que el técnico vea los números derechos ANTES de la foto
      video.style.transform = girarExtra === 180 ? 'rotate(180deg)' : '';
      raiz.querySelector('[data-a=vtxt]').textContent = girarExtra === 180 ? 'SÍ (vista volteada)' : 'no';
    }
    raiz.querySelector('[data-a=voltear]').onclick = function () { girarExtra = girarExtra === 180 ? 0 : 180; guardarOrientacion(m, girarExtra === 180 ? 'cabeza' : 'normal'); pintarOrientacion(); };
    pintarOrientacion();
    iniciarCamara(video).then(function (tr) { pista = tr; }, function (e) { var n = raiz.querySelector('[data-a=msg]'); if (n) n.textContent = e.message + ' Usa la galería o la cámara del teléfono.'; });
    raiz.querySelector('[data-a=luz]').onclick = function () { if (pista) { luz = !luz; linterna(pista, luz).catch(function () { raiz.querySelector('[data-a=msg]').textContent = 'Esta cámara no tiene linterna.'; }); } };
    raiz.querySelector('[data-a=foto]').onclick = function () {
      if (!flujoVideo || video.readyState < 2) return;
      var rec = recorteDeVideo(video, guia), fotos = [];
      raiz.querySelector('[data-a=msg]').textContent = 'Leyendo…';
      // ráfaga de 3 cuadros: se vota para resistir desenfoque y reflejos que se mueven
      (function capt(i) {
        var c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight; c.getContext('2d').drawImage(video, 0, 0); fotos.push(c);
        if (i < 2) setTimeout(function () { capt(i + 1); }, 140); else { pararCamara(); leerYMostrar(fotos, rec); }
      })(0);
    };
    var fg = raiz.querySelector('[data-a=fgal]'), fc = raiz.querySelector('[data-a=fcam]');
    raiz.querySelector('[data-a=gal]').onclick = function () { fg.click(); };
    raiz.querySelector('[data-a=cam2]').onclick = function () { fc.click(); };
    fg.onchange = fc.onchange = function (ev) { var f = ev.target.files && ev.target.files[0]; if (f) { pararCamara(); ajustarFoto(f); } };
    raiz.querySelector('[data-a=mano]').onclick = function () { pararCamara(); resultado(null, null, null); };
  }
  // Convierte el marco guía (pantalla) a coordenadas del video (object-fit: cover)
  function recorteDeVideo(video, guia) {
    var vb = video.getBoundingClientRect(), gb = guia.getBoundingClientRect(), vw = video.videoWidth, vh = video.videoHeight;
    var esc2 = Math.max(vb.width / vw, vb.height / vh), dw = vw * esc2, dh = vh * esc2, ox = (vb.width - dw) / 2, oy = (vb.height - dh) / 2;
    return { x: (gb.left - vb.left - ox) / dw, y: (gb.top - vb.top - oy) / dh, w: gb.width / dw, h: gb.height / dh };
  }
  // Foto de galería: el técnico ajusta el marco sobre los números
  function ajustarFoto(archivo) {
    var url = URL.createObjectURL(archivo), img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas'), max = 2000, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); vistaAjuste(c);
    };
    img.src = url;
  }
  function girar90(c) { var d = document.createElement('canvas'); d.width = c.height; d.height = c.width; var x = d.getContext('2d'); x.translate(d.width / 2, d.height / 2); x.rotate(Math.PI / 2); x.drawImage(c, -c.width / 2, -c.height / 2); return d; }
  function vistaAjuste(c) {
    var F = FORMATO[actual.tipo];
    pintar('<div class="cont"><p class="muted">Arrastra el marco verde sobre los números (esquina para cambiar tamaño).</p>' +
      '<div style="position:relative" data-a="lienzo"><img style="width:100%;display:block;border-radius:12px" alt="Foto del medidor"><div class="sel"><b></b></div></div>' +
      '<div class="fila" style="margin-top:12px"><button class="btn" data-a="rot">↻ Girar 90°</button><button class="btn" data-a="rot180">🔄 Girar 180°</button><button class="btn pri" data-a="leer">Leer números</button></div></div>', 'Ajustar foto', function () { tomar(actual); });
    var cont = raiz.querySelector('[data-a=lienzo]'), im = cont.querySelector('img'), sel = cont.querySelector('.sel');
    function cargar() {
      im.src = c.toDataURL('image/jpeg', 0.85);
      im.onload = function () { var W = im.clientWidth, w = W * 0.7, h = w / F.aspecto; pos = { x: (W - w) / 2, y: (im.clientHeight - h) / 2, w: w, h: h }; dib(); };
    }
    var pos = { x: 0, y: 0, w: 100, h: 30 };
    function dib() { sel.style.left = pos.x + 'px'; sel.style.top = pos.y + 'px'; sel.style.width = pos.w + 'px'; sel.style.height = pos.h + 'px'; }
    var arr = null;
    sel.addEventListener('pointerdown', function (e) { sel.setPointerCapture(e.pointerId); arr = { x: e.clientX, y: e.clientY, p: Object.assign({}, pos), tam: e.target.tagName === 'B' }; e.preventDefault(); });
    sel.addEventListener('pointermove', function (e) {
      if (!arr) return; var dx = e.clientX - arr.x, dy = e.clientY - arr.y;
      if (arr.tam) { pos.w = Math.max(40, arr.p.w + dx); pos.h = Math.max(16, arr.p.h + dy); } else { pos.x = arr.p.x + dx; pos.y = arr.p.y + dy; }
      dib();
    });
    sel.addEventListener('pointerup', function () { arr = null; });
    raiz.querySelector('[data-a=rot]').onclick = function () { c = girar90(c); cargar(); };
    raiz.querySelector('[data-a=rot180]').onclick = function () { c = girar90(girar90(c)); var or = orientacion(actual); guardarOrientacion(actual, or === 'cabeza' ? 'normal' : 'cabeza'); cargar(); };
    raiz.querySelector('[data-a=leer]').onclick = function () {
      var W = im.clientWidth, H = im.clientHeight;
      leerYMostrar([c], { x: pos.x / W, y: pos.y / H, w: pos.w / W, h: pos.h / H });
    };
    cargar();
  }

  function leerYMostrar(fotos, rec) {
    var m = actual, F = FORMATO[m.tipo], ant = anteriorDe(m);
    pintar('<div class="cont"><div class="tarj" style="text-align:center"><div class="grande">Leyendo números…</div><p class="muted">Sin internet, en la tableta.</p></div></div>', 'Tomar lectura', function () { tomar(m); });
    var or = orientacion(m), o = { enteros: F.enteros, decimales: F.decimales, tipo: m.tipo, recorte: rec, previa: ant, promedio: m.prom, maximo: m.max, forzar180: or === 'cabeza' ? true : or === 'normal' ? false : undefined };
    var listo = global.MM103OCR ? Promise.resolve() : cargarScript(BASE + 'ocr/digitos.js').then(function () { return cargarScript(BASE + 'ocr/ocr.js'); });
    listo.then(function () {
      var res = [];
      return fotos.reduce(function (p, f, i) {
        return p.then(function () {
          if (i > 0 && res[0] && res[0].seguro) return;          // el primer cuadro ya es seguro
          return global.MM103OCR.leer(f, Object.assign({}, o, { soloCeldas: i > 0 })).then(function (r) { res.push(r); });
        });
      }, Promise.resolve()).then(function () {
        // voto entre cuadros
        var votos = {}; res.forEach(function (r) { if (r.valor != null) { var k = String(r.valor); votos[k] = (votos[k] || 0) + (r.seguro ? 2 : 1); } });
        var gana = Object.keys(votos).sort(function (a, b) { return votos[b] - votos[a]; })[0];
        var mejor = res.filter(function (r) { return String(r.valor) === gana; })[0] || res[0];
        if (mejor && res.length > 1 && !mejor.seguro && votos[gana] >= 3) mejor.motivo = 'Coinciden varios cuadros; confirma el número.';
        resultado(mejor, fotos[0], rec);
      });
    }).catch(function (e) { console.warn(e); resultado(null, fotos[0], rec); });
  }

  // ------------------------------------------------------------------ resultado y validación
  function evaluar(m, v) {
    var ant = anteriorDe(m), F = FORMATO[m.tipo];
    if (v == null || v === '' || isNaN(v)) return { cls: 'gris', txt: 'Escribe la lectura.', bloquea: true };
    if (ant == null) return { cls: 'gris', txt: 'Sin lectura anterior para comparar.' };
    var c = Math.round((v - ant) * 1000) / 1000, tope = Math.max(m.max ? m.max * 3 : 0, m.prom ? m.prom * 6 : 0, m.tipo === 'GAS' ? 15 : 25);
    if (c < 0) return { cls: 'rojo', txt: 'La lectura es MENOR que la anterior (' + fmt(c, F.decimales) + ' m³). ¿Cambiaron el medidor o se leyó mal?', confirmar: true, alerta: 'MENOR_QUE_ANTERIOR', consumo: c };
    if (c > tope) return { cls: 'ambar', txt: 'Consumo muy alto: ' + fmt(c, F.decimales) + ' m³ (normal ~' + fmt(m.prom, 1) + '). Revisa posible fuga o error.', confirmar: true, alerta: 'CONSUMO_ALTO', consumo: c };
    if (c === 0) return { cls: 'ambar', txt: 'Sin consumo este periodo (0 m³).', alerta: 'SIN_CONSUMO', consumo: c };
    return { cls: 'verde', txt: 'Consumo: ' + fmt(c, F.decimales) + ' m³', consumo: c };
  }
  function resultado(r, foto, rec) {
    var m = actual, F = FORMATO[m.tipo], ant = anteriorDe(m);
    ultimaFoto = { foto: foto, rec: rec, ocr: r };
    var valor = r && r.valor != null ? Number(r.valor).toFixed(F.decimales) : '';
    var estado = !r ? '' : r.seguro ? '<span class="chip verde">✓ ' + esc(r.motivo) + '</span>' : '<span class="chip ' + (r.plausible === false ? 'rojo' : 'ambar') + '">⚠ ' + esc(r.motivo || 'Revisa el número') + '</span>';
    var recorte = '';
    if (foto && rec) {
      var c = document.createElement('canvas'), W = foto.width, H = foto.height, hx = rec.w * 0.05, hy = rec.h * 0.15;
      var sx = Math.max(0, (rec.x - hx) * W), sy = Math.max(0, (rec.y - hy) * H), sw = Math.min(W - sx, (rec.w + 2 * hx) * W), sh = Math.min(H - sy, (rec.h + 2 * hy) * H);
      c.width = Math.min(900, Math.round(sw)); c.height = Math.round(c.width * sh / sw);
      c.getContext('2d').drawImage(foto, sx, sy, sw, sh, 0, 0, c.width, c.height);
      if (r && r.girado180) { var c2 = girar90(girar90(c)); c = c2; }
      ultimaFoto.recorte = c; recorte = '<img class="recorte" alt="Números del medidor" src="' + c.toDataURL('image/jpeg', 0.85) + '">';
    }
    pintar('<div class="cont"><div class="tarj"><div class="muted">' + esc(m.torre) + ' · ' + esc(nombreUnidad(m)) + ' · ' + m.tipo + '</div>' +
      '<div>Anterior: <b>' + fmt(ant, F.decimales) + ' m³</b></div>' + recorte + '</div>' +
      '<div class="tarj"><label class="muted" for="mmLval">Lectura nueva (m³)</label>' +
      '<input id="mmLval" class="lectura" inputmode="decimal" autocomplete="off" value="' + valor + '" placeholder="' + (F.decimales ? '00000.00' : '00000') + '">' +
      '<div style="margin-top:10px">' + estado + '</div>' +
      (r && !r.seguro && r.alternativa != null && r.alternativa !== r.valor ? '<div class="muted" style="margin-top:6px">Otra posibilidad: <a href="#" data-a="alt">' + Number(r.alternativa).toFixed(F.decimales) + '</a></div>' : '') +
      '<div data-a="eval" style="margin-top:10px"></div>' +
      '<label data-a="conf" style="display:none;margin-top:10px;align-items:center;gap:10px"><input type="checkbox" style="width:26px;height:26px"> <b>Confirmo que la lectura es correcta</b></label>' +
      '<textarea data-a="nota" placeholder="Nota (opcional; obligatoria si hay alerta)" style="margin-top:10px;display:none"></textarea></div>' +
      '<div class="fila" style="margin-bottom:10px"><button class="btn" data-a="flip">🔄 Los números se ven de cabeza</button></div>' +
      '<div class="fila"><button class="btn" data-a="otra">📷 Otra foto</button><button class="btn ok" data-a="guardar" style="min-height:64px;font-size:19px">✅ Guardar</button></div></div>', 'Confirmar lectura', function () { tomar(m); });
    var inp = raiz.querySelector('#mmLval'), ev = raiz.querySelector('[data-a=eval]'), conf = raiz.querySelector('[data-a=conf]'), nota = raiz.querySelector('[data-a=nota]'), estadoAct = null;
    function revisar() {
      var v = inp.value.replace(',', '.').trim(); estadoAct = evaluar(m, v === '' ? null : Number(v));
      ev.innerHTML = '<span class="chip ' + estadoAct.cls + '">' + esc(estadoAct.txt) + '</span>';
      conf.style.display = estadoAct.confirmar ? 'flex' : 'none'; nota.style.display = estadoAct.alerta && estadoAct.alerta !== 'SIN_CONSUMO' ? 'block' : 'none';
    }
    inp.oninput = revisar; revisar();
    var alt = raiz.querySelector('[data-a=alt]'); if (alt) alt.onclick = function (e) { e.preventDefault(); inp.value = alt.textContent; revisar(); };
    if (!r || !r.seguro) setTimeout(function () { inp.focus(); inp.select(); }, 150);   // si hay duda, el teclado aparece listo
    raiz.querySelector('[data-a=otra]').onclick = function () { tomar(m); };
    var flip = raiz.querySelector('[data-a=flip]');
    if (!foto) flip.style.display = 'none';
    flip.onclick = function () {      // corrige la orientación y vuelve a leer la misma foto
      var ahora = r && r.girado180; guardarOrientacion(m, ahora ? 'normal' : 'cabeza');
      leerYMostrar([foto], rec);
    };
    raiz.querySelector('[data-a=guardar]').onclick = function () {
      revisar();
      if (estadoAct.bloquea) { inp.focus(); return; }
      if (estadoAct.confirmar && !conf.querySelector('input').checked) { conf.style.outline = '3px solid #b3261e'; conf.scrollIntoView({ block: 'center' }); return; }
      if (estadoAct.confirmar && !nota.value.trim()) { nota.placeholder = 'Escribe por qué (p. ej. medidor cambiado, fuga, local vacío)'; nota.focus(); return; }
      guardar(m, Number(inp.value.replace(',', '.')), estadoAct, nota.value.trim());
    };
  }
  function jpeg(c, max, q) {
    if (!c) return null; var s = Math.min(1, max / Math.max(c.width, c.height)), d = document.createElement('canvas');
    d.width = Math.round(c.width * s); d.height = Math.round(c.height * s); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height);
    return { base64: d.toDataURL('image/jpeg', q).split(',')[1], mime: 'image/jpeg' };
  }
  function guardar(m, v, est, nota) {
    var ant = anteriorDe(m), r = ultimaFoto && ultimaFoto.ocr;
    var datos = {
      unidad: m.unidad, tipo: m.tipo, lectura: v, anterior: ant, alerta: est.alerta || '', nota: nota,
      ocr: r ? { valor: r.valor, confianza: r.confianza, metodo: (r.metodo || '') + (r.seguro ? ' seguro' : ' revisado') } : { metodo: 'manual' },
      foto: ultimaFoto && ultimaFoto.foto ? jpeg(ultimaFoto.foto, 1280, 0.6) : null,
      recorte: ultimaFoto && ultimaFoto.recorte ? jpeg(ultimaFoto.recorte, 700, 0.8) : null
    };
    var registro = { lectura: v, anterior: ant, ts: Date.now(), alerta: datos.alerta };
    guardarLocal(clave(m), registro);
    try {
      global.google.script.run.withSuccessHandler(function () {}).withFailureHandler(function (e) { console.warn('Lectura', e); }).registrarLecturaMedidor(global.TOKEN, datos);
    } catch (e) { console.warn(e); }
    try { navigator.vibrate && navigator.vibrate([60, 40, 60]); } catch (e) {}
    pintar('<div class="cont"><div class="tarj" style="text-align:center"><div style="font-size:54px">✅</div><div class="grande">' + fmt(v, FORMATO[m.tipo].decimales) + ' m³</div>' +
      '<div class="muted">' + esc(m.torre) + ' · ' + esc(nombreUnidad(m)) + ' · ' + m.tipo + '</div><p>Guardada en la tableta. Se sube sola cuando hay señal.</p></div>' +
      '<button class="big" data-a="sig"><span>▦</span>Siguiente medidor</button><div class="fila"><button class="btn" data-a="ini">Inicio</button></div></div>', 'Lectura guardada', inicio);
    raiz.querySelector('[data-a=sig]').onclick = escanear;
    raiz.querySelector('[data-a=ini]').onclick = inicio;
  }

  global.MM103Lecturas = { abrir: abrir, cerrar: cerrar, _padron: function () { return PADRON; }, _leidoQR: leidoQR, _resultado: resultado, _tomar: tomar, _vistaAjuste: vistaAjuste, _leerYMostrar: leerYMostrar };
})(window);
