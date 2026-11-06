# Plan de modificación: Bitácora de Mantenimiento MM103 (v2)

Fecha: 6 de noviembre de 2026
Estado de partida: versión 58 publicada en Apps Script (Código.gs dividido en 6 módulos desde la V38, más Api_Offline.gs y Reapertura.gs) y versión offline (PWA) en GitHub Pages con puente.js, piel.css y sw.js.

Nota: el plan se armó con las notas del proyecto. Claude Code debe verificar nombres de funciones, hojas y columnas antes de tocar nada. La app vinculada (script.google.com/.../AKfycbwbIxb...) no se pudo abrir desde esta sesión, así que su estructura queda por confirmar.

## Reglas para todas las fases

1. Antes de cada fase: copia de respaldo en Drive con nombre "RESPALDO MM103 antes <fase> (fecha)".
2. Publicar siempre como "Nueva versión" sobre la implementación activa, nunca como "Nueva implementación", para conservar la URL de producción. Verificar que el selector diga "Nueva versión" antes de implementar.
3. Probar con usuarios de prueba, no con credenciales reales de técnicos. Ernesto hace las pruebas de extremo a extremo con sus cuentas.
4. Los cambios en la cola deben revisarse contra la caché offline de la tableta, porque la cola del día se descarga localmente.
5. No borrar datos. Lo que sale de una vista se archiva o se oculta, y la auditoría se conserva.

## Fase 0: Auditoría de solo lectura

- Listar archivos reales (.gs, index.html, puente.js, piel.css, sw.js) con tamaño y número de funciones.
- Confirmar qué hacen listarColaDelDia, asegurarColaDelDia_ y los filtros actuales de la cola.
- Confirmar cómo se cierra la sesión y qué pasa con operaciones offline pendientes.
- Revisar la estructura de la app vinculada (la que no se pudo abrir): qué datos maneja, qué funciones públicas expone y si puede enviar datos por POST.
- Entregable: lista de hallazgos, sin cambios de código.

## Fase 1: Índice maestro y mapa del proyecto

- Ya existe la división en módulos (V38); no rehacerla.
- Crear INDICE.md con una entrada por archivo: propósito, funciones principales, hojas de Google Sheets que toca, permisos que consulta y dependencias.
- Separar index.html por secciones (login, menú, cola, checklist, almacén, tickets, permisos, auditoría, mi cuenta, reportes) con HtmlService include.
- Crear la habilidad "bitacora-mm103-mapa" con un SKILL.md que obligue a leer INDICE.md antes de modificar cualquier archivo.
- Criterio: la app funciona igual, y el índice cubre todas las funciones.

## Fase 2: Vínculo con la app del técnico (webhook)

Objetivo: que el técnico use la app vinculada y que Bitácora guarde la información para cruzarla con los reportes.

Solución propuesta:
- Bitácora agrega un endpoint de entrada (doPost) que recibe eventos en JSON, validados con un secreto guardado en PropertiesService. Sin el secreto correcto, la solicitud se rechaza.
- Cada evento se guarda en la hoja nueva EVENTOS_VINCULADOS: fecha y hora, origen, tipo de evento, identificador único (para no duplicar reintentos), técnico, número de trabajo o ticket relacionado y el contenido completo en columnas separadas.
- La app vinculada envía sus eventos a esa URL. Si esa app es de Google Apps Script, se le agrega una función que haga UrlFetchApp.fetch al endpoint de Bitácora con el secreto. Si el técnico debe seguir abriendo esa app desde la tableta, no cambia nada para él.
- Pantalla de administración (permiso CONFIGURAR_INTEGRACIONES): mostrar la URL del endpoint, generar o rotar el secreto, activar o desactivar la recepción y ver los últimos eventos.
- Reportes: los eventos quedan disponibles para unirse con trabajos, técnicos y fechas en Reportes e Indicadores.
- Pendiente de confirmar: dirección exacta del flujo (la app vinculada envía a Bitácora, o Bitácora consulta a la app vinculada) y qué campos trae cada evento. Con eso se cierra el diseño.

## Fase 3: Permisos y auditoría en el celular

- Permisos: la matriz pasa a tarjetas por permiso en pantallas de 820 px o menos, con un interruptor por rol y el nombre del rol visible.
- Auditoría: la tabla de LOG_AUDITORIA pasa a tarjetas (fecha, usuario, acción, detalle), con filtros colapsables y paginación de 20 registros.
- Pruebas en 360 px, 768 px y escritorio, sin desplazamiento horizontal.

