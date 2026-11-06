/**
 * ============================================================================
 * VOLVER A ABRIR UN TRABAJO COMPLETADO — Bitácora MM103 (31 oct 2026)
 * ----------------------------------------------------------------------------
 * Quien puede enviar/editar tickets (ENVIAR_TICKET) o cargar trabajos diarios
 * (CARGAR_MODIFICAR_TAREAS) puede regresar a la cola un trabajo que se marcó
 * como completado pero quedó incompleto. Es obligatorio escribir qué hizo falta
 * y adjuntar al menos una foto. El trabajo vuelve como Pendiente y sin asignar,
 * para que lo tome y lo cierre cualquier técnico.
 * ============================================================================
 */

var MAX_FOTOS_REAPERTURA = 5;

function reabrirTrabajoCompletado(token, registroId, motivo, fotos) {
  var usuario = requiereSesion_(token);
  if (!usuarioTienePermiso_(usuario, PERMISOS.ENVIAR_TICKET) && !usuarioTienePermiso_(usuario, PERMISOS.CARGAR_MODIFICAR_TAREAS)) {
    throw new Error('Tu perfil no puede volver a abrir trabajos.');
  }
  motivo = String(motivo || '').trim();
  if (!motivo) throw new Error('Escribe qué hizo falta para volver a abrir el trabajo.');
  fotos = (Array.isArray(fotos) ? fotos : []).filter(function (f) { return f && f.base64; });
  if (!fotos.length) throw new Error('Agrega al menos una foto de lo que hace falta.');
  if (fotos.length > MAX_FOTOS_REAPERTURA) throw new Error('Puedes adjuntar máximo ' + MAX_FOTOS_REAPERTURA + ' fotos.');

  var candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    ['motivo_reapertura', 'fotos_reapertura_urls', 'reabierto_por', 'reabierto_en', 'reabierto_veces'].forEach(function (c) {
      asegurarColumna_(HOJAS.COLA, c);
    });
    var enc = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
    if (!enc) throw new Error('No existe el registro de cola "' + registroId + '".');
    var o = enc.fila.obj;
    if (o.estado !== 'Completada') {
      throw new Error('Solo se puede volver a abrir un trabajo completado (este está "' + o.estado + '").');
    }

    // Fotos de lo que hace falta: misma carpeta de Drive que las fotos de tickets.
    var urls = guardarFotosAntesTicket_('REABRIR-' + registroId, fotos);
    urls.forEach(function (u) {
      try { registrarEvidenciaFoto_(usuario.id_usuario, 'Reapertura', registroId, u); } catch (e) { console.warn('Evidencia reapertura: ' + e); }
    });

    var tipo = o.tipo_origen || 'Catalogo';
    if (tipo === 'Ticket') {
      var et = buscarFilaPorValor_('TICKETS_INDICACIONES', 'ticket_id', o.origen_id, false);
      if (et) {
        var previas = String(et.fila.obj.fotos_antes_urls || '').split('\n').map(function (x) { return x.trim(); }).filter(String);
        escribirCamposFila_(et, soloColumnasExistentes_(et, {
          estado: 'Abierto',
          dirigido_a: TICKET_ABIERTO,          // lo puede tomar cualquier técnico
          era_abierto: '',
          fotos_antes_urls: previas.concat(urls).join('\n')
        }));
      }
    } else if (tipo === 'Extra') {
      var ee = buscarFilaPorValor_(HOJAS.EXTRA, 'id', o.origen_id, false);
      if (ee && ee.fila.obj.estado === 'Completado') escribirCamposFila_(ee, soloColumnasExistentes_(ee, { estado: 'Pendiente' }));
    }

    enc = buscarFilaPorValor_(HOJAS.COLA, 'registro_id', registroId, false);
    escribirCamposFila_(enc, soloColumnasExistentes_(enc, {
      estado: 'Pendiente',
      usuario_asignado_actual: '',
      hora_inicio: '',
      hora_fin: '',
      tiempo_total_minutos: '',
      tiempo_acumulado_segundos: 0,
      motivo_pausa: '',
      pausado_por: '',
      pausado_en: '',
      motivo_reapertura: motivo,
      fotos_reapertura_urls: urls.join('\n'),
      reabierto_por: usuario.nombre_completo || usuario.id_usuario,
      reabierto_en: new Date(),
      reabierto_veces: (parseInt(o.reabierto_veces, 10) || 0) + 1
    }));
    registrarAuditoria_(usuario.id_usuario, usuario.correo, 'REABRIR_TRABAJO', HOJAS.COLA, registroId,
      'Completada por ' + (o.usuario_asignado_actual || 'sin asignar') + (o.descripcion_realizada ? ' — dijo: ' + o.descripcion_realizada : ''),
      'Pendiente — faltó: ' + motivo + ' (' + urls.length + ' foto' + (urls.length === 1 ? '' : 's') + ')');
    return { ok: true, cola: construirColaDelDia_(fechaHoy_()) };
  } finally {
    candado.releaseLock();
  }
}

/** Deja solo los campos cuya columna existe en la hoja (no inventa columnas). */
function soloColumnasExistentes_(encontrado, campos) {
  var enc = (encontrado.tabla && encontrado.tabla.encabezados) || [];
  var out = {};
  Object.keys(campos).forEach(function (k) { if (enc.indexOf(k) !== -1) out[k] = campos[k]; });
  return out;
}
