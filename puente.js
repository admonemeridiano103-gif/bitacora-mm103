/*
 * Puente offline — Bitácora de Mantenimiento MM103
 * ------------------------------------------------
 * Hace que la interfaz original de Apps Script (la misma de siempre) funcione
 * dentro de la PWA, con o sin internet:
 *   - google.script.run se sustituye por llamadas a la API (doPost).
 *   - Las consultas se guardan en la tableta y se muestran al instante.
 *   - Los trabajos de campo (tomar/completar/pausar tarea, lecturas, material,
 *     comida, tickets) se guardan primero en la tableta y se suben solos.
 * Este archivo se carga dentro de la página de la app (ver index.html).
 */
(function () {
  'use strict';
  if (window.__MM103_PUENTE) return;
  window.__MM103_PUENTE = true;

  var VERSION = '0.5.0';
  var API_URL = 'https://script.google.com/macros/s/AKfycbxzVSB0hEQgd9TW01NhmVffLJyioYIg0cRhdRcLxAbYOcT8hCvG-8yA2vi6bA8g936cRw/exec';

  var SIN_TOKEN = { login: 1, solicitarCodigoAcceso: 1, crearCredenciales: 1, restablecerPassword: 1, obtenerPermisos: 1 };
  // Consultas que se repintan solas cuando llega la versión fresca del servidor.
  var REPINTAR = {
    listarColaDelDia: 1, listarChecklistEquiposDelDia: 1, listarAlmacen: 1, listarTickets: 1, listarCatalogoTareas: 1,
    listarTrabajosExtra: 1, obtenerEstadoComidaHoy: 1, listarUsuarios: 1, listarHorarios: 1, obtenerMatrizPermisos: 1,
    listarAuditoriaReciente: 1, proximasRevisionesProgramadas: 1, listarDestinatariosTicket: 1, rolesDisponibles: 1,
    obtenerDefinicionLecturasEquipo: 1, listarCatalogoEquipos: 1, listarComidasHoyTodos: 1, listarPrestamosHerramientaMios: 1
  };
  // Trabajo de campo: se guarda primero en la tableta (respuesta inmediata) y se sube después.
  var LOCAL_PRIMERO = {
    tomarTarea: 1, completarTarea: 1, pausarTareaManual: 1, devolverTareaACola: 1, registrarLecturaEquipo: 1,
    registrarConsumoMaterial: 1, registrarSalidaMaterial: 1, registrarEntradaMaterial: 1,
    iniciarComida: 1, terminarComida: 1, atenderTicket: 1,
    // Administración (v0.4): responden al instante y se suben por detrás.
    crearTicket: 1, editarTicket: 1, cancelarTicket: 1, reabrirTrabajoCompletado: 1, moverTareaEnCola: 1, moverTicketEnCola: 1,
    actualizarPermiso: 1, cambiarEstadoTrabajoExtra: 1, cambiarActivoTarea: 1, cambiarEstadoUsuario: 1, editarUsuario: 1,
    guardarTrabajoExtra: 1, guardarTarea: 1, guardarMaterialAlmacen: 1,
    // Lecturas de medidores (v0.5)
    registrarLecturaMedidor: 1
  };
  // Se intentan en línea; si no hay señal, se guardan para subirlos después.
  var RED_PRIMERO_CON_RESPALDO = { saltarTareaConCodigo: 1, ajustarExistenciaMaterial: 1, reanudarTareaPausada: 1 };

  function esConsulta(fn) {
    return /^(listar|obtener|opciones|proximas|rolesDisponibles|validarSesion)/.test(fn);
  }
  function esErrorSesion(msg) {
    return /SESION_INVALIDA|sesi[oó]n expir|no es v[aá]lida|vuelve a iniciar sesi[oó]n|inicia sesi[oó]n de nuevo/i.test(String(msg || ''));
  }

  // ---------------------------------------------------------------- IndexedDB
  var DB = null;
  var CACHE = {};      // espejo en memoria de la caché de consultas
  var OUTBOX = [];     // operaciones pendientes por subir (en orden)
  var ERRORES = [];    // operaciones que el servidor rechazó
  var META = {};
  var METRICAS = [];
  var listo, marcarListo;
  listo = new Promise(function (r) { marcarListo = r; });

  function abrirDB() {
    return new Promise(function (res) {
      var rq;
      try { rq = indexedDB.open('bitacora_mm103', 2); } catch (e) { return res(null); }
      rq.onupgradeneeded = function () {
        var d = rq.result;
        ['meta', 'cache', 'outbox', 'errores'].forEach(function (s) { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); });
      };
      rq.onsuccess = function () { var d = rq.result; d.onversionchange = function () { d.close(); }; res(d); };
      rq.onerror = function () { res(null); };
      rq.onblocked = function () { aviso('Cierra otras pestañas de la Bitácora para continuar.'); };
    });
  }
  function todo(store) {
    return new Promise(function (res) {
      if (!DB) return res([]);
      var out = [], tx = DB.transaction(store), os = tx.objectStore(store), rq = os.openCursor();
      rq.onsuccess = function () { var c = rq.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); };
      rq.onerror = function () { res(out); };
    });
  }
  function poner(store, k, v) {
    if (!DB) return Promise.resolve();
    return new Promise(function (res) {
      try {
        var tx = DB.transaction(store, 'readwrite');
        if (v === undefined) tx.objectStore(store).delete(k); else tx.objectStore(store).put(v, k);
        tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); }; tx.onabort = function () { res(); };
      } catch (e) { res(); }
    });
  }
  function vaciar(store) {
    if (!DB) return Promise.resolve();
    return new Promise(function (res) {
      var tx = DB.transaction(store, 'readwrite'); tx.objectStore(store).clear();
      tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); };
    });
  }

  abrirDB().then(function (d) {
    DB = d;
    return Promise.all([todo('cache'), todo('outbox'), todo('errores'), todo('meta')]);
  }).then(function (r) {
    r[0].forEach(function (kv) { CACHE[kv[0]] = kv[1]; });
    OUTBOX = r[1].map(function (kv) { return kv[1]; }).sort(function (a, b) { return a.seq - b.seq; });
    ERRORES = r[2].map(function (kv) { return kv[1]; }).sort(function (a, b) { return a.seq - b.seq; });
    r[3].forEach(function (kv) { META[kv[0]] = kv[1]; });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
    marcarListo();
    pintarPastilla();
    programarSync(800);
    revisarInterfazNueva();
  });

  // Si la interfaz cambió en el servidor (por ejemplo, una mejora en Apps Script), se descarga sola.
  function revisarInterfazNueva() {
    if (!navigator.onLine) return;
    setTimeout(function () {
      post({ accion: 'fuente' }, 60000).then(function (r) {
        if (!r || !r.ok || !r.html) return;
        var actual = META.fuente;
        if (actual && actual.hash === r.hash) return;
        guardarMeta('fuente', { hash: r.hash, html: r.html, t: Date.now() });
        if (actual) avisoAccion('Hay una versión nueva de la app.', 'Recargar', function () {
          if (OUTBOX.length && !confirm('Hay cambios por subir; se conservan en la tableta. ¿Recargar?')) return;
          location.reload();
        });
      }).catch(function () {});
    }, 4000);
  }

  // ---------------------------------------------------------------- utilidades
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function clon(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  // La clave ignora el token y los argumentos vacíos al final: listarColaDelDia(TOKEN) y listarColaDelDia(TOKEN, null) son lo mismo.
  function claveCache(fn, args) {
    var a = (SIN_TOKEN[fn] ? args : args.slice(1)).slice();
    while (a.length && (a[a.length - 1] === null || a[a.length - 1] === undefined || a[a.length - 1] === '')) a.pop();
    return fn + '|' + JSON.stringify(a);
  }
  function guardarCache(clave, valor) { CACHE[clave] = { v: valor, t: Date.now() }; poner('cache', clave, CACHE[clave]); }
  function leerCache(clave) { return CACHE[clave] ? CACHE[clave].v : undefined; }
  function yo() { return META.usuario || null; }
  function guardarMeta(k, v) { META[k] = v; poner('meta', k, v); }
  function ahoraIso() { return new Date().toISOString(); }
  function enLinea() { return navigator.onLine && !SIN_RED; }
  var SIN_RED = false;

  function medir(fn, origen, t0, tRed) {
    var m = { fn: fn, origen: origen, ms: Math.round(performance.now() - t0), red: tRed == null ? null : Math.round(tRed), t: Date.now() };
    METRICAS.push(m); if (METRICAS.length > 400) METRICAS.shift();
  }

  // ---------------------------------------------------------------- red
  function post(cuerpo, ms) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var tm = ctrl ? setTimeout(function () { ctrl.abort(); }, ms || 60000) : null;
    var t0 = performance.now();
    return fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo),
      credentials: 'omit', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (tm) clearTimeout(tm);
      if (SIN_RED) { SIN_RED = false; pintarPastilla(); }
      j._ms = performance.now() - t0;
      return j;
    }, function (e) {
      if (tm) clearTimeout(tm);
      var err = new Error('Sin conexión con el servidor.'); err.red = true;
      if (!SIN_RED) { SIN_RED = true; pintarPastilla(); }
      throw err;
    });
  }
  function llamar(fn, args) {
    if (fn === 'login') {
      return post({ accion: 'login', usuario: args[0], password: args[1], dispositivo: (navigator.userAgent.match(/\(([^)]+)\)/) || [, 'tableta'])[1].slice(0, 110) })
        .then(function (r) { return { resultado: r, ms: r._ms }; });
    }
    return post({ accion: 'call', fn: fn, args: args }).then(function (r) {
      if (!r.ok) { var e = new Error(r.error || r.mensaje || 'Error del servidor.'); e.sesion = r.sesion_invalida || esErrorSesion(e.message); throw e; }
      return { resultado: r.resultado, ms: r._ms };
    });
  }

  // ---------------------------------------------------------------- respuestas optimistas
  function colaLocal() { return clon(leerCache('listarColaDelDia|[]')); }
  function setCola(c) { guardarCache('listarColaDelDia|[]', c); }
  function buscar(c, id) { for (var i = 0; c && i < c.length; i++) if (c[i].registro_id === id) return c[i]; return null; }
  function ordenar(c) { return c.slice().sort(function (a, b) { return (Number(a.orden_cola) || 0) - (Number(b.orden_cola) || 0); }); }

  var OPTIMISTA = {
    registrarLecturaMedidor: function () { return { r: { ok: true, local: true } }; },
    tomarTarea: function (a) {
      var c = colaLocal(); var me = yo(); if (!c || !me) return null;
      var regId = a[1], motivo = a[2];
      var actual = c.filter(function (f) { return f.estado === 'En proceso' && f.usuario_asignado_actual === me.id_usuario; })[0];
      var t = regId ? buscar(c, regId) : ordenar(c).filter(function (f) {
        return (f.estado === 'Pendiente' || (f.estado === 'Pausado' && f.usuario_asignado_actual === me.id_usuario)) &&
          (!f.usuario_asignado_actual || f.usuario_asignado_actual === me.id_usuario);
      })[0];
      if (!t) return { local: true, sinCola: true, r: { ok: false, mensaje: 'No hay trabajos disponibles en la cola.', cola: c } };
      if (actual && actual !== t && !motivo) return { local: true, sinCola: true, r: { ok: false, necesitaMotivo: true, cola: c } };
      var pausado = false;
      if (actual && actual !== t) { actual.estado = 'Pausado'; actual.motivo_pausa = motivo; actual.pausado_por = me.id_usuario; pausado = true; }
      var reanudado = t.estado === 'Pausado';
      t.estado = 'En proceso'; t.usuario_asignado_actual = me.id_usuario; t.hora_inicio = ahoraIso(); t.motivo_pausa = '';
      setCola(c);
      return { r: { ok: true, cola: c, tarea: { nombre_tarea: t.nombre_tarea }, registro_id: t.registro_id, pausado: pausado, reanudado: reanudado } };
    },
    completarTarea: function (a) {
      var c = colaLocal(); var t = buscar(c, a[1]); if (!t) return null;
      t.estado = 'Completada'; t.hora_fin = ahoraIso(); t.descripcion_realizada = a[2];
      setCola(c); return { r: { ok: true, cola: c } };
    },
    pausarTareaManual: function (a) {
      var c = colaLocal(); var t = buscar(c, a[1]); if (!t) return null;
      t.estado = 'Pausado'; t.motivo_pausa = a[2]; setCola(c); return { r: { ok: true, cola: c } };
    },
    devolverTareaACola: function (a) {
      var c = colaLocal(); var t = buscar(c, a[1]); if (!t) return null;
      t.estado = 'Pendiente'; t.usuario_asignado_actual = ''; setCola(c); return { r: { ok: true, cola: c } };
    },
    saltarTareaConCodigo: function (a) {
      var c = colaLocal(); var t = buscar(c, a[1]); if (!t) return null;
      t.estado = 'Saltada'; setCola(c); return { r: { ok: true, cola: c } };
    },
    reanudarTareaPausada: function (a) { return OPTIMISTA.tomarTarea([a[0], a[1], a[2]]); },
    registrarLecturaEquipo: function (a) {
      var eq = a[1]; var ch = clon(leerCache('listarChecklistEquiposDelDia|[]')) || [];
      ch.forEach(function (e) { if (e.equipo_id === eq) e.completado_hoy = true; });
      guardarCache('listarChecklistEquiposDelDia|[]', ch);
      var hechos = {}; ch.forEach(function (e) { if (e.completado_hoy) hechos[e.equipo_id] = 1; });
      var c = colaLocal(); var me = yo();
      if (c && me) c.forEach(function (f) {
        if (f.estado !== 'En proceso' || f.usuario_asignado_actual !== me.id_usuario) return;
        var eqs = (f.equipos_checklist && f.equipos_checklist.length) ? f.equipos_checklist : (f.area_o_equipo_asociado ? [f.area_o_equipo_asociado] : []);
        if (eqs.indexOf(eq) !== -1 && eqs.every(function (x) { return hechos[x]; })) { f.estado = 'Completada'; f.hora_fin = ahoraIso(); }
      });
      if (c) setCola(c);
      return { r: { ok: true, numero_accion: '(se asigna al subir)', checklist: ch, cola: c } };
    },
    registrarConsumoMaterial: function (a) { return movimiento(a[1], -Number(a[2])); },
    registrarSalidaMaterial: function (a) { return movimiento(a[1], -Number(a[2])); },
    registrarEntradaMaterial: function (a) { return movimiento(a[1], Number(a[2])); },
    ajustarExistenciaMaterial: function (a) {
      var alm = clon(leerCache('listarAlmacen|[]')); if (!alm) return null;
      alm.forEach(function (m) { if (m.material_id === a[1]) m.stock_actual = Number(a[2]); });
      guardarCache('listarAlmacen|[]', alm); return { r: { ok: true, stock_actual: Number(a[2]) } };
    },
    iniciarComida: function () {
      var est = clon(leerCache('obtenerEstadoComidaHoy|[]')) || { acumuladoMinutosPrevios: 0, sesionesPrevias: 0 };
      est.enComida = true; est.horaInicio = ahoraIso();
      guardarCache('obtenerEstadoComidaHoy|[]', est);
      var c = colaLocal(); var me = yo(); var pausada = false;
      if (c && me) c.forEach(function (f) { if (f.estado === 'En proceso' && f.usuario_asignado_actual === me.id_usuario) { f.estado = 'Pausado'; f.motivo_pausa = 'Comida'; pausada = true; } });
      if (pausada) setCola(c);
      return { r: { ok: true, tarea_pausada: pausada, estado: est, cola: pausada ? c : null } };
    },
    terminarComida: function () {
      var est = clon(leerCache('obtenerEstadoComidaHoy|[]')) || { acumuladoMinutosPrevios: 0, sesionesPrevias: 0 };
      if (est.enComida && est.horaInicio) est.acumuladoMinutosPrevios = (Number(est.acumuladoMinutosPrevios) || 0) + Math.round((Date.now() - new Date(est.horaInicio).getTime()) / 60000);
      est.enComida = false; est.horaInicio = ''; est.sesionesPrevias = (Number(est.sesionesPrevias) || 0) + 1;
      guardarCache('obtenerEstadoComidaHoy|[]', est);
      return { r: { ok: true, estado: est } };
    },
    atenderTicket: function (a) {
      var tk = clon(leerCache('listarTickets|[]')); if (!tk) return null;
      tk.forEach(function (t) { if (t.ticket_id === a[1]) t.estado = 'Atendido'; });
      guardarCache('listarTickets|[]', tk); return { r: { ok: true, tickets: tk } };
    },
    crearTicket: function (a) {
      var d = a[1] || {}; var tk = clon(leerCache('listarTickets|[]')) || []; var me = yo() || {};
      var tmp = 'TK-NUEVO-' + uuid().slice(0, 5).toUpperCase();
      tk.unshift({ ticket_id: tmp, estado: 'Abierto', mensaje: d.mensaje, prioridad: d.prioridad, dirigido_a: d.dirigido_a,
        creado_por_nombre: me.nombre_completo || '', fecha_hora_creacion: new Date().toLocaleString('es-MX') });
      guardarCache('listarTickets|[]', tk);
      var c = colaLocal();
      if (c) {
        c.unshift({ registro_id: 'REG-' + tmp, tipo_origen: 'Ticket', origen_id: tmp, nombre_tarea: d.mensaje || 'Ticket', prioridad: d.prioridad || 'Media',
          estado: 'Pendiente', usuario_asignado_actual: (d.dirigido_a && d.dirigido_a !== 'ABIERTO') ? d.dirigido_a : '', orden_cola: 0, posicion: 0 });
        setCola(numerar(c));
      }
      return { tmp: tmp, r: { ok: true, ticket_id: tmp, tickets: tk, cola: c } };
    },
    editarTicket: function (a) {
      var id = a[1], cb = a[2] || {}; var tk = clon(leerCache('listarTickets|[]')); if (!tk) return { r: { ok: true } };
      tk.forEach(function (t) { if (t.ticket_id === id) ['mensaje', 'prioridad', 'dirigido_a'].forEach(function (k) { if (cb[k] !== undefined && String(cb[k]).trim() !== '') t[k] = cb[k]; }); });
      guardarCache('listarTickets|[]', tk);
      var c = colaLocal();
      if (c) { c.forEach(function (f) { if (f.tipo_origen === 'Ticket' && f.origen_id === id) { if (cb.mensaje) f.nombre_tarea = cb.mensaje; if (cb.prioridad) f.prioridad = cb.prioridad; } }); setCola(c); }
      return { r: { ok: true, tickets: tk, cola: c } };
    },
    cancelarTicket: function (a) {
      var id = a[1]; var tk = clon(leerCache('listarTickets|[]')) || [];
      tk.forEach(function (t) { if (t.ticket_id === id) t.estado = 'Cancelado'; });
      guardarCache('listarTickets|[]', tk);
      var c = colaLocal();
      if (c) { c = c.filter(function (f) { return !(f.tipo_origen === 'Ticket' && f.origen_id === id && f.estado !== 'Completada'); }); setCola(numerar(c)); }
      return { r: { ok: true, tickets: tk, cola: c } };
    },
    reabrirTrabajoCompletado: function (a) {
      var c = colaLocal(); var t = buscar(c, a[1]); if (!t) return null; var me = yo() || {};
      t.estado = 'Pendiente'; t.usuario_asignado_actual = ''; t.hora_inicio = ''; t.hora_fin = ''; t.tiempo_total_minutos = '';
      t.motivo_reapertura = a[2]; t.reabierto_por = me.nombre_completo || ''; t.reabierto_veces = (Number(t.reabierto_veces) || 0) + 1;
      t.fotos_reapertura = [];
      setCola(c); return { r: { ok: true, cola: c } };
    },
    moverTareaEnCola: function (a) { return moverEnCola(a[1], a[2]); },
    moverTicketEnCola: function (a) { return moverEnCola(a[1], a[2]); },
    actualizarPermiso: function () { return { r: { ok: true } }; },
    cambiarEstadoTrabajoExtra: function (a) {
      parcharListas('listarTrabajosExtra|', function (l) { l.forEach(function (x) { if (x.id === a[1]) x.estado = a[2]; }); });
      return { r: { ok: true } };
    },
    cambiarActivoTarea: function (a) {
      parcharListas('listarCatalogoTareas|', function (l) { l.forEach(function (x) { if (x.tarea_id === a[1]) x.activo = a[2]; }); });
      return { r: { ok: true } };
    },
    cambiarEstadoUsuario: function (a) {
      parcharListas('listarUsuarios|', function (l) { l.forEach(function (x) { if (x.id_usuario === a[1]) x.estado = a[2]; }); });
      return { r: { ok: true } };
    },
    editarUsuario: function (a) {
      var d = a[2] || {};
      parcharListas('listarUsuarios|', function (l) { l.forEach(function (x) { if (x.id_usuario === a[1]) Object.keys(d).forEach(function (k) { x[k] = d[k]; }); }); });
      return { r: { ok: true } };
    },
    // Las altas nuevas necesitan el número que da el servidor: solo las ediciones van al instante.
    guardarTrabajoExtra: function (a) {
      var d = a[1] || {}; if (!d.id) return null;
      parcharListas('listarTrabajosExtra|', function (l) { l.forEach(function (x) { if (x.id === d.id) Object.keys(d).forEach(function (k) { x[k] = d[k]; }); }); });
      return { r: { ok: true, id: d.id } };
    },
    guardarTarea: function (a) {
      var d = a[1] || {}; if (!d.tarea_id) return null;
      parcharListas('listarCatalogoTareas|', function (l) { l.forEach(function (x) { if (x.tarea_id === d.tarea_id) Object.keys(d).forEach(function (k) { x[k] = d[k]; }); }); });
      return { r: { ok: true, tarea_id: d.tarea_id } };
    },
    guardarMaterialAlmacen: function (a) {
      var d = a[1] || {}; if (!d.material_id) return null;
      parcharListas('listarAlmacen|', function (l) { l.forEach(function (x) { if (x.material_id === d.material_id) Object.keys(d).forEach(function (k) { x[k] = d[k]; }); }); });
      return { r: { ok: true, material_id: d.material_id } };
    }
  };
  function numerar(c) { ordenar(c).forEach(function (f, i) { f.posicion = i + 1; f.orden_cola = i + 1; }); return ordenar(c); }
  function moverEnCola(regId, destino) {
    var c = colaLocal(); if (!c) return null;
    var lista = ordenar(c); var i = lista.findIndex(function (f) { return f.registro_id === regId; }); if (i < 0) return null;
    var item = lista.splice(i, 1)[0]; var j;
    if (destino === 'subir' || destino === 'arriba') j = Math.max(0, i - 1);
    else if (destino === 'bajar' || destino === 'abajo') j = Math.min(lista.length, i + 1);
    else if (!isNaN(Number(destino))) j = Math.max(0, Math.min(lista.length, Number(destino) - 1));
    else return null;
    lista.splice(j, 0, item);
    lista.forEach(function (f, k) { f.posicion = k + 1; f.orden_cola = k + 1; });
    setCola(lista); return { r: { ok: true, cola: lista } };
  }
  function parcharListas(prefijo, fn) {
    Object.keys(CACHE).forEach(function (k) {
      if (k.indexOf(prefijo) !== 0) return;
      var l = clon(CACHE[k].v); if (!Array.isArray(l)) return;
      fn(l); guardarCache(k, l);
    });
  }
  // Un ticket creado sin esperar al servidor lleva un número temporal; al subirse se cambia por el real
  // en lo que siga pendiente (editar o cancelar ese mismo ticket, por ejemplo).
  function cambiarIdTemporal(tmp, real) {
    if (!tmp || !real || tmp === real) return;
    OUTBOX.forEach(function (o) {
      var txt = JSON.stringify(o.args);
      if (txt.indexOf(tmp) === -1) return;
      o.args = JSON.parse(txt.split(tmp).join(real)); poner('outbox', o.opId, o);
    });
  }
  function movimiento(materialId, delta) {
    var alm = clon(leerCache('listarAlmacen|[]')); if (!alm) return null;
    var nuevo = null;
    alm.forEach(function (m) { if (m.material_id === materialId) { m.stock_actual = Math.round(((Number(m.stock_actual) || 0) + delta) * 1000) / 1000; nuevo = m.stock_actual; } });
    guardarCache('listarAlmacen|[]', alm);
    return { r: { ok: true, stock_actual: nuevo } };
  }

  // Cuando el servidor contesta un cambio, sus datos frescos actualizan la caché y la pantalla.
  function aplicarDatosServidor(r) {
    if (!r || typeof r !== 'object') return;
    if (Array.isArray(r.cola)) { setCola(r.cola); repintar('pintarColaHoy', r.cola, 'tbodyColaHoy'); }
    if (Array.isArray(r.checklist)) { guardarCache('listarChecklistEquiposDelDia|[]', r.checklist); repintar('pintarChecklistEquipos', r.checklist); }
    if (Array.isArray(r.tickets)) { guardarCache('listarTickets|[]', r.tickets); repintar('pintarTickets', r.tickets); }
    if (r.estado && typeof r.estado === 'object' && 'enComida' in r.estado) { guardarCache('obtenerEstadoComidaHoy|[]', r.estado); repintar('pintarEstadoComida', r.estado); }
  }
  function repintar(nombre, datos, idRequerido) {
    try {
      if (typeof window[nombre] !== 'function') return;
      if (idRequerido && !document.getElementById(idRequerido)) return;
      if (!window.ESTADO || !window.ESTADO.usuarioActual) return;
      window[nombre](datos);
    } catch (e) { console.warn('repintar ' + nombre, e); }
  }

  // ---------------------------------------------------------------- bandeja de salida
  var seq = Date.now();
  function encolar(fn, args, tmp) {
    var op = { opId: uuid(), fn: fn, args: args, ts: Date.now(), seq: seq++, intentos: 0, tmp: tmp || null };
    OUTBOX.push(op); poner('outbox', op.opId, op); pintarPastilla();
    return op;
  }
  var sincronizando = false, timerSync = null, espera = 2000;
  function programarSync(ms) { clearTimeout(timerSync); timerSync = setTimeout(sincronizar, ms); }

  function sincronizar() {
    if (sincronizando || !OUTBOX.length) { pintarPastilla(); return Promise.resolve(); }
    if (!navigator.onLine) { programarSync(15000); return Promise.resolve(); }
    sincronizando = true; pintarPastilla();
    var op = OUTBOX[0];
    return post({ accion: 'ops', ops: [{ opId: op.opId, fn: op.fn, args: op.args, ts: op.ts }] }, 90000).then(function (resp) {
      var res = resp && resp.resultados && resp.resultados[0];
      if (!res) throw new Error('Respuesta incompleta');
      var valor = res.resultado;
      if (!res.ok && (res.sesion_invalida || esErrorSesion(res.error))) {
        sincronizando = false; META.sesionVencida = true; pintarPastilla();
        aviso('Tu sesión venció. Vuelve a entrar; los cambios pendientes se suben después.');
        return;
      }
      quitarDeBandeja(op);
      METRICAS.push({ fn: op.fn, origen: 'subida', ms: null, red: Math.round(resp._ms), t: Date.now() });
      if (res.ok && !(valor && valor.ok === false)) {
        if (op.tmp && valor && valor.ticket_id) cambiarIdTemporal(op.tmp, valor.ticket_id);
        aplicarDatosServidor(valor);
      } else {
        var msg = res.error || (valor && (valor.mensaje || (valor.necesitaMotivo ? 'Faltó indicar el motivo de la pausa.' : ''))) || 'El servidor no aceptó el cambio.';
        var e = { opId: op.opId, fn: op.fn, ts: op.ts, mensaje: msg, seq: op.seq };
        ERRORES.push(e); poner('errores', e.opId, e);
        aviso('No se pudo aplicar "' + nombreAccion(op.fn) + '": ' + msg);
        if (valor) aplicarDatosServidor(valor);
      }
      espera = 2000; sincronizando = false;
      if (OUTBOX.length) return sincronizar();
      META.ultimaSync = Date.now(); guardarMeta('ultimaSync', META.ultimaSync);
      refrescarPantalla();
    }).catch(function (e) {
      sincronizando = false; op.intentos++; poner('outbox', op.opId, op);
      espera = Math.min(espera * 2, 60000); programarSync(espera);
    }).then(function () { pintarPastilla(); });
  }
  function quitarDeBandeja(op) {
    OUTBOX = OUTBOX.filter(function (o) { return o.opId !== op.opId; });
    poner('outbox', op.opId, undefined);
  }
  function nombreAccion(fn) {
    return ({ tomarTarea: 'Tomar tarea', completarTarea: 'Completar tarea', pausarTareaManual: 'Pausar tarea', devolverTareaACola: 'Regresar a la cola',
      registrarLecturaEquipo: 'Lectura de equipo', registrarConsumoMaterial: 'Consumo de material', registrarSalidaMaterial: 'Salida de material',
      registrarEntradaMaterial: 'Entrada de material', iniciarComida: 'Iniciar comida', terminarComida: 'Terminar comida', atenderTicket: 'Atender ticket',
      crearTicket: 'Crear ticket', saltarTareaConCodigo: 'Saltar tarea', ajustarExistenciaMaterial: 'Ajustar existencia',
      editarTicket: 'Editar ticket', cancelarTicket: 'Cancelar ticket', reabrirTrabajoCompletado: 'Volver a abrir trabajo', moverTareaEnCola: 'Mover en la cola',
      moverTicketEnCola: 'Mover ticket', actualizarPermiso: 'Cambiar permiso', cambiarEstadoTrabajoExtra: 'Estado de trabajo extra', cambiarActivoTarea: 'Activar/desactivar tarea',
      cambiarEstadoUsuario: 'Estado de usuario', editarUsuario: 'Editar usuario', guardarTrabajoExtra: 'Editar trabajo extra', guardarTarea: 'Editar tarea', guardarMaterialAlmacen: 'Editar material' })[fn] || fn;
  }
  // Tras subir todo, pide al servidor las listas frescas y repinta lo que esté a la vista.
  function refrescarPantalla() {
    if (!window.TOKEN || !window.ESTADO || !window.ESTADO.usuarioActual) return;
    var p = window.ESTADO.usuarioActual.permisos || {};
    var pares = [['listarColaDelDia', 'pintarColaHoy'], ['listarChecklistEquiposDelDia', 'pintarChecklistEquipos'], ['listarTickets', 'pintarTickets'], ['listarAlmacen', 'pintarAlmacen'],
      ['listarTrabajosExtra', 'pintarTrabajosExtra'], ['listarCatalogoTareas', 'pintarCatalogoTareas'], ['listarUsuarios', 'pintarUsuarios']];
    pares.forEach(function (par) {
      if (typeof window[par[1]] !== 'function') return;
      // Solo listas que la tableta ya tiene (o sea, que esta persona puede ver).
      var claves = Object.keys(CACHE).filter(function (k) { return k.indexOf(par[0] + '|') === 0; });
      if (!claves.length && par[0] !== 'listarColaDelDia') return;
      var extra = claves.length ? JSON.parse(claves[0].slice(par[0].length + 1)) : [];
      llamar(par[0], [window.TOKEN].concat(extra)).then(function (x) {
        var clave = claveCache(par[0], [window.TOKEN].concat(extra));
        var antes = JSON.stringify(leerCache(clave));
        guardarCache(clave, x.resultado);
        if (JSON.stringify(x.resultado) !== antes) repintar(par[1], x.resultado);
      }).catch(function () {});
    });
  }

  // ---------------------------------------------------------------- google.script.run
  function Runner(exito, fallo, objeto) { this._s = exito; this._f = fallo; this._u = objeto; }
  Runner.prototype.withSuccessHandler = function (f) { return new Runner(f, this._f, this._u); };
  Runner.prototype.withFailureHandler = function (f) { return new Runner(this._s, f, this._u); };
  Runner.prototype.withUserObject = function (o) { return new Runner(this._s, this._f, o); };

  function ejecutar(runner, fn, args) {
    var t0 = performance.now();
    var hecho = false;
    function ok(v, origen, tRed) {
      medir(fn, origen, t0, tRed);
      if (runner._s) try { runner._s(v, runner._u); } catch (e) { console.error(e); }
    }
    function mal(msg, origen) {
      medir(fn, origen || 'error', t0);
      var e = new Error(msg); e.message = msg;
      if (runner._f) try { runner._f(e, runner._u); } catch (x) { console.error(x); } else console.error(msg);
    }
    listo.then(function () { procesar(fn, args, ok, mal); });
  }

  function procesar(fn, args, ok, mal) {
    // --- sesión
    if (fn === 'login' || fn === 'crearCredenciales') {
      if (!navigator.onLine) return mal('Para entrar necesitas internet la primera vez.');
      return llamar(fn, args).then(function (x) {
        var r = x.resultado;
        if (r && r.ok && r.usuario) {
          if (!META.usuario || META.usuario.id_usuario !== r.usuario.id_usuario) { CACHE = {}; vaciar('cache'); }
          guardarMeta('usuario', r.usuario); META.sesionVencida = false;
          guardarCache('validarSesion|[]', { ok: true, usuario: r.usuario });
          programarSync(500);
        }
        ok(r, 'red', x.ms);
      }, function (e) { mal(e.message); });
    }
    if (fn === 'cerrarSesion') {
      if (OUTBOX.length) return mal('Tienes ' + OUTBOX.length + ' cambio(s) sin subir. Conéctate a internet y espera a que se suban antes de cerrar sesión.');
      var tk = args[0];
      if (navigator.onLine) post({ accion: 'cerrarSesion', token: tk }).catch(function () {});
      CACHE = {}; vaciar('cache'); guardarMeta('usuario', null);
      return ok({ ok: true }, 'local');
    }

    var clave = claveCache(fn, args);

    // --- consultas
    if (esConsulta(fn)) {
      var enCache = leerCache(clave);
      if (fn === 'validarSesion') {
        if (enCache !== undefined && enCache && enCache.ok) {
          ok(clon(enCache), 'cache');
          if (navigator.onLine) llamar(fn, args).then(function (x) {
            guardarCache(clave, x.resultado);
            if (x.resultado && x.resultado.usuario) guardarMeta('usuario', x.resultado.usuario);
            if (x.resultado && x.resultado.ok === false) { try { localStorage.clear(); } catch (e) {} location.reload(); }
          }, function () {});
          return;
        }
        return llamar(fn, args).then(function (x) {
          guardarCache(clave, x.resultado);
          if (x.resultado && x.resultado.usuario) guardarMeta('usuario', x.resultado.usuario);
          ok(x.resultado, 'red', x.ms);
        }, function (e) {
          if (e.red) return mal('Sin conexión y sin datos guardados en esta tableta. Conéctate a internet una vez para descargarlos.');
          mal(e.message);
        });
      }
      if (enCache !== undefined && REPINTAR[fn]) {
        ok(clon(enCache), 'cache');
        if (navigator.onLine && !OUTBOX.length) llamar(fn, args).then(function (x) {
          var antes = JSON.stringify(leerCache(clave));
          guardarCache(clave, x.resultado);
          if (JSON.stringify(x.resultado) !== antes) ok(x.resultado, 'red', x.ms);
        }, function () {});
        return;
      }
      return llamar(fn, args).then(function (x) {
        guardarCache(clave, x.resultado); ok(x.resultado, 'red', x.ms);
      }, function (e) {
        if (e.red && enCache !== undefined) return ok(clon(enCache), 'cache');
        if (e.red) return mal('Sin conexión: esta información todavía no está guardada en la tableta.');
        mal(e.message);
      });
    }

    // --- trabajo de campo: primero en la tableta
    if (LOCAL_PRIMERO[fn] && OPTIMISTA[fn]) {
      var o = OPTIMISTA[fn](args);
      if (o) {
        if (!o.sinCola) { encolar(fn, args, o.tmp); programarSync(50); }
        return ok(o.r, 'local');
      }
    }

    // --- en línea, con respaldo a la bandeja si no hay señal
    if (RED_PRIMERO_CON_RESPALDO[fn] || LOCAL_PRIMERO[fn]) {
      var optimista = function () {
        var p = OPTIMISTA[fn] ? OPTIMISTA[fn](args) : null;
        encolar(fn, args); programarSync(15000);
        ok(p ? p.r : { ok: true, pendiente: true }, 'local');
        aviso('Sin señal: "' + nombreAccion(fn) + '" quedó guardado en la tableta y se subirá solo.');
      };
      if (OUTBOX.length || !navigator.onLine) return optimista();
      var op = { opId: uuid(), fn: fn, args: args, ts: Date.now() };
      return post({ accion: 'ops', ops: [op] }, 15000).then(function (resp) {
        var res = resp.resultados && resp.resultados[0];
        if (!res.ok) return mal(res.error);
        aplicarDatosServidor(res.resultado);
        ok(res.resultado, 'red', resp._ms);
      }, function (e) {
        // No sabemos si llegó: se reintenta con el MISMO opId (el servidor no lo repite).
        op.seq = seq++; op.intentos = 0; OUTBOX.push(op); poner('outbox', op.opId, op); pintarPastilla(); programarSync(15000);
        var p = OPTIMISTA[fn] ? OPTIMISTA[fn](args) : null;
        ok(p ? p.r : { ok: true, pendiente: true }, 'respaldo');
        aviso('Sin señal: "' + nombreAccion(fn) + '" quedó guardado en la tableta y se subirá solo.');
      });
    }

    // --- todo lo demás (administración): en línea
    if (!navigator.onLine) return mal('Sin conexión: esta acción necesita internet.');
    llamar(fn, args).then(function (x) { aplicarDatosServidor(x.resultado); ok(x.resultado, 'red', x.ms); },
      function (e) { mal(e.red ? 'Sin conexión: esta acción necesita internet.' : e.message); });
  }

  function envolver(r) {
    return new Proxy(r, {
      get: function (t, prop) {
        if (prop === 'withSuccessHandler' || prop === 'withFailureHandler' || prop === 'withUserObject') {
          return function (x) { return envolver(Runner.prototype[prop].call(t, x)); };
        }
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        return function () { ejecutar(t, String(prop), Array.prototype.slice.call(arguments)); };
      }
    });
  }
  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script, 'run', { get: function () { return envolver(new Runner()); }, configurable: true });
  window.google.script.host = window.google.script.host || { close: function () {}, setHeight: function () {}, setWidth: function () {} };

  // ---------------------------------------------------------------- interfaz del puente
  var css = [
    '#mmPastilla{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:2147483000;font:600 13px system-ui,sans-serif;',
    'padding:8px 12px;border-radius:999px;border:0;box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer;min-height:36px;color:#fff;background:#1e7d3c}',
    '#mmPastilla.pend{background:#9a5b00}#mmPastilla.off{background:#5d6b76}#mmPastilla.err{background:#b3261e}',
    '#mmHoja{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.4);display:flex;align-items:flex-end;justify-content:center}',
    '#mmHoja .c{background:#fff;color:#14212b;width:100%;max-width:560px;max-height:85vh;overflow:auto;border-radius:16px 16px 0 0;padding:16px 16px calc(16px + env(safe-area-inset-bottom));font:15px/1.4 system-ui,sans-serif}',
    '#mmHoja h3{margin:0 0 8px;font-size:17px}#mmHoja .m{color:#5d6b76;font-size:13px}#mmHoja .b{display:block;width:100%;min-height:46px;margin:8px 0 0;border:0;border-radius:12px;font:600 15px system-ui;background:#0f5e63;color:#fff;cursor:pointer}',
    '#mmHoja .b.s{background:#e3f1f1;color:#0f5e63}#mmHoja .e{background:#fbe6e4;color:#b3261e;border-radius:10px;padding:8px 10px;margin:6px 0;font-size:13px}',
    '#mmHoja table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}#mmHoja td{padding:3px 4px;border-bottom:1px solid #eee}',
    '#mmAviso{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top));transform:translateX(-50%);z-index:2147483002;background:#14212b;color:#fff;padding:10px 14px;border-radius:12px;font:14px system-ui;max-width:calc(100% - 32px);box-shadow:0 4px 14px rgba(0,0,0,.3)}',
    '@media (prefers-color-scheme: dark){#mmHoja .c{background:#182027;color:#e6edf2}#mmHoja .m{color:#9aa9b4}#mmHoja td{border-color:#2a353e}}'
  ].join('');
  function asegurarUI() {
    if (!document.body) return false;
    if (!document.getElementById('mmEstilo')) {
      var st = document.createElement('style'); st.id = 'mmEstilo'; st.textContent = css; document.head.appendChild(st);
    }
    if (!document.getElementById('mmPastilla')) {
      var b = document.createElement('button'); b.id = 'mmPastilla'; b.type = 'button'; b.onclick = abrirHoja; document.body.appendChild(b);
    }
    return true;
  }
  function pintarPastilla() {
    if (!asegurarUI()) return;
    var b = document.getElementById('mmPastilla');
    var n = OUTBOX.length;
    var txt, cls = '';
    if (ERRORES.length) { txt = '⚠ ' + ERRORES.length + ' con problema'; cls = 'err'; }
    else if (n) { txt = (sincronizando ? '↻ Subiendo ' : '⏳ ') + n + ' por subir'; cls = 'pend'; }
    else if (!enLinea()) { txt = '✈ Sin conexión'; cls = 'off'; }
    else { txt = '✔ Sincronizado'; }
    if (n && !enLinea()) { txt = '✈ ' + n + ' por subir'; cls = 'off'; }
    b.textContent = txt; b.className = cls;
  }
  function percentil(arr, p) { if (!arr.length) return '—'; var s = arr.slice().sort(function (a, b) { return a - b; }); return s[Math.min(s.length - 1, Math.floor(p * s.length))] + ' ms'; }
  function abrirHoja() {
    cerrarHoja();
    var loc = METRICAS.filter(function (m) { return m.ms != null && m.origen !== 'red' && m.origen !== 'error'; }).map(function (m) { return m.ms; });
    var red = METRICAS.filter(function (m) { return m.red != null; }).map(function (m) { return m.red; });
    var h = document.createElement('div'); h.id = 'mmHoja';
    h.innerHTML = '<div class="c"><h3>Sincronización</h3>' +
      '<div class="m">' + (enLinea() ? 'Con conexión' : 'Sin conexión') + ' · ' + OUTBOX.length + ' cambio(s) por subir' +
      (META.ultimaSync ? ' · última subida ' + new Date(META.ultimaSync).toLocaleString('es-MX') : '') + '</div>' +
      (META.sesionVencida ? '<div class="e">Tu sesión venció: cierra la app y vuelve a entrar para terminar de subir.</div>' : '') +
      (OUTBOX.length ? '<table>' + OUTBOX.slice(0, 30).map(function (o) { return '<tr><td>' + nombreAccion(o.fn) + '</td><td class="m">' + new Date(o.ts).toLocaleTimeString('es-MX') + (o.intentos ? ' · ' + o.intentos + ' intento(s)' : '') + '</td></tr>'; }).join('') + '</table>' : '') +
      (ERRORES.length ? '<h3 style="margin-top:12px">Con problema</h3>' + ERRORES.map(function (e) { return '<div class="e"><b>' + nombreAccion(e.fn) + '</b> (' + new Date(e.ts).toLocaleString('es-MX') + '): ' + String(e.mensaje).replace(/</g, '&lt;') + '</div>'; }).join('') +
        '<button class="b s" id="mmLimpiarErr">Ya lo revisé, quitar avisos</button>' : '') +
      '<h3 style="margin-top:12px">Tiempos de respuesta</h3><table>' +
      '<tr><td>En la tableta (toques)</td><td>p50 ' + percentil(loc, 0.5) + '</td><td>p95 ' + percentil(loc, 0.95) + '</td></tr>' +
      '<tr><td>Servidor de Google</td><td>p50 ' + percentil(red, 0.5) + '</td><td>p95 ' + percentil(red, 0.95) + '</td></tr></table>' +
      '<div class="m">Muestras: ' + loc.length + ' locales, ' + red.length + ' de servidor.</div>' +
      '<button class="b" id="mmSync">Subir ahora</button>' +
      '<button class="b s" id="mmCopia">Descargar copia de lo guardado</button>' +
      '<button class="b s" id="mmCerrar">Cerrar</button>' +
      '<div class="m" style="margin-top:8px;text-align:center">Puente offline v' + VERSION + '</div></div>';
    h.addEventListener('click', function (ev) { if (ev.target === h) cerrarHoja(); });
    document.body.appendChild(h);
    document.getElementById('mmCerrar').onclick = cerrarHoja;
    document.getElementById('mmSync').onclick = function () { espera = 2000; SIN_RED = false; sincronizar().then(abrirHoja); };
    document.getElementById('mmCopia').onclick = descargarCopia;
    var le = document.getElementById('mmLimpiarErr');
    if (le) le.onclick = function () { ERRORES = []; vaciar('errores'); pintarPastilla(); abrirHoja(); };
  }
  function cerrarHoja() { var h = document.getElementById('mmHoja'); if (h) h.remove(); }
  function descargarCopia() {
    var datos = { app: 'Bitácora MM103 offline', version: VERSION, exportado: ahoraIso(), usuario: yo(), pendientes: OUTBOX, con_problema: ERRORES,
      datos_guardados: Object.keys(CACHE).reduce(function (o, k) { o[k] = CACHE[k]; return o; }, {}), metricas: METRICAS };
    var blob = new Blob([JSON.stringify(datos, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'bitacora_mm103_copia_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function avisoAccion(msg, boton, fn) {
    aviso(msg, 20000);
    var d = document.getElementById('mmAviso'); if (!d) return;
    var b = document.createElement('button'); b.textContent = boton;
    b.style.cssText = 'margin-left:10px;min-height:36px;border:0;border-radius:10px;padding:6px 12px;font:600 14px system-ui;background:#4fb3b8;color:#0f1418;cursor:pointer';
    b.onclick = fn; d.appendChild(b);
  }
  var tAviso;
  function aviso(msg, dur) {
    if (!document.body) return;
    var d = document.getElementById('mmAviso'); if (d) d.remove();
    d = document.createElement('div'); d.id = 'mmAviso'; d.textContent = msg; document.body.appendChild(d);
    clearTimeout(tAviso); tAviso = setTimeout(function () { d.remove(); }, dur || 5000);
  }

  window.addEventListener('online', function () { SIN_RED = false; pintarPastilla(); espera = 2000; programarSync(300); });
  window.addEventListener('offline', pintarPastilla);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') programarSync(300); });
  document.addEventListener('DOMContentLoaded', pintarPastilla);
  setInterval(function () { if (OUTBOX.length) programarSync(0); }, 60000);
  if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(function (reg) {
      if (reg.sync && reg.sync.register) reg.sync.register('mm103-subir').catch(function () {});
    }).catch(function () {});
    var habiaControl = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (habiaControl) avisoAccion('La app se actualizó.', 'Recargar', function () { location.reload(); });
      habiaControl = true;
    });
    navigator.serviceWorker.addEventListener('message', function (ev) { if (ev.data === 'mm103-subir') programarSync(0); });
  }

  // ---------------------------------------------------------------- mejoras de interfaz (estilo Mi Clóset)
  // 1) Cada campo de foto muestra dos botones grandes: Tomar foto / Elegir de la galería.
  function mejorarFotos(raiz) {
    var campos = (raiz || document).querySelectorAll('input[type=file]:not([data-mm])');
    Array.prototype.forEach.call(campos, function (orig) {
      if (!/image/.test(orig.accept || '')) return;
      orig.setAttribute('data-mm', '1');
      orig.classList.add('mm-foto-oculto');
      function ayudante(camara) {
        var i = document.createElement('input');
        i.type = 'file'; i.accept = 'image/*'; i.className = 'mm-foto-oculto'; i.setAttribute('data-mm', '1');
        if (camara) i.setAttribute('capture', 'environment');
        if (orig.multiple && !camara) i.multiple = true;
        i.addEventListener('change', function () {
          if (!i.files || !i.files.length) return;
          try {
            var dt = new DataTransfer();
            Array.prototype.forEach.call(i.files, function (f) { dt.items.add(f); });
            orig.files = dt.files;
            orig.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (e) { console.warn('foto', e); }
          i.value = '';
        });
        return i;
      }
      var cam = ayudante(true), gal = ayudante(false);
      var caja = document.createElement('div'); caja.className = 'mm-foto-acciones';
      var b1 = document.createElement('button'); b1.type = 'button'; b1.textContent = '📷 Tomar foto'; b1.onclick = function () { cam.click(); };
      var b2 = document.createElement('button'); b2.type = 'button'; b2.textContent = '🖼 Elegir de la galería'; b2.onclick = function () { gal.click(); };
      caja.appendChild(b1); caja.appendChild(b2); caja.appendChild(cam); caja.appendChild(gal);
      orig.parentNode.insertBefore(caja, orig.nextSibling);
    });
  }
  // 2) En pantallas angostas, cada renglón de tabla se ve como tarjeta (con la etiqueta de cada dato).
  function mejorarTablas(raiz) {
    var tablas = (raiz || document).querySelectorAll('table');
    Array.prototype.forEach.call(tablas, function (t) {
      if (t.closest('.tabla-sticky-wrap')) return;            // la matriz de permisos se queda como tabla
      var ths = t.querySelectorAll('thead th'); if (!ths.length) return;
      t.classList.add('mm-tarjetas');
      var et = Array.prototype.map.call(ths, function (h) { return h.textContent.trim(); });
      var iTitulo = et.findIndex(function (x) { return /^(Tarea|Material|Nombre|Equipo|Mensaje|Descripción|Técnico)$/i.test(x); });
      Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
        Array.prototype.forEach.call(tr.children, function (td, k) {
          if (td.getAttribute('data-mm-l') === '1') return;
          td.setAttribute('data-mm-l', '1');
          if (td.hasAttribute('colspan')) return;
          var tieneBoton = !!td.querySelector('button');
          if (tieneBoton && !td.textContent.replace(/\s/g, '').replace(/[^\w]/g, '').length || (tieneBoton && !et[k])) td.classList.add('mm-acciones');
          else if (k === iTitulo) td.classList.add('mm-titulo');
          else if (et[k]) td.setAttribute('data-et', et[k]);
          if (!td.textContent.trim() && !td.querySelector('img,button,input,select')) td.classList.add('mm-vacia');
        });
      });
    });
  }
  // Mosaico "Lecturas de medidores" en el menú principal (módulo lecturas.js, se carga al abrirlo)
  function mosaicoLecturas() {
    var menu = document.querySelector('.cuadricula-menu');
    if (!menu || menu.querySelector('.mm-lecturas') || !window.TOKEN) return;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'boton-menu mm-lecturas';
    b.innerHTML = '<span class="boton-menu-icono">📟</span><span>Lecturas de medidores</span>';
    b.onclick = function () {
      var abrir = function () { window.MM103Lecturas.abrir(); };
      if (window.MM103Lecturas) return abrir();
      var s = document.createElement('script'); s.src = new URL('lecturas.js', location.href).href; s.onload = abrir;
      s.onerror = function () { aviso('No se pudo abrir el módulo de lecturas.'); }; document.head.appendChild(s);
    };
    menu.appendChild(b);
  }
  var mejoraPendiente = false;
  function programarMejoras() {
    if (mejoraPendiente) return; mejoraPendiente = true;
    requestAnimationFrame(function () { mejoraPendiente = false; try { mejorarFotos(); mejorarTablas(); mosaicoLecturas(); } catch (e) { console.warn(e); } });
  }
  function iniciarMejoras() {
    programarMejoras();
    try { new MutationObserver(programarMejoras).observe(document.body, { childList: true, subtree: true }); } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarMejoras); else iniciarMejoras();

  // Para pruebas y diagnóstico
  window.MM103 = {
    version: VERSION,
    estado: function () { return { pendientes: OUTBOX.length, errores: ERRORES.length, cache: Object.keys(CACHE).length, enLinea: enLinea(), usuario: yo() }; },
    metricas: function () { return METRICAS.slice(); },
    sincronizar: function () { espera = 2000; return sincronizar(); },
    listo: listo
  };
})();