## Fase 4: Cola de trabajo y tareas desactivadas

Se ocultan de la cola:
- Trabajos programados extra completados.
- Tickets completados o cancelados.
- Tareas diarias del catálogo desactivadas, desde hoy.

Recomendación: filtrar en listarColaDelDia y no borrar filas. Puntos de cuidado: una tarea reabierta (Reapertura.gs) debe reaparecer como Pendiente, la tarea desactivada no debe regenerarse en asegurarColaDelDia_ y la caché offline debe refrescarse.

## Fase 5: Historial de trabajos

Flujo confirmado: al terminar el día, los trabajos completados y cancelados salen de la cola de trabajo y se guardan en el botón nuevo "Historial de trabajos".

- Hoja HISTORIAL_TRABAJOS con: fecha de la jornada, tipo de origen (tarea, extra o ticket), identificador, nombre, estado final, técnico, minutos trabajados, URL de la foto de evidencia y motivo de cancelación si aplica.
- El cierre de jornada (ya existente) o el activador de medianoche copia los registros a HISTORIAL_TRABAJOS y los marca como archivados en la cola.
- Botón "Historial de trabajos": consulta por fecha, técnico y tipo, y permite exportar a Excel o PDF con el código de reportes existente.
- Ningún registro se borra. Si después se quiere limpiar el historial, se hará con doble confirmación y respaldo previo.

## Fase 6: Comparativa de tiempos por técnico (Auditoría y Reportes e Indicadores)

Objetivo: comparar cuánto tarda cada técnico en el mismo trabajo.

- Agrupar por trabajo: mismo nombre de tarea (o mismo catálogo de tarea) y calcular para cada técnico el promedio de minutos, el número de veces realizado y la diferencia contra el promedio general del trabajo (en minutos y en porcentaje).
- En Auditoría: una columna nueva "Tiempo vs. promedio" en el detalle de cada tarea completada, con el tiempo del técnico y la diferencia.
- En Reportes e Indicadores: una tabla comparativa por trabajo y técnico, con filtro por fecha (día, mes, año) y gráfica de barras.
- Solo se comparan trabajos con al menos 3 registros de cada técnico, para evitar conclusiones con muy pocos datos. Este umbral es propuesta y puede ajustarse.
- En la versión móvil, la tabla se convierte en tarjetas (Fase 3).

## Fase 7: Barra fija con menú principal y salir

- Barra superior fija (position: fixed) con "← Menú principal" y "Salir", visible en todos los módulos después del login.
- Espacio superior para que la barra no tape el contenido, considerando la zona segura de iPhone y Android.
- Al pulsar "Salir" con operaciones offline pendientes, mostrar advertencia.
- En la PWA, verificar que no se superponga con la franja de estado (✔ / ⏳ / ⚠).

## Fase 8: Pruebas y cierre

- Revisar cada fase en 360 px, 768 px y escritorio, en Chrome de Android y en Safari de iPad.
- Probar con un usuario de prueba de cada rol que los botones aparezcan solo donde corresponde.
- Probar el vínculo con un evento de prueba y confirmar que la auditoría registra las acciones nuevas.
- Actualizar INDICE.md y la habilidad con cada cambio.

## Orden recomendado

Fase 0, luego Fase 1, después Fase 7 y Fase 3 (bajo riesgo), Fase 4, Fase 5 (depende de la 4), Fase 6 (depende de la 5 para tener datos de historial), Fase 2 al final, cuando se confirme el flujo con la app vinculada.

## Recomendación de modelo para Claude Code

- Fases 0, 1, 2, 4, 5 y 6 (auditoría, índice, vínculo entre apps, lógica de cola, historial y cálculos de tiempos): Opus con esfuerzo alto. Son cambios de datos y de lógica que no deben romper producción.
- Fases 3 y 7 (CSS responsive, barra fija): Sonnet con esfuerzo medio. Son tareas visuales y acotadas.
- Una sesión por fase, con INDICE.md como punto de partida.

## Decisiones pendientes

1. Vínculo: ¿la app vinculada envía datos a Bitácora, o Bitácora los consulta desde la app vinculada? ¿Qué campos trae cada evento?
2. Comparativa de tiempos: ¿el umbral de 3 registros por técnico está bien?
