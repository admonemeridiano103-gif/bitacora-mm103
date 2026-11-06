---
name: bitacora-mm103-mapa
description: Mapa obligatorio de la Bitácora de Mantenimiento MM103 (Apps Script + Google Sheets + PWA en GitHub Pages). Úsala SIEMPRE antes de leer, modificar, crear o publicar cualquier archivo de este proyecto (apps-script/, index.html, puente.js, piel.css, sw.js, vista_*.html, js_*.html, *.gs/*.js), y cuando se pregunte dónde está o qué hace una función, hoja o permiso.
---

# Bitácora MM103: mapa del proyecto

## Regla 1 (obligatoria): leer INDICE.md primero

Antes de modificar **cualquier** archivo del repositorio:

1. Lee `INDICE.md` completo (está en la raíz del repositorio).
2. Ubica en él el archivo que vas a tocar: su propósito, sus funciones, las hojas que usa, los permisos que consulta y de quién depende.
3. Si vas a cambiar una función, busca también quién la llama (sección 5 y la columna "Depende de").
4. Verifica en el código real cada nombre de función, hoja y columna antes de cambiarlo. El índice y los planes se escriben a partir de notas y pueden estar desactualizados.

No edites un archivo sin haber hecho los pasos 1 a 4 en esta sesión.

## Regla 2: actualizar INDICE.md en el mismo commit

Si añades, quitas o renombras un archivo, función, hoja, columna o permiso, actualiza `INDICE.md` en el mismo commit. Una fase no está terminada si el índice no la refleja.

## Reglas del proyecto

- **Git:** una rama por fase (`fase-N-nombre`). Al terminar y probar, fusiona a `main` con un commit descriptivo. Si algo falla, revierte el commit. Nada de copias en Drive.
- **Apps Script:** el código vive en `apps-script/`. Cada cambio se hace ahí y se sube con `clasp push`.
- **Repositorio público:** nunca subas datos reales, contraseñas, secretos, el ID de la hoja ni el scriptId. `.clasp.json` está en `.gitignore`. Los secretos van en `PropertiesService`.
- **Publicación:** siempre "Nueva versión" sobre la implementación activa, nunca "Nueva implementación" (conserva la URL de producción). Verifica antes que el selector diga "Nueva versión". Antes de modificar producción se respalda la hoja en Drive y se pide aprobación al dueño.
- **Datos:** no se borran. Lo que sale de una vista se archiva u oculta; la auditoría se conserva.
- **Pruebas:** con usuarios de prueba, nunca con credenciales de técnicos reales. Las pruebas de extremo a extremo las hace el dueño con sus cuentas.
- **Cola de trabajo:** todo cambio en la cola se revisa contra la caché offline de la tableta (`puente.js`: la cola del día se guarda localmente).
- **PWA:** sube `VERSION` en `sw.js` en cada cambio de la PWA y la de `puente.js` si cambia el puente.
- **Interfaz:** los cambios de pantalla van en el `vista_*.html` de su sección o en el `js_*.html` del módulo, no en `index.html`, que solo tiene el esqueleto y los `include`.

## Antes de publicar

1. Corre las simulaciones (datos ficticios, no tocan Google): `node pruebas/sim_cola.js apps-script`, `node pruebas/sim_historial.js apps-script`, `node pruebas/sim_comparativa.js apps-script`. Todas deben terminar con `0 FALLA`.
2. Revisa la sintaxis de cada `.js` (`node --check`) y de cada `<script>` de la plantilla completa (expande los `include` de `apps-script/index.html`). Busca ids repetidos.
3. Revisa la pantalla a 360, 768 y 1280 px. En teléfono simulado no basta `scrollWidth` vs `innerWidth`: busca elementos que pasen del ancho fuera de un contenedor con desplazamiento.
4. Respaldo de la hoja en Drive ("RESPALDO MM103 antes <fase> (fecha)") y aprobación del dueño.
5. `clasp push` y `clasp deploy --deploymentId <id de la implementación activa> --description "vNN: ..."` (equivale a "Nueva versión"; la URL no cambia; nunca crear implementación nueva). Confirma con `clasp deployments` que la activa subió de número.
6. Verifica la interfaz publicada con la acción `fuente` de la API y su sintaxis; fusiona la rama a `main` y etiqueta `fase-N-vNN`.

## Trampas conocidas (Windows / PowerShell)

- `rd` es alias de `Remove-Item`: nunca nombres así una función (borró un archivo en la Fase 7).
- Con `$ErrorActionPreference='Stop'`, los avisos normales de git por stderr cortan el script: deja los comandos de git fuera de ese bloque.
- Los archivos de `apps-script/` están con CRLF en la copia de trabajo: lee, normaliza a LF, reemplaza texto que aparezca una sola vez y vuelve a escribir con el mismo fin de línea.
- `git push` necesita que el dueño inicie sesión en GitHub; tú no tienes credenciales.

## Fuera de alcance por ahora

La Fase 2 (recepción de datos de la otra app de Apps Script) está pausada hasta que el dueño comparta el acceso completo a esa app.