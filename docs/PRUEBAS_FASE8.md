# Pruebas de cierre (Fase 8) — Bitácora MM103

Lista para recorrer con **usuarios de prueba** (uno por rol), nunca con las cuentas de los técnicos. Los roles y permisos son los de la hoja `ROLES_PERMISOS` al 6 nov 2026.
Prueba cada rol en: celular (≈360 px), tableta vertical (≈768 px) y computadora; en Android Chrome y en Safari de iPad/iPhone. Si algo no coincide, anota rol, pantalla, dispositivo y una captura.

## Qué ya se probó automáticamente (sin datos reales)
- Interfaz completa real, servidor simulado, los 4 roles con su matriz real de permisos:
  - Menú de cada rol = lo esperado (tabla de abajo).
  - Ningún módulo se desborda a 360, 768 ni 1280 px (web y PWA); "Salir" siempre visible.
  - Al salir un administrador y entrar un técnico en el mismo navegador, ya no le quedan botones del administrador (corregido en esta fase).
- Simulaciones de servidor: `node pruebas/sim_cola.js apps-script` (18), `sim_historial.js` (26), `sim_comparativa.js` (20).

## Menú esperado por rol
| Botón del menú | Administrador | Jefe Seguridad Patrimonial | Auxiliar Administrativa | Técnico |
|---|:-:|:-:|:-:|:-:|
| Mi cuenta | ✔ | ✔ | ✔ | ✔ |
| Usuarios / Auditoría | ✔ | ✔ | — | — |
| Permisos | ✔ | — | — | — |
| Horarios | ✔ | ✔ | — | — |
| Catálogo de tareas diarias | ✔ | ✔ | ✔ | — |
| Trabajos programados | ✔ | ✔ | ✔ | ✔ |
| Control de gas | ✔ | — | — | — |
| Cola de trabajo de hoy | ✔ | ✔ | ✔ | ✔ |
| Checklist de equipos | ✔ | ✔ | ✔ | ✔ |
| Almacén | ✔ | ✔ | ✔ | ✔ |
| Tickets e indicaciones | ✔ | ✔ | ✔ | ✔ |
| Mi comida | — | — | — | ✔ |
| Reportes e indicadores | ✔ | ✔ | ✔ | — |
| Historial de trabajos | ✔ | ✔ | ✔ | — |

Dentro de la cola: **Tomar siguiente tarea** solo Técnico; **Cerrar jornada** y **Ver terminados y ocultos** solo Administrador, Jefe y Auxiliar. En Historial, **Actualizar historial** solo quien tiene CARGAR_MODIFICAR_TAREAS (Administrador, Jefe, Auxiliar).

## Recorrido por fase (con cada rol que aplique)
1. **Barra fija (F7):** en cualquier módulo, baja la pantalla: "← Menú principal" y "Salir" siguen arriba, sin tapar la hora ni la muesca del iPhone. En la tableta sin internet, completa algo y toca Salir: aparece el aviso de cambios sin subir (elige Cancelar).
2. **Permisos y auditoría en celular (F3):** Permisos en tarjetas con interruptores (cambia uno de prueba y regrésalo). Auditoría con filtros y páginas de 20.
3. **Cola (F4):** no aparecen trabajos programados terminados/cancelados, tickets atendidos/cancelados ni tareas desactivadas; lo En proceso/Pausado sí. Con "Ver terminados y ocultos", reabre uno de prueba → vuelve como Pendiente.
4. **Historial (F5):** "Actualizar historial" archiva los días anteriores; filtros; Excel y PDF descargan y quedan en Drive. En la hoja, `COLA_TRABAJO_DIARIO` conserva todas sus filas.
5. **Comparativa (F6):** Reportes → "Comparativa de tiempos por técnico" (tabla, gráfica y selector). Auditoría → "Tiempo vs. promedio". `CONFIG_SISTEMA` tiene `COMPARATIVA_MIN_REGISTROS = 2`. El Excel trae la hoja "Comparativa tiempos".
6. **Seguridad:** con el Técnico, intenta entrar a Reportes o Historial escribiendo la sección (no debe tener botón) — el servidor responde "Tu perfil no tiene acceso".

## Hallazgos para decidir después (no se cambiaron)
- **F13:** `listarAuditoriaReciente` solo pide sesión; conviene exigir ALTA_BAJA_USUARIOS.
- **F14:** en `ROLES_PERMISOS` existen `VER_DASHBOARD`, `EXPORTAR_REPORTES`, `REGISTRAR_COMIDA`, `CALIFICAR_TRABAJOS_CIERRE`, `SUBIR_EVIDENCIA_FOTOGRAFICA` y `CARGAR_PENDIENTE_PREVENTIVO`, pero el código no los consulta: Reportes usa ALTA_BAJA_USUARIOS / CARGAR_MODIFICAR_TAREAS / AUDITORIA_INVENTARIO / GENERAR_CODIGO_SALTO, y "Mi comida" usa EJECUTAR_TAREAS_COLA. Cambiar esos interruptores hoy no tiene efecto.
- En la versión web (sin PWA) las tablas antiguas se desplazan dentro de su tarjeta en celular; en la PWA se ven como tarjetas.
