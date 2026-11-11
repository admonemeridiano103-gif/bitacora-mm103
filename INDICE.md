# INDICE.md — Bitácora de Mantenimiento MM103

> **Léelo completo antes de modificar cualquier archivo.** Es el mapa del proyecto: qué hace cada archivo, qué funciones tiene, qué hojas y permisos toca y de quién depende.
> Base: estado V61 (etiqueta `estado-V61`). Cada fase debe actualizar este archivo en el mismo commit que cambia el código.
> Los números `L###` son de la fecha de este índice y se desplazan al editar: busca por nombre de función.

## 1. Ficha técnica

| Dato | Valor |
|---|---|
| Sistema | Bitácora de Mantenimiento del condominio Maestro Meridiano 103 (Zapopan, Jalisco) |
| Servidor | Google Apps Script ligado a una hoja de Google Sheets (el ID de la hoja y el scriptId **no** se guardan en el repositorio) |
| Código del servidor | carpeta `apps-script/` (se sincroniza con `clasp`; `.clasp.json` está en `.gitignore`) |
| Versión offline (PWA) | raíz del repositorio, publicada en GitHub Pages: `index.html`, `puente.js`, `piel.css`, `sw.js`, `manifest.webmanifest`, `lecturas.js`, `medidores.json`, `ocr/` |
| Zona horaria / runtime | `America/Mexico_City` / V8 |
| Web App | `doGet` (interfaz) y `doPost` (API de la PWA), "Ejecutar como: Yo", acceso "Cualquiera" |
| Autenticación | usuario + contraseña con hash y sal, código de 6 dígitos por correo, sesión de 12 h con token; en la PWA, token de dispositivo de 30 días |
| Trigger | `rolloverJornadaProgramado` (cierre de jornada, ~00:10), instalado por `instalarTriggerCierreJornada_()` |
| Publicación | siempre "Nueva versión" sobre la implementación activa; nunca "Nueva implementación" (conserva la URL de producción) |

## 2. Arquitectura

```
Navegador / PWA
   │ google.script.run.fn(TOKEN, ...)            │ fetch POST JSON (text/plain)
   ▼                                             ▼
index.html + vista_*.html + js_*.html  ──►  doGet (Código.js)   doPost (Api_Offline.js)
   │                                             │
   │                                      requiereSesion_ / requierePermiso_
   ▼                                             ▼
DOM + ESTADO global                       Funciones de dominio (.js)
                                                 ▼
                                   SpreadsheetApp (hojas) + Drive (fotos) + Gmail (códigos)
```

- **Servidor:** toda función pública recibe `token` como primer argumento, salvo `login`, `solicitarCodigoAcceso`, `crearCredenciales`, `restablecerPassword`, `obtenerPermisos` y las de sistema (`doGet`, `doPost`, `onOpen`, `preparar*`, `crearHojas*`, `rolloverJornadaProgramado`). Las mutaciones llaman `registrarAuditoria_`. Muchas devuelven `{ ok, cola: construirColaDelDia_(fechaHoy_()) }`.
- **Barra fija (Fase 7):** `#barraSuperior` (CSS `.barra-fija` en `estilos.html`, HTML en `vista_menu`) vive dentro de `#panel`, así que solo existe tras el login. `body.con-barra` oculta el `header` y se pone/quita en `entrarConSesion`, `mostrarLogin` y `cerrarSesionClick`. Usa `env(safe-area-inset-*)` para iPhone y Android; `piel.css` fija el `header` como `static` y baja el aviso `#mmAviso` para no taparlo. La pastilla de estado de la PWA está abajo a la izquierda y no choca con la barra.
- **Cliente:** `TOKEN` en `localStorage`; `ESTADO` global en `js_nucleo.html`; `mostrarSeccion(id)` alterna tarjetas; `cargarSeccion_()` pide datos al abrir cada módulo.
- **PWA:** `index.html` (raíz) descarga la interfaz real con la acción `fuente` (el HTML ya evaluado, con los `include`), inyecta `puente.js` y `piel.css` y emula `google.script.run`. Cualquier cambio en Apps Script llega a la PWA sin tocar GitHub. `sw.js` guarda el shell; **sube `VERSION` en `sw.js` en cada cambio de la PWA** y la de `puente.js` cuando cambie el puente.
- **Cierre de sesión:** servidor `cerrarSesion` (borra la fila de `SESIONES`, audita `LOGOUT`); web `cerrarSesionClick()` en `js_nucleo.html`; PWA: `puente.js` rechaza `cerrarSesion` si hay operaciones pendientes y conserva caché y bandeja. Desde la Fase 7 el botón **Salir** de la barra fija (`cerrarSesionClick`) lee `window.MM103.estado()` y, si hay pendientes o errores, pide confirmación antes de salir; no se pierde nada, los cambios quedan en el dispositivo y se suben al volver a entrar con internet.

## 3. Plantilla de la interfaz y sus secciones (Fase 1)

`index.html` conserva solo el esqueleto (cabecera, `#cargando`, contenedores `#panel` y `.contenedor`) y arma la pantalla con `include`:

| Include | Contenido | Ids de tarjeta / pantalla |
|---|---|---|
| `estilos` | CSS | — |
| `vista_login` | login, activación de cuenta (2 pasos), recuperación | `pantallaLogin`, `pantallaActivar`, `pantallaRecuperar` |
| `vista_sin_acceso` | aviso de sin acceso | `sinAcceso` |
| `vista_menu` | barra superior fija (← Menú principal / Salir), saludo y cuadrícula de 14 botones | `barraSuperior`, `barraBtnMenu`, `barraMarca`, `barraBtnSalir`, `menuPrincipal` |
| `vista_mi_cuenta` | cambio de usuario y contraseña | `tarjetaMiCuenta` |
| `vista_usuarios` | lista, alta y edición | `tarjetaUsuarios`, `tarjetaAltaUsuarios` |
| `vista_permisos` | matriz de permisos: tabla en escritorio; en 820 px o menos, buscador y una tarjeta por permiso con interruptor por rol (Fase 3) | `tarjetaPermisos`, `tablaPermisos`, `permTarjetas`, `perm_buscar` |
| `vista_horarios` | horarios | `tarjetaHorarios` |
| `vista_auditoria` | LOG_AUDITORIA (con columna "Tiempo vs. promedio" en COMPLETAR_TAREA_COLA, Fase 6) y filtros plegables (texto, usuario, acción, desde, hasta) y páginas de 20; tabla en escritorio y tarjetas en 820 px o menos (Fase 3) | `tarjetaAuditoria`, `audFiltros`, `tbodyAuditoria`, `audTarjetas`, `audPaginador` |
| `vista_catalogo_tareas` | catálogo de tareas diarias y su formulario | `tarjetaCatalogoTareas`, `tarjetaFormTarea` |
| `vista_trabajos_extra` | trabajos programados y formulario | `tarjetaTrabajosExtra`, `tarjetaFormTrabajoExtra` |
| `vista_gas` | control de cierre/apertura de gas | `tarjetaGasAdmin`, `tarjetaGasTecnico` |
| `vista_cola` | cola de hoy, completar, salto | `tarjetaColaHoy`, `tarjetaCompletarTarea`, `tarjetaSaltoUnico` |
| `vista_checklist` | checklist de equipos y lecturas | `tarjetaChecklistEquipos`, `tarjetaFormLecturaEquipo` |
| `vista_almacen` | inventario, material, movimientos | `tarjetaAlmacen`, `tarjetaFormMaterialAlmacen`, `tarjetaFormMovimientoAlmacen` |
| `vista_tickets` | tickets, comida, formulario y cancelación | `tarjetaTickets`, `tarjetaComida`, `tarjetaFormTicket`, `tarjetaCancelarTicket` |
| `vista_reportes` | filtros, KPIs, Excel/PDF; la comparativa de tiempos (Fase 6: tabla o tarjetas, gráfica de diferencias por trabajo, hoja en Excel y tabla en PDF) se pinta dentro de `rp_contenido` desde `js_reportes` | `tarjetaReportes`, `rp_cmpTrabajo`, `rp_cmpGrafica` |
| `vista_historial` | Historial de trabajos (Fase 5): filtros fecha/técnico/tipo/estado/texto, tabla o tarjetas, páginas de 20, Excel/PDF, "Actualizar historial" | `tarjetaHistorial`, `tbodyHistorial`, `hiTarjetas`, `hiPaginador` |
| `js_nucleo`, `js_trabajos`, `js_equipos`, `js_almacen`, `js_tickets_comida`, `js_usuarios`, `js_reportes`, `js_historial`, `js_gas` | JavaScript del cliente por tema | — |

Los `vista_*` no contienen scriptlets (`<? ?>`), así que `incluir_()` los inserta tal cual. Un cambio de interfaz se hace en el `vista_*` de su sección, no en `index.html`.

## 4. Mapa de archivos

| Archivo | Propósito | Hojas | Permisos que consulta | Depende de |
|---|---|---|---|---|
| `Código.js` | Constantes `HOJAS`, `PERMISOS`, estados; `doGet`, `incluir_`, `onOpen`; preparación de autenticación y hojas base | USUARIOS, SESIONES y las de `crearHojasFuturas` | CONFIGURAR_SISTEMA | Utilidades |
| `Utilidades.js` | Helpers de hojas, auditoría, configuración, fechas, columnas | todas; CONFIG_SISTEMA, LOG_AUDITORIA | CONFIGURAR_SISTEMA | — |
| `Auth_Usuarios.js` | Login, sesiones, permisos por rol, usuarios, horarios, auditoría | USUARIOS, ROLES_PERMISOS, SESIONES, HORARIOS, LOG_AUDITORIA | ALTA_BAJA_USUARIOS, EDITAR_PERMISOS_ROLES, CONFIGURAR_HORARIOS | Utilidades, Código |
| `Tareas_Cola.js` | Catálogo de tareas, pasos, materiales; trabajos extra; armado y orden de la cola; tomar/pausar/saltar/completar; cierre de jornada | CATALOGO_TAREAS_DIARIAS, CATALOGO_PASOS_TAREA, CATALOGO_MATERIALES_POR_TAREA, COLA_TRABAJO_DIARIO, TRABAJOS_EXTRA_PROGRAMADOS, EVIDENCIAS_FOTOS, USUARIOS | CARGAR_MODIFICAR_TAREAS, EJECUTAR_TAREAS_COLA, GENERAR_CODIGO_SALTO, ENVIAR_TICKET, ATENDER_TICKET, CONFIGURAR_SISTEMA | Auth, Utilidades, Checklist, Control_Gas |
| `Checklist_Equipos.js` | Lecturas de equipos y cierre de tarea por equipo | EQUIPO_*, CATALOGO_TAREAS_DIARIAS, COLA_TRABAJO_DIARIO | REGISTRAR_LECTURA_EQUIPO, CARGAR_MODIFICAR_TAREAS | Tareas_Cola |
| `Almacen.js` | Materiales, entradas, salidas, consumo, préstamos, fotos | ALMACEN_CATALOGO_MATERIALES, ALMACEN_MOVIMIENTOS, ALMACEN_PRESTAMOS_HERRAMIENTA, EVIDENCIAS_FOTOS | REGISTRAR_ENTRADA/SALIDA/CONSUMO_MATERIAL, AUDITORIA_INVENTARIO, CARGAR_MODIFICAR_TAREAS | Auth, Utilidades |
| `Tickets_Comidas.js` | Tickets e indicaciones, fotos del antes, comidas | TICKETS_INDICACIONES, COLA_TRABAJO_DIARIO, COMIDAS_REGISTRO, USUARIOS | ENVIAR_TICKET, ATENDER_TICKET, EJECUTAR_TAREAS_COLA, CARGAR_MODIFICAR_TAREAS | Tareas_Cola |
| `Control_Gas.js` | Cierre/apertura de gas: morosidad, monto mínimo, prórrogas, acciones | REPORTE_MOROSIDAD, CONFIG_GAS, COLA_TRABAJO_DIARIO, TRABAJOS_EXTRA_PROGRAMADOS, CATALOGO_TAREAS_DIARIAS | CONTROL_CIERRE_GAS, EJECUTAR_TAREAS_COLA | Tareas_Cola |
| `Lecturas.js` | Padrón de medidores y lecturas (PWA/tableta) | MEDIDORES, LECTURAS_MEDIDORES | (valida sesión) | Auth, Utilidades |
| `Reportes.js` | Dashboard, Excel y PDF en Drive | lee COLA, CATALOGO, EXTRA, TICKETS, ALMACEN_*, EQUIPO_*, COMIDAS_REGISTRO, LOG_AUDITORIA, USUARIOS | requiereReportes_ (ALTA_BAJA_USUARIOS, CARGAR_MODIFICAR_TAREAS, AUDITORIA_INVENTARIO, GENERAR_CODIGO_SALTO) | Tareas_Cola |
| `Historial.js` | Fase 5: archiva lo terminado de días cerrados en HISTORIAL_TRABAJOS (desde `ejecutarCierreJornada_` o "Actualizar historial"), consulta y exportación Excel/PDF | HISTORIAL_TRABAJOS (escribe), COLA_TRABAJO_DIARIO (solo marca `archivado_en`), CATALOGO, EXTRA, TICKETS, USUARIOS (lectura) | Reportes (`requiereReportes_`) para consultar/exportar; CARGAR_MODIFICAR_TAREAS para "Actualizar historial" | Tareas_Cola (`motivoOcultoEnCola_`, `mapasOrdenCola_`, `sumarDias_`), Reportes (`carpetaReportes_`, `escHtmlReporte_`, `leerTablaSiExiste_`) |
| `Comparativa.js` | Fase 6: comparativa de tiempos por técnico (solo lectura). Agrupa renglones `Completada` con minutos por trabajo (tarea_id, texto del trabajo programado o ticket, Gas); promedio por técnico, veces y diferencia contra el promedio general (min y %). Umbral `COMPARATIVA_MIN_REGISTROS` en CONFIG_SISTEMA (defecto 2; se crea una vez si falta). Un trabajo sale en la tabla con 2+ técnicos comparables | COLA_TRABAJO_DIARIO, CATALOGO, EXTRA, TICKETS, USUARIOS (lectura); CONFIG_SISTEMA (agrega el parámetro una vez) | los de quien la llama (Reportes / sesión en auditoría) | Tareas_Cola (`mapasOrdenCola_`), Reportes (`fechaClaveReporte_`, `leerTablaSiExiste_`), Utilidades (`obtenerConfig_`) |
| `Reapertura.js` | Reabrir un trabajo completado con motivo y fotos | COLA_TRABAJO_DIARIO, TRABAJOS_EXTRA_PROGRAMADOS, TICKETS_INDICACIONES, EVIDENCIAS_FOTOS | CARGAR_MODIFICAR_TAREAS, ENVIAR_TICKET | Tareas_Cola |
| `Api_Offline.js` | `doPost`: ping, fuente, login, call, ops idempotentes, cerrarSesion | SESIONES_DISPOSITIVO, SYNC_LOG | (según la función llamada) | todas |
| `Icono.js` | Favicon de la Web App en Drive | — (Drive) | — | — |
| `appsscript.json` | Manifiesto (zona horaria, webapp) | — | — | — |
| `index.html` + `vista_*.html` | Interfaz (sección 3) | — | — | `incluir_` |
| `estilos.html` | CSS | — | — | — |
| `js_nucleo.html` | Estado, sesión, login, menú, carga por módulo, helpers | — | permisos del usuario en `entrarConSesion` | — |
| `js_trabajos.html` | Catálogo, extras, cola, salto, reapertura, cierre de jornada | — | — | js_nucleo |
| `js_usuarios.html` | Usuarios, horarios, matriz de permisos (tabla + tarjetas sincronizadas por `data-clave`/`data-rol`; revierte la casilla si el servidor rechaza) y auditoría (filtros y paginación en el cliente sobre los últimos 300 movimientos que pide `js_nucleo`) | — | EDITAR_PERMISOS_ROLES (servidor) | js_nucleo |
| `js_almacen.html`, `js_equipos.html`, `js_tickets_comida.html`, `js_gas.html`, `js_reportes.html` | Cliente de cada módulo | — | — | js_nucleo |
| `js_historial.html` | Cliente del historial (Fase 5); usa `descargarBlobReporte_`/`base64ABlobReporte_` de `js_reportes` y `fechaLocalIso_` de `js_usuarios`; carga SheetJS bajo demanda | — | — | js_nucleo, js_reportes, js_usuarios |
| `pruebas/sim_cola.js`, `pruebas/sim_historial.js`, `pruebas/sim_comparativa.js` | Simulaciones con hojas en memoria y datos ficticios (no tocan Google): `node pruebas/sim_cola.js apps-script` | — | — | apps-script/*.js |
| PWA: `puente.js` | Emula `google.script.run`; caché, bandeja de salida, sincronización, pastilla de estado | IndexedDB `bitacora_mm103` (meta, cache, outbox, errores) | — | Api_Offline |
| PWA: `index.html` (raíz) | Cargador: baja `fuente`, inyecta puente y piel | — | — | puente, piel |
| PWA: `piel.css` | Estilo móvil; tablas a tarjetas con 820 px o menos | — | — | — |
| PWA: `sw.js`, `manifest.webmanifest` | Service worker (cache del shell) e instalación | — | — | — |
| PWA: `lecturas.js`, `ocr/`, `medidores.json` | Lector de medidores sin internet (OCR local) | — | — | puente |

## 5. Funciones por archivo (lista completa, generada del código)

`nombre(argumentos)  L<línea>`. Las que terminan en `_` son internas del servidor (aunque Apps Script las ve como globales).

### `Almacen.js` — 16 funciones
`generarIdMaterialAlmacen_()` L1  ·  `generarIdMovimientoAlmacen_()` L11  ·  `listarAlmacen(token)` L21  ·  `guardarMaterialAlmacen(token, datos)` L32  ·  `ajustarExistenciaMaterial(token, materialId, nuevaExistencia, motivo)` L67  ·  `registrarMovimientoAlmacen_(token, materialId, tipo, cantidad, tareaRelacionadaId, notas)` L90  ·  `registrarEntradaMaterial(token, materialId, cantidad, notas)` L134  ·  `registrarSalidaMaterial(token, materialId, cantidad, notas)` L139  ·  `registrarConsumoMaterial(token, materialId, cantidad, tareaRelacionadaId, notas)` L144  ·  `carpetaFotosAlmacen_()` L150  ·  `subirFotoMaterialAlmacen(token, materialId, base64Datos, tipoMime, nombreArchivo)` L165  ·  `asegurarHojaPrestamos_()` L191  ·  `generarIdPrestamoHerramienta_()` L204  ·  `prestarHerramienta(token, materialId, fechaDevolucionEsperada, notas)` L216  ·  `devolverHerramienta(token, prestamoId, notas)` L242  ·  `listarPrestamosHerramientaMios(token)` L259

### `Api_Offline.js` — 20 funciones
`doPost(e)` L39  ·  `esErrorSesionApi_(msg)` L68  ·  `apiRespuesta_(obj)` L72  ·  `asegurarHojasApiOffline_()` L77  ·  `prepararApiOffline()` L92  ·  `probarApiOffline()` L98  ·  `apiFuente_()` L113  ·  `crearSesionDispositivo_(usuario, dispositivo, tokenNormal)` L123  ·  `apiLogin_(c)` L136  ·  `sesionDispositivo_(tokenDisp)` L146  ·  `apiSesion_(tokenDisp)` L183  ·  `apiCerrarSesion_(tokenDisp)` L189  ·  `apiFuncionPermitida_(fn)` L204  ·  `ejecutarFuncionApp_(fn, args)` L210  ·  `apiCall_(fn, args)` L228  ·  `conHoraDispositivo_(ts, fn)` L241  ·  `opYaAplicada_(opId)` L258  ·  `apiOps_(ops)` L270  ·  `apiSnapshot_(tokenDisp)` L307  ·  `tomar(clave, fn)` L311

### `Auth_Usuarios.js` — 43 funciones
`rolesDisponibles_()` L1  ·  `rolesDisponibles(token)` L6  ·  `obtenerPermisos(rol)` L12  ·  `obtenerMatrizPermisos(token)` L28  ·  `actualizarPermiso(token, clavePermiso, rol, valor)` L44  ·  `usuarioTienePermiso_(usuario, clavePermiso)` L58  ·  `generarSal_()` L74  ·  `hashPassword_(password, sal)` L79  ·  `generarCodigoVerificacion_()` L87  ·  `generarTokenSesion_()` L93  ·  `validarUsuario_(usuario)` L97  ·  `columnasAuthListas_()` L103  ·  `validarPassword_(password)` L112  ·  `enviarCorreoCodigo_(correo, nombre, codigo, tipo)` L116  ·  `buscarUsuarioPorIdentificador_(identificador)` L141  ·  `solicitarCodigoAcceso(identificador)` L150  ·  `crearCredenciales(correo, codigo, usuarioDeseado, password)` L179  ·  `restablecerPassword(identificador, codigo, nuevaPassword)` L225  ·  `crearSesion_(idUsuario)` L263  ·  `obtenerUsuarioPorId_(idUsuario)` L272  ·  `invalidarCacheUsuario_(idUsuario)` L285  ·  `validarToken_(token)` L290  ·  `requiereSesion_(token)` L327  ·  `requierePermiso_(token, clavePermiso)` L333  ·  `invalidarSesionesDeUsuario_(idUsuario)` L341  ·  `usuarioParaCliente_(obj)` L352  ·  `login(usuario, password)` L367  ·  `validarSesion(token)` L403  ·  `cerrarSesion(token)` L409  ·  `cambiarMiPassword(token, passwordActual, passwordNueva)` L421  ·  `cambiarMiUsuario(token, nuevoUsuario)` L436  ·  `generarIdUsuario_()` L457  ·  `generarCodigoPersonal_()` L468  ·  `usuarioParaListado_(obj)` L490  ·  `listarUsuarios(token, soloActivos)` L500  ·  `obtenerUsuario(token, idUsuario)` L508  ·  `altaUsuario(token, datos)` L514  ·  `editarUsuario(token, idUsuario, cambios)` L557  ·  `cambiarEstadoUsuario(token, idUsuario, nuevoEstado, motivo)` L614  ·  `regenerarCodigoUsuario(token, idUsuario)` L642  ·  `listarHorarios(token)` L659  ·  `guardarHorario(token, datos)` L664  ·  `listarAuditoriaReciente(token, limite)` L708

### `Checklist_Equipos.js` — 9 funciones
`obtenerDefinicionLecturasEquipo(token)` L1  ·  `obtenerCatalogoEquipos_()` L6  ·  `listarCatalogoEquipos(token)` L15  ·  `generarNumeroAccion_()` L21  ·  `listarChecklistEquiposDelDia(token)` L34  ·  `registrarLecturaEquipo(token, equipoId, lecturas)` L62  ·  `equiposDeTarea_(t, catalogoEquipos)` L121  ·  `equiposConLecturaHoy_(ids)` L142  ·  `cerrarTareaColaPorEquipo_(usuario, equipoId)` L153

### `Código.js` — 6 funciones
`doGet(e)` L81  ·  `incluir_(nombreArchivo)` L97  ·  `onOpen()` L101  ·  `menuAbrirPanel_()` L112  ·  `prepararAutenticacion()` L130  ·  `crearHojasFuturas(token)` L181

### `Comparativa.js` — 7 funciones
`umbralComparativa_()` L20  ·  `asegurarParametroComparativa_()` L26  ·  `normalizarTextoComparativa_(s)` L42  ·  `trabajoComparativa_(o, mapas)` L47  ·  `redondear1_(n)` L62  ·  `calcularComparativaTiempos_(opciones)` L68  ·  `agregarComparativaAuditoria_(filas)` L126

### `Control_Gas.js` — 31 funciones
`asegurarHojasGas_()` L20  ·  `moduloGasActivo_()` L39  ·  `estadoModuloGas(token)` L51  ·  `gasMontoMinimo_()` L56  ·  `gasNormalizar_(s)` L63  ·  `gasNumero_(v)` L70  ·  `gasNombreLocal_(s)` L81  ·  `gasClaveDeDireccion_(dir)` L92  ·  `gasProrrogaVigente_(o, hoy)` L113  ·  `gasAccion_(o, hoy)` L120  ·  `gasOrdenar_(a, b)` L129  ·  `gasPendientes_(hoy)` L137  ·  `gasVista_()` L147  ·  `listarReporteGas(token)` L171  ·  `cargarReporteMorosidad(token, filas)` L181  ·  `guardarMontoMinimoGas(token, monto)` L250  ·  `guardarProrrogaGas(token, clave, motivo, autorizo, fechaLimite)` L268  ·  `quitarProrrogaGas(token, clave)` L283  ·  `gasTareaVista_(registroId)` L295  ·  `obtenerTareaGas(token, registroId)` L317  ·  `registrarAccionGas(token, registroId, clave, fotoBase64, fotoMime, fotoNombre)` L327  ·  `completarTareaGas_(usuario, registroId, obj, descripcion)` L361  ·  `gasIdsColaNuevos_(cantidad)` L384  ·  `gasInsertarFilaCola_(fecha, registroId, tipoOrigen, origenId, usuarioAsignado)` L395  ·  `agregarGasDelDiaACola_(fecha)` L406  ·  `tareaDeExtraVinculado_(filaCola)` L420  ·  `gasEquiposCubiertosHoy_(fecha)` L428  ·  `esTrabajoVinculado_(o)` L444  ·  `agregarTrabajosVinculadosDelDiaACola_(fecha)` L449  ·  `agregarModulosDelDiaACola_(fecha)` L488  ·  `validarTipoTrabajoExtra_(datos)` L495

### `Historial.js` — 9 funciones
`asegurarHojaHistorial_()` L23  ·  `estadoFinalHistorial_(o, mapas)` L42  ·  `nombreTrabajoHistorial_(o, mapas)` L62  ·  `archivarHistorialHasta_(fechaLimite, idUsuarioActor, correoActor)` L75  ·  `actualizarHistorialTrabajos(token)` L143  ·  `consultarHistorial_(filtros)` L155  ·  `obtenerHistorialTrabajos(token, filtros)` L205  ·  `obtenerHistorialParaExcel(token, filtros)` L211  ·  `generarHistorialPdf(token, filtros)` L219

### `Icono.js` — 2 funciones
`urlIconoApp_()` L11  ·  `regenerarIconoApp()` L25

### `js_almacen.html` — 13 funciones
`pintarAlmacen(materiales)` L3  ·  `filtrarAlmacenUI()` L38  ·  `limpiarFormMaterialAlmacen_()` L87  ·  `abrirAltaMaterialAlmacen()` L102  ·  `abrirEdicionMaterialAlmacen(materialId)` L110  ·  `cerrarFormMaterialAlmacen()` L135  ·  `previsualizarFotoMaterial()` L139  ·  `subirFotoMaterialSiHayArchivo_(materialId)` L151  ·  `guardarMaterialAlmacenUI()` L164  ·  `ajustarExistenciaMaterialUI()` L186  ·  `abrirFormMovimientoAlmacen(materialId, tipo)` L204  ·  `cerrarFormMovimientoAlmacen()` L216  ·  `confirmarMovimientoAlmacenUI()` L220

### `js_equipos.html` — 4 funciones
`pintarChecklistEquipos(lista)` L3  ·  `abrirFormLecturaEquipo(equipoId)` L24  ·  `cerrarFormLecturaEquipo()` L64  ·  `guardarLecturaEquipoUI()` L68

### `js_gas.html` — 16 funciones
`gasEtiquetaUnidad_(torre, depto)` L6  ·  `dineroGas_(n)` L10  ·  `cargarGasAdmin()` L18  ·  `pintarGasAdmin(v)` L22  ·  `guardarMontoMinimoGasUI()` L53  ·  `cargarLibreriaXlsxGas_(ok, error)` L61  ·  `leerFilasReporteGas_(buffer)` L71  ·  `cargarReporteGasUI()` L96  ·  `abrirProrrogaGasUI(clave)` L125  ·  `cerrarProrrogaGasUI()` L136  ·  `guardarProrrogaGasUI()` L140  ·  `quitarProrrogaGasUI(clave)` L147  ·  `abrirTareaGas(registroId)` L159  ·  `pintarGasTecnico(t)` L165  ·  `confirmarAccionGasUI(clave)` L191  ·  `terminarTareaGasUI()` L205

### `js_historial.html` — 16 funciones
`cargarHistorial_()` L5  ·  `filtrosHistorial_()` L12  ·  `rangoRapidoHistorial(cual, sinBuscar)` L23  ·  `limpiarFiltrosHistorial()` L33  ·  `buscarHistorial()` L38  ·  `llenarSelectHistorial_(id, textoTodos, valores)` L46  ·  `pintarHistorial(r)` L54  ·  `badgeHistorial_(estado)` L64  ·  `fotoHistorial_(url)` L69  ·  `pintarPaginaHistorial_()` L73  ·  `cambiarPaginaHistorial(delta)` L114  ·  `mensajeHistorial_(html)` L122  ·  `actualizarHistorialUI()` L126  ·  `asegurarXlsxHistorial_(ok, mal)` L140  ·  `exportarHistorialExcel()` L149  ·  `exportarHistorialPdf()` L182

### `js_nucleo.html` — 26 funciones
`guardarToken_(t)` L9  ·  `borrarToken_()` L13  ·  `tokenGuardado_()` L17  ·  `ocultarPantallasAcceso_()` L44  ·  `mostrarLogin(mensaje)` L50  ·  `mostrarActivar()` L58  ·  `mostrarRecuperar()` L66  ·  `mostrarSeccion(idSeccion)` L80  ·  `mostrarMenuPrincipal()` L94  ·  `entrarConSesion(usuario)` L106  ·  `hacerLogin()` L160  ·  `pedirCodigoActivar()` L175  ·  `confirmarActivar()` L193  ·  `pedirCodigoRecuperar()` L209  ·  `confirmarRecuperar()` L223  ·  `cerrarSesionClick()` L238  ·  `guardarMiUsuario()` L256  ·  `guardarMiPassword()` L269  ·  `cargarTodo()` L291  ·  `cargarRolesYHorarios_()` L302  ·  `marcarCargando_(idSeccion)` L314  ·  `cargarChecklistEquipos_(alTerminar)` L324  ·  `cargarSeccion_(idSeccion)` L339  ·  `mostrarError(err)` L417  ·  `mostrarExito(msg)` L423  ·  `escapar_(s)` L429

### `js_reportes.html` — 14 funciones
`cargarReportes_()` L7  ·  `filtrosReporte_()` L27  ·  `rangoRapidoReporte(tipo)` L36  ·  `actualizarDashboard()` L49  ·  `kpiReporte_(titulo, valor, color)` L57  ·  `barrasReporte_(titulo, filas, etiqueta, valor, sufijo)` L62  ·  `pintarDashboard(r)` L73  ·  `htmlComparativaReporte_(c)` L118  ·  `pintarGraficaComparativa_()` L151  ·  `descargarBlobReporte_(blob, nombre)` L168  ·  `base64ABlobReporte_(b64, tipo)` L176  ·  `estadoExportacion_(msg, url)` L182  ·  `exportarReporteExcel()` L187  ·  `exportarReportePdf()` L258

### `js_tickets_comida.html` — 17 funciones
`pintarTickets(lista)` L3  ·  `abrirFormTicket(ticketId)` L42  ·  `cerrarFormTicket()` L73  ·  `guardarTicketUI()` L77  ·  `guardarTicketConFotos_(fotos, alTerminar)` L103  ·  `agregarFotosAntesTicket()` L152  ·  `pintarFotosAntesTicket_()` L161  ·  `abrirModalCancelarTicket(ticketId)` L182  ·  `cerrarModalCancelarTicket()` L189  ·  `confirmarCancelarTicketUI()` L193  ·  `atenderTicketUI(ticketId)` L208  ·  `formatearMinutos_(mins)` L219  ·  `actualizarTextoComidaAcumulado_()` L225  ·  `pintarEstadoComida(estado)` L240  ·  `pintarComidaTodos(lista)` L266  ·  `iniciarComidaUI()` L275  ·  `terminarComidaUI()` L286

### `js_trabajos.html` — 60 funciones
`pintarCatalogoTareas(tareas)` L7  ·  `abrirAltaTarea()` L37  ·  `abrirEdicionTarea(tareaId)` L53  ·  `cerrarFormularioTarea()` L74  ·  `guardarTareaUI()` L79  ·  `toggleActivoTareaUI(tareaId, activoActual)` L102  ·  `pintarPasosTarea(pasos)` L112  ·  `guardarPasoUI()` L124  ·  `eliminarPasoUI(pasoId)` L144  ·  `pintarMaterialesTarea(materiales)` L157  ·  `guardarMaterialUI()` L169  ·  `eliminarMaterialUI(relacionId)` L189  ·  `pintarTrabajosExtra(lista)` L206  ·  `abrirAltaTrabajoExtra()` L245  ·  `abrirEdicionTrabajoExtraUI(id)` L260  ·  `cambiarTipoTrabajoExtraUI()` L277  ·  `etiquetaTipoTrabajo_(e)` L286  ·  `cerrarFormularioTrabajoExtra()` L292  ·  `guardarTrabajoExtraUI()` L296  ·  `cambiarEstadoTrabajoExtraUI(id, nuevoEstado)` L318  ·  `pintarRecordatorios(lista)` L332  ·  `filaVisibleEnCola_(f)` L347  ·  `alternarColaOcultos()` L354  ·  `recargarColaVista_()` L359  ·  `pintarColaHoy(filas)` L370  ·  `miTrabajoEnProceso_()` L494  ·  `tomarSiguienteTareaUI()` L500  ·  `cerrarElegirPausado_()` L506  ·  `mostrarElegirPausado_(pausados)` L511  ·  `tomarTareaUI(registroId)` L542  ·  `pausarTareaUI(registroId)` L576  ·  `moverTareaColaUI(registroId, direccion)` L590  ·  `moverTareaColaAPosicionUI(registroId)` L595  ·  `enviarMovimientoCola_(registroId, destino)` L602  ·  `moverTicketColaUI(registroId, direccion)` L614  ·  `cerrarJornadaUI()` L623  ·  `abrirCompletarTarea(registroId)` L634  ·  `cerrarCompletarTarea()` L644  ·  `comprimirImagenParaSubir_(archivo, callbackExito, callbackError)` L649  ·  `confirmarCompletarTareaUI()` L680  ·  `agregarFotosEvidenciaTarea()` L722  ·  `quitarFotoEvidenciaTarea(indice)` L733  ·  `pintarFotosEvidenciaTarea_()` L738  ·  `prepararSelectEquiposTarea_(valor)` L762  ·  `prepararCajaEquipos_(idOculto, idCaja, valor)` L771  ·  `sincronizarCajaEquipos_(idOculto, idCaja)` L795  ·  `bloquearDecimales_(event)` L802  ·  `abrirModalSaltoUnico(registroId)` L809  ·  `cerrarSaltoUnico()` L819  ·  `enviarAlertaSaltoUI()` L823  ·  `confirmarSaltoAutorizadoUI()` L837  ·  `generarCodigoSaltoUI(registroId)` L852  ·  `devolverTareaColaUI(registroId)` L867  ·  `ligaFotosAntes_(lista)` L882  ·  `asegurarTarjetaReabrir_()` L894  ·  `abrirReabrirTrabajo(registroId)` L918  ·  `cerrarReabrirTrabajo()` L931  ·  `agregarFotosReabrir()` L936  ·  `pintarFotosReabrir_()` L945  ·  `confirmarReabrirTrabajoUI()` L967

### `js_usuarios.html` — 23 funciones
`pintarUsuarios(usuarios)` L3  ·  `pintarHorarios(horarios)` L43  ·  `pintarMatrizPermisos(matriz)` L56  ·  `filtrarPermisosMovil()` L85  ·  `sincronizarPermiso_(clave, rol, valor)` L93  ·  `cambiarPermisoDesde_(el)` L99  ·  `fechaLocalIso_(d)` L108  ·  `pintarAuditoria(filas)` L112  ·  `llenarOpcionesAuditoria_(id, textoTodos, valores)` L129  ·  `filtrarAuditoria(conservarPagina)` L138  ·  `textoComparativaAuditoria_(c)` L160  ·  `claseComparativaAuditoria_(c)` L168  ·  `pintarPaginaAuditoria_()` L173  ·  `cambiarPaginaAuditoria(delta)` L211  ·  `limpiarFiltrosAuditoria()` L219  ·  `cambiarPermiso(clave, rol, valor)` L224  ·  `abrirAlta()` L231  ·  `abrirEdicion(idUsuario)` L243  ·  `cerrarFormularioUsuario()` L259  ·  `guardarUsuario()` L263  ·  `darBaja(idUsuario)` L287  ·  `reactivar(idUsuario)` L294  ·  `regenerarCodigo(idUsuario)` L301

### `Lecturas.js` — 7 funciones
`crearHojasLecturasMedidores()` L21  ·  `leerTablaSimple_(nombre)` L30  ·  `obtenerPadronMedidores(token)` L38  ·  `registrarLecturaMedidor(token, d)` L58  ·  `subir(f, sufijo)` L75  ·  `listarLecturasMedidoresPeriodo(token, periodo)` L111  ·  `carpetaFotosMedidores_(periodo)` L122

### `Reapertura.js` — 2 funciones
`reabrirTrabajoCompletado(token, registroId, motivo, fotos)` L15  ·  `soloColumnasExistentes_(encontrado, campos)` L90

### `Reportes.js` — 19 funciones
`puedeVerReportes_(usuario)` L9  ·  `requiereReportes_(token)` L13  ·  `fechaClaveReporte_(v)` L20  ·  `fechaHoraTextoReporte_(v)` L34  ·  `leerTablaSiExiste_(nombre)` L43  ·  `enRango_(clave, desde, hasta)` L48  ·  `construirReporte_(filtros)` L60  ·  `hojaDe_(nombre, lista, columnas)` L301  ·  `opcionesFiltrosReporte(token)` L330  ·  `obtenerDashboard(token, filtros)` L341  ·  `comparativaParaReporte_(r)` L350  ·  `obtenerDatosReporteExcel(token, filtros)` L362  ·  `carpetaReportes_()` L371  ·  `guardarExcelReporteEnDrive(token, base64, nombreArchivo)` L383  ·  `tablaComparativaPdf_(c, tabla_)` L391  ·  `escHtmlReporte_(s)` L401  ·  `generarReportePdf(token, filtros)` L406  ·  `tabla_(titulo, columnas, filas, max)` L411  ·  `kpi_(titulo, valor)` L420

### `Tareas_Cola.js` — 66 funciones
`crearHojasBloque2(token)` L1  ·  `generarIdTarea_()` L30  ·  `siguienteOrdenCola_()` L40  ·  `obtenerCatalogoTareas_()` L47  ·  `obtenerCatalogoPasos_()` L56  ·  `obtenerCatalogoMateriales_()` L65  ·  `invalidarCacheCatalogoTareas_()` L74  ·  `invalidarCacheCatalogoPasos_()` L75  ·  `invalidarCacheCatalogoMateriales_()` L76  ·  `listarCatalogoTareas(token)` L78  ·  `listarPasosDeTarea_(tareaId)` L84  ·  `listarMaterialesDeTarea_(tareaId)` L90  ·  `obtenerTareaDetalle(token, tareaId)` L94  ·  `guardarTarea(token, datos)` L114  ·  `cambiarActivoTarea(token, tareaId, activo)` L157  ·  `generarIdPaso_()` L170  ·  `guardarPaso(token, datos)` L181  ·  `eliminarPaso(token, pasoId)` L213  ·  `generarIdMaterialRelacion_()` L224  ·  `guardarMaterialTarea(token, datos)` L235  ·  `eliminarMaterialTarea(token, relacionId)` L267  ·  `generarIdExtra_()` L278  ·  `listarTrabajosExtra(token)` L288  ·  `guardarTrabajoExtra(token, datos)` L295  ·  `cambiarEstadoTrabajoExtra(token, id, nuevoEstado, notas)` L335  ·  `tareaAplicaHoy_(t, fecha)` L358  ·  `proximasRevisionesProgramadas(token)` L370  ·  `asegurarColaDelDia_(fecha)` L394  ·  `invalidarColaDelDia_()` L405  ·  `asegurarColaDelDiaSinCache_(fecha)` L409  ·  `listarColaDelDia(token, fecha, incluirOcultos)` L460  ·  `motivoOcultoEnCola_(o, mapas, fechaDesde)` L483  ·  `construirColaDelDia_(fecha, opciones)` L509  ·  `valorPosicionManual_(v)` L601  ·  `claveOrdenCola_(o, catalogo, tickets)` L621  ·  `mapasOrdenCola_()` L645  ·  `asegurarColumnasPausa_()` L656  ·  `pausarFilaCola_(encontrado, usuario, motivo)` L664  ·  `tomarTarea(token, registroId, motivoPausa)` L689  ·  `tomarSiguienteTarea(token, motivoPausa)` L762  ·  `reanudarTareaPausada(token, registroId, motivoPausa)` L767  ·  `pausarTareaManual(token, registroId, motivo)` L771  ·  `carpetaFotosEvidenciaTareas_()` L792  ·  `asegurarHojaEvidencias_()` L804  ·  `generarIdEvidencia_()` L817  ·  `registrarEvidenciaFoto_(usuarioId, tipo, entidadId, url)` L821  ·  `completarTarea(token, registroId, descripcionRealizada, fotoBase64, fotoMime, fotoNombre)` L828  ·  `generarCodigoNumerico_(longitud)` L885  ·  `tareaTieneBloqueoEstricto_(tareaId)` L890  ·  `correosConPermiso_(clavePermiso)` L895  ·  `solicitarCodigoSalto(token, registroId, motivo)` L902  ·  `generarCodigoSalto(token, registroId)` L942  ·  `saltarTareaConCodigo(token, registroId, codigo)` L960  ·  `agregarExtrasDelDiaACola_(fecha)` L1031  ·  `ticketsUrgentesDeHoyOrdenados_()` L1087  ·  `moverTicketEnCola(token, registroId, direccion)` L1114  ·  `sumarDias_(fechaStr, dias)` L1162  ·  `diaDeLaSemana_(fechaStr)` L1169  ·  `fechaSiguienteDiaHabil_(fechaStr)` L1175  ·  `ejecutarCierreJornada_(fechaCierre, idUsuarioActor, correoActor)` L1190  ·  `ejecutarCierreJornadaManual(token, fecha)` L1254  ·  `rolloverJornadaProgramado()` L1267  ·  `instalarTriggerCierreJornada_()` L1278  ·  `moverTareaEnCola(token, registroId, destino)` L1294  ·  `ordenEfectivo_(f)` L1303  ·  `devolverTareaACola(token, registroId, motivo)` L1359

### `Tickets_Comidas.js` — 19 funciones
`carpetaFotosTickets_()` L9  ·  `fotosAntesDeTicket_(t)` L20  ·  `guardarFotosAntesTicket_(ticketId, fotos)` L25  ·  `asignarTicketAbiertoSiAplica_(ticketId, usuario)` L41  ·  `generarIdTicket_()` L51  ·  `listarDestinatariosTicket(token)` L61  ·  `listarTickets(token)` L69  ·  `nombrePorId_(id)` L78  ·  `crearTicket(token, datos)` L102  ·  `atenderTicket(token, ticketId)` L168  ·  `buscarFilaColaPorTicket_(ticketId)` L180  ·  `editarTicket(token, ticketId, cambios)` L196  ·  `cancelarTicket(token, ticketId, motivo)` L252  ·  `generarIdComida_()` L284  ·  `pausarTareaEnCursoPorComida_(usuario)` L301  ·  `iniciarComida(token)` L316  ·  `terminarComida(token)` L341  ·  `obtenerEstadoComidaHoy(token)` L357  ·  `listarComidasHoyTodos(token)` L382

### `Utilidades.js` — 18 funciones
`ss_()` L1  ·  `hoja_(nombre)` L5  ·  `encabezados_(sh)` L13  ·  `filaAObjeto_(encabezados, fila)` L19  ·  `objetoAFila_(encabezados, obj)` L33  ·  `leerTabla_(nombreHoja)` L44  ·  `buscarFilaPorValor_(nombreHoja, columna, valor, comparacionInsensible)` L58  ·  `escribirCamposFila_(encontrado, campos)` L75  ·  `registrarAuditoria_(idUsuarioEjecuta, correoEjecuta, accion, entidad, idEntidad, valorAnterior, valorNuevo)` L106  ·  `obtenerConfig_(clave, porDefecto)` L124  ·  `listarConfig(token)` L131  ·  `actualizarConfig(token, clave, nuevoValor)` L136  ·  `validarCorreo_(correo)` L152  ·  `campoTexto_(campo, valor)` L163  ·  `setCell_(tabla, indiceFila, campo, valor)` L171  ·  `fechaHoy_()` L177  ·  `soloFecha_(valor)` L186  ·  `asegurarColumna_(nombreHoja, nombreColumna)` L194

## 6. Notas por módulo

### `Código.js`

| Función | Línea | Qué hace |
|---|---:|---|
| `doGet(e)` | ~81 | Sirve la Web App con `index.html`; agrega favicon y meta viewport/mobile |
| `incluir_(nombre)` | ~97 | Inserta un HTML del proyecto dentro de la plantilla |
| `onOpen()` | ~101 | Menú **Bitácora Mantenimiento** en la hoja |
| `menuAbrirPanel_()` | ~112 | Aviso modal (el panel real es la Web App) |
| `prepararAutenticacion()` | ~130 | Agrega columnas de acceso a USUARIOS y crea SESIONES. Idempotente. No pide token (se corre desde el editor) |
| `crearHojasFuturas(token)` | ~181 | Crea encabezados de hojas de bloques futuros y siembra EQUIPO_CATALOGO |

Constantes globales: `HOJAS` (~L31), `PERMISOS` (~L48), `ESTADOS_*` (~L66), parámetros de sesión y códigos (~L71-75).

### 4.2 `Auth_Usuarios.js`

- **Permisos y roles**: `rolesDisponibles_()` / `rolesDisponibles(token)`, `obtenerPermisos(rol)` (cache 30 min), `obtenerMatrizPermisos(token)`, `actualizarPermiso(token, clave, rol, valor)`, `usuarioTienePermiso_(usuario, clave)`.
- **Criptografía**: `generarSal_()`, `hashPassword_(password, sal)`, `generarCodigoVerificacion_()`, `generarTokenSesion_()`.
- **Activación / recuperación**: `solicitarCodigoAcceso(identificador)`, `crearCredenciales(correo, codigo, usuario, password)`, `restablecerPassword(...)`, `enviarCorreoCodigo_()`.
- **Sesiones**: `crearSesion_()`, `validarToken_(token)`, `requiereSesion_()`, `requierePermiso_()`, `login()`, `validarSesion()`, `cerrarSesion()`, `invalidarSesionesDeUsuario_()`.
- **Cuenta propia**: `cambiarMiPassword()`, `cambiarMiUsuario()`.
- **Administración**: `altaUsuario()`, `editarUsuario()`, `cambiarEstadoUsuario()` (baja lógica, nunca borra), `regenerarCodigoUsuario()`, `listarUsuarios()`, `obtenerUsuario()`, `listarHorarios()`, `guardarHorario()`, `listarAuditoriaReciente(token, limite)`.
- **Normalización para el cliente**: `usuarioParaCliente_()` (quita hash/sal), `usuarioParaListado_()`.

> `rolesDisponibles_()` deriva los roles de los **encabezados** de `ROLES_PERMISOS` a partir de la columna 3: agregar un rol = agregar una columna.

### 4.3 `Tareas_Cola.js` (archivo central)

| Bloque | Funciones clave |
|---|---|
| Creación de hojas | `crearHojasBloque2(token)` |
| Catálogo de tareas | `listarCatalogoTareas`, `obtenerTareaDetalle`, `guardarTarea`, `cambiarActivoTarea`, `generarIdTarea_`, `invalidarCacheCatalogoTareas_` |
| Pasos | `listarPasosDeTarea_`, `guardarPaso`, `eliminarPaso` |
| Materiales por tarea | `listarMaterialesDeTarea_`, `guardarMaterialTarea`, `eliminarMaterialTarea` |
| Trabajos programados (extras) | `listarTrabajosExtra`, `guardarTrabajoExtra`, `cambiarEstadoTrabajoExtra`, `validarTipoTrabajoExtra_`, `generarIdExtra_`, `agregarExtrasDelDiaACola_` |
| Armado de la cola | `tareaAplicaHoy_`, `asegurarColaDelDia_`, `asegurarColaDelDiaSinCache_`, `construirColaDelDia_`, `claveOrdenCola_`, `mapasOrdenCola_`, `BANDAS_COLA_`, `agregarModulosDelDiaACola_` |
| Toma y ejecución | `tomarTarea`, `tomarSiguienteTarea`, `pausarTareaManual`, `pausarFilaCola_`, `reanudarTareaPausada`, `completarTarea`, `devolverTareaACola`, `moverTareaEnCola`, `moverTicketEnCola`, `ticketsUrgentesDeHoyOrdenados_` |
| Saltos | `solicitarCodigoSalto`, `generarCodigoSalto`, `saltarTareaConCodigo`, `generarCodigoNumerico_`, `tareaTieneBloqueoEstricto_`, `correosConPermiso_` |
| Evidencias | `carpetaFotosEvidenciaTareas_`, `asegurarHojaEvidencias_`, `generarIdEvidencia_`, `registrarEvidenciaFoto_` |
| Cierre de jornada | `ejecutarCierreJornada_`, `ejecutarCierreJornadaManual`, `rolloverJornadaProgramado`, `instalarTriggerCierreJornada_`, `fechaSiguienteDiaHabil_`, `sumarDias_`, `diaDeLaSemana_` |
| Definición de lecturas | `DEFINICION_LECTURAS_` (~L930-984) usada por Checklist y formularios |

**Orden de la cola** (`claveOrdenCola_`): tickets Alta → catálogo → extras → tickets Media → tickets Baja. Lo arrastrado del día anterior se adelanta 40,000; el orden manual (`posicion_manual`) manda sobre todo.

**Caché**: `asegurarColaDelDia_` guarda `COLA_OK_<fecha>` 6 h; `invalidarColaDelDia_()` la borra solo para **hoy**.

**Ocultos en la cola (Fase 4)**: `motivoOcultoEnCola_(o, mapas, fechaDesde)` es la única regla. Devuelve el motivo, o texto vacío si se muestra. Nunca oculta `En proceso`/`Pausado` ni `Gas`. Oculta: Extra con renglón `Completada` o trabajo `Completado`/`Cancelado`; Ticket con renglón `Completada` o ticket `Atendido`/`Cancelado`; Catálogo con tarea `activo` falso y fecha ≥ `fechaDesde` (hoy). Se aplica en `construirColaDelDia_(fecha, {incluirOcultos})` (todas las respuestas `cola:`), en `tomarTarea` (siguiente y por id), en `moverTareaEnCola` (posiciones sobre lo visible), en `ticketsUrgentesDeHoyOrdenados_` y en `ejecutarCierreJornada_` (lo oculto no se traslada; se queda en su fecha). `listarColaDelDia(token, fecha, incluirOcultos)` solo devuelve ocultos a ENVIAR_TICKET o CARGAR_MODIFICAR_TAREAS (botón "Ver terminados y ocultos" en `js_trabajos`). `mapasOrdenCola_()` ahora trae `extras`. No se borra ni modifica ninguna fila. Prueba: `node pruebas/sim_cola.js apps-script`.

### 4.4 `Checklist_Equipos.js`

`obtenerDefinicionLecturasEquipo`, `obtenerCatalogoEquipos_`, `listarCatalogoEquipos`, `listarChecklistEquiposDelDia`, `registrarLecturaEquipo`, `equiposDeTarea_`, `equiposConLecturaHoy_`, `cerrarTareaColaPorEquipo_`, `generarNumeroAccion_`.

### 4.5 `Almacen.js`

`listarAlmacen`, `guardarMaterialAlmacen`, `ajustarExistenciaMaterial`, `registrarMovimientoAlmacen_`, `registrarEntradaMaterial`, `registrarSalidaMaterial`, `registrarConsumoMaterial`, `subirFotoMaterialAlmacen`, `prestarHerramienta`, `devolverHerramienta`, `listarPrestamosHerramientaMios`, generadores de ID.

### 4.6 `Tickets_Comidas.js`

`listarTickets`, `crearTicket` (crea también la fila de cola con `tipo_origen='Ticket'`), `atenderTicket`, `editarTicket`, `cancelarTicket`, `buscarFilaColaPorTicket_`, `listarDestinatariosTicket`, `asignarTicketAbiertoSiAplica_`, fotos del antes (`guardarFotosAntesTicket_`, `fotosAntesDeTicket_`), comidas (`iniciarComida`, `terminarComida`, `obtenerEstadoComidaHoy`, `listarComidasHoyTodos`, `pausarTareaEnCursoPorComida_`).

### 4.7 `Control_Gas.js`

Hojas `REPORTE_MOROSIDAD` y `CONFIG_GAS`. Funciones: `asegurarHojasGas_`, `moduloGasActivo_` (encendido si algún rol tiene `CONTROL_CIERRE_GAS`), `listarReporteGas`, `cargarReporteMorosidad`, `guardarMontoMinimoGas`, `guardarProrrogaGas`, `quitarProrrogaGas`, `obtenerTareaGas`, `registrarAccionGas`, `completarTareaGas_`, `agregarGasDelDiaACola_`, `agregarTrabajosVinculadosDelDiaACola_`, `agregarModulosDelDiaACola_`.

### 4.8 `Lecturas.js`

Hojas `MEDIDORES` y `LECTURAS_MEDIDORES`, fotos en Drive. `crearHojasLecturasMedidores()`, `obtenerPadronMedidores(token)` (cacheado para uso sin internet), `registrarLecturaMedidor`, `listarLecturasMedidoresPeriodo`, `carpetaFotosMedidores_`.

### 4.9 `Reportes.js`

`obtenerDashboard(token, filtros)`, `obtenerDatosReporteExcel`, `guardarExcelReporteEnDrive`, `generarReportePdf`, `opcionesFiltrosReporte`, `construirReporte_` (lectura de todas las hojas), `requiereReportes_` (Administrador, carga de tareas, auditoría de inventario o código de salto).

### 4.10 `Reapertura.js`

`reabrirTrabajoCompletado(token, registroId, motivo, fotos)`: regresa la fila a `Pendiente` sin asignar (y el extra a `Pendiente` si estaba `Completado` o `Cancelado`, Fase 4), guarda motivo/fotos, marca `reabierto_veces` y, si es ticket, lo reabre en `TICKETS_INDICACIONES`. `soloColumnasExistentes_` evita escribir columnas que no existen.

### 4.11 `Api_Offline.js`

- `doPost(e)` (~L39): enruta `ping`, `fuente`, `login`, `call`, `ops`, `snapshot`, `cerrarSesion`.
- `apiCall_(fn, args)`: ejecuta cualquier función global **excepto** `API_PROHIBIDAS`.
- `apiOps_(ops)`: aplica cambios sin internet; deduplica por `op_id` en `SYNC_LOG`; sustituye la hora del servidor por la del dispositivo (`conHoraDispositivo_`).
- `apiFuente_()`: entrega el HTML completo y un hash para que la PWA detecte cambios.
- `apiSnapshot_(token)`: paquete de datos para trabajo offline.
- Constantes: `API_OFFLINE_VERSION`, `HOJA_SYNC_LOG`, `HOJA_SESIONES_DISPOSITIVO`, `DURACION_SESION_DISPOSITIVO_DIAS = 30`.

### 4.12 `Utilidades.js`

`ss_()`, `hoja_(nombre)`, `encabezados_(sh)`, `filaAObjeto_`, `objetoAFila_`, `leerTabla_(nombre)`, `buscarFilaPorValor_` (búsqueda por columna, con modo insensible a mayúsculas), `escribirCamposFila_`, `setCell_`, `registrarAuditoria_`, `obtenerConfig_`, `listarConfig`, `actualizarConfig`, `validarCorreo_`, `fechaHoy_()`, `soloFecha_`, `asegurarColumna_` (agrega columna al final si falta).

> `asegurarColumna_` es la forma estándar de evolucionar el modelo de datos sin migraciones.

### 4.13 `Icono.js`

`urlIconoApp_()` genera/recupera un PNG en Drive y devuelve su URL; `regenerarIconoApp()` lo fuerza.

### 4.14 Frontend

| Archivo | Contenido |
|---|---|
| `index.html` | Login, activación en 2 pasos, recuperación, panel, saludo/Salir, botón "Menú principal", menú (14 botones), tarjetas de cada módulo, formularios y modales |
| `estilos.html` | Variables CSS, layout, tabla sticky para permisos, badges, botones, avisos, fotos, estilos de reportes |
| `js_nucleo.html` | `ESTADO`, `TOKEN`, bootstrap de sesión, login, activación, recuperación, `mostrarSeccion`, `mostrarMenuPrincipal`, `entrarConSesion`, `cargarSeccion_`, `mostrarError`/`mostrarExito`, `escapar_` |
| `js_trabajos.html` | `pintarCatalogoTareas`, `pintarTrabajosExtra`, `pintarColaHoy` (render de toda la cola), tomar/pausar/mover, completar con fotos comprimidas, salto, devolver, reabrir, cierre de jornada |
| `js_usuarios.html` | `pintarUsuarios`, `pintarHorarios`, `pintarMatrizPermisos`, `pintarAuditoria`, alta/edición/baja/reactivar |
| `js_almacen.html` | Inventario, filtros, movimientos, foto de material, préstamos |
| `js_gas.html` | Panel admin, carga de Excel (SheetJS), prórrogas, tarea del técnico |
| `js_equipos.html` | Checklist del día y formulario de lecturas |
| `js_tickets_comida.html` | Tickets, fotos del antes, atender/cancelar, comida |
| `js_reportes.html` | Filtros, KPIs, barras, exportación Excel/PDF |

## 7. Modelo de datos

### 9.1 Hojas y propósito

| Hoja | Propósito | Columnas principales |
|---|---|---|
| `USUARIOS` | Personas y credenciales | `id_usuario`, `nombre_completo`, `correo`, `rol`, `codigo_personal`, `estado`, `telefono`, `fecha_alta`, `fecha_baja`, `horario_id`, `notas`, `usuario`, `password_hash`, `password_salt`, `cuenta_activada`, `token_codigo`, `token_expira`, `intentos_fallidos`, `bloqueado_hasta` |
| `ROLES_PERMISOS` | Matriz permiso × rol | `clave_permiso`, `descripcion`, + una columna por rol |
| `HORARIOS` | Horarios de trabajo | `horario_id`, `nombre_horario`, `dias_aplicables`, `hora_entrada`, `hora_salida`, `activo` |
| `CONFIG_SISTEMA` | Parámetros (incluye `COMPARATIVA_MIN_REGISTROS`, Fase 6) | `clave`, `valor` |
| `LOG_AUDITORIA` | Bitácora de acciones | fecha, `id_usuario`, `correo_ejecuta`, `accion`, `entidad`, `id_entidad_afectada`, `valor_anterior`, `valor_nuevo` |
| `SESIONES` | Tokens de sesión web | `token_sesion`, `id_usuario`, `creado`, `expira` |
| `CATALOGO_TAREAS_DIARIAS` | Tareas del día | `tarea_id`, `nombre_tarea`, `tipo`, `area_o_equipo_asociado`, `orden_cola`, `activo`, `requiere_pasos`, `bloqueo_estricto`, `periodicidad_dias`, `fecha_referencia` |
| `CATALOGO_PASOS_TAREA` | Pasos de una tarea | `paso_id`, `tarea_id`, `orden_paso`, `nombre_paso`, `descripcion` |
| `CATALOGO_MATERIALES_POR_TAREA` | Materiales por tarea | `relacion_id`, `tarea_id`, `material_id`, `cantidad` |
| `COLA_TRABAJO_DIARIO` | Cola del día | `registro_id`, `fecha`, `tarea_id`, `estado`, `usuario_asignado_actual`, `hora_inicio`, `hora_fin`, `tiempo_total_minutos`, `codigo_salto`, `codigo_salto_confirmado`, `descripcion_realizada`, `tipo_origen`, `origen_id`, `tiempo_acumulado_segundos`, `rollover_desde`, `posicion_manual`, `orden_manual`, `motivo_salto`, `motivo_pausa`, `pausado_por`, `pausado_en`, `motivo_reapertura`, `fotos_reapertura_urls`, `reabierto_veces`, `reabierto_por`, `foto_evidencia_url`, `fotos_evidencia_urls`, `archivado_en` (Fase 5: fecha en que se copió al historial) |
| `TRABAJOS_EXTRA_PROGRAMADOS` | Trabajos programados | `id`, `descripcion`, `origen`, `fecha_programada`, `hora_programada`, `prioridad`, `estado`, `usuario_asignado`, `materiales_usados`, `tiempo_total_minutos`, `notas`, `tipo_trabajo`, `equipos_checklist`, `equipos_en_cola`, `registro_cola_id` |
| `TICKETS_INDICACIONES` | Tickets/indicaciones | `ticket_id`, `fecha_hora_creacion`, `creado_por`, `dirigido_a`, `mensaje`, `prioridad`, `estado`, `fecha_hora_atendido`, `trabajo_pausado_id`, `fotos_antes_urls`, `era_abierto` |
| `EVIDENCIAS_FOTOS` | Índice de fotos | `evidencia_id`, `fecha_hora`, `usuario_id`, `tipo`, `entidad_relacionada_id`, `url_drive` |
| `ALMACEN_CATALOGO_MATERIALES` | Inventario | `material_id`, `nombre`, `unidad_medida`, `stock_actual`, `stock_minimo`, `ubicacion` |
| `ALMACEN_MOVIMIENTOS` | Movimientos | `movimiento_id`, `fecha_hora`, `material_id`, `tipo`, `cantidad`, `usuario_id`, `tarea_relacionada_id`, `notas` |
| `ALMACEN_PRESTAMOS_HERRAMIENTA` | Préstamos | `prestamo_id`, `herramienta_id`, `usuario_id`, fechas, `estado` |
| `EQUIPO_HIDRO_ALTA_PRESION` / `..._BAJA_PRESION` / `..._COMERCIO` | Lecturas de hidroneumáticos | `registro_id`, `fecha_hora`, `psi`, `hz`, `amperes`, `bomba_activa`, `usuario_id`, `firma_evidencia_url` |
| `EQUIPO_PLANTA_ELECTRICA` / `EQUIPO_PLANTA_INCENDIOS` | Lecturas de planta | `registro_id`, `fecha_hora`, `psi`, `rpm`, `amperes`, `temperatura`, `bateria`, `diesel_pct`, etc. |
| `EQUIPO_CATALOGO` | Catálogo de equipos | `equipo_id`, `nombre`, `hoja_relacionada`, `frecuencia_revision`, `activo` |
| `PENDIENTES_PREVENTIVOS` | Detección de faltantes | `id`, `fecha_deteccion`, `detectado_por`, `area`, `tipo`, `foto_evidencia_url`, `material_disponible`, `material_faltante`, `estado`, `fecha_programada` |
| `CALIFICACIONES_CIERRE_TURNO` | Calificación del turno | `id`, `fecha`, `registro_cola_id`, `calificado_por`, `resultado`, `observaciones` |
| `COMIDAS_REGISTRO` | Comidas | `id`, `usuario_id`, `fecha`, `hora_inicio`, `hora_fin` |
| `MEJORAS_SOLICITADAS` | Solicitudes de mejora | `id`, `fecha`, `usuario_id`, `descripcion_mejora`, `estado`, `notas` |
| `REPORTE_MOROSIDAD` | Morosidad de gas | `clave`, `torre`, `departamento`, `fecha_carga`, `direccion`, `alias`, montos, `aplica_cierre`, prórroga, `estado_gas`, foto, ejecución, `quien_debe` |
| `CONFIG_GAS` | Configuración del módulo | `monto_minimo_cierre`, `actualizado_por` |
| `MEDIDORES` | Padrón de medidores | `torre`, `unidad`, `sistema`, `tipo`, `ultima_lectura`, `fecha_ultima`, `promedio_mensual`, `maximo_mensual`, `enteros`, `decimales`, `activo` |
| `LECTURAS_MEDIDORES` | Lecturas | `lectura_id`, `periodo`, `fecha_hora`, `torre`, `unidad`, `tipo`, `lectura`, `lectura_anterior`, `consumo`, `alerta`, datos OCR, `foto_url`, `registrado_por`, `id_usuario`, `op_id` |
| `HISTORIAL_TRABAJOS` | Historial de trabajos (Fase 5); se llena al cerrar jornada, nunca se borra | `fecha_jornada`, `registro_id`, `tipo`, `origen_id`, `tarea_id`, `nombre`, `estado_final`, `motivo`, `descripcion_realizada`, `tecnico_id`, `tecnico_nombre`, `hora_inicio`, `hora_fin`, `minutos_trabajados`, `foto_evidencia_url`, `fotos_evidencia_urls`, `reabierto_veces`, `archivado_en` |
| `SESIONES_DISPOSITIVO` | Tokens de PWA | `token_dispositivo`, `id_usuario`, `dispositivo`, `creada`, `expira`, `ultimo_uso`, `activa` |
| `SYNC_LOG` | Idempotencia offline | `op_id`, `id_usuario`, `tipo`, `ts_dispositivo`, `recibida`, `resultado`, `detalle` |

### 9.2 Identificadores

| Prefijo | Entidad | Generador | Mecanismo |
|---|---|---|---|
| `USR-` | Usuario | `generarIdUsuario_` | consecutivo sobre USUARIOS |
| `COLA-` | Renglón de cola | varios | máximo `COLA-#####` + 1 |
| `EXT-` | Trabajo programado | `generarIdExtra_` | máximo `EXT-####` + 1 |
| `TCK-` | Ticket | `generarIdTicket_` | consecutivo |
| `PASO-` | Paso | `generarIdPaso_` | consecutivo |
| `MAT-`/`MOV-` | Material/movimiento | `generarIdMaterialAlmacen_`, `generarIdMovimientoAlmacen_` | consecutivo |
| `COM-` | Comida | `generarIdComida_` | consecutivo |
| `EVI-` | Evidencia | `generarIdEvidencia_` | consecutivo |

> Todos los generadores calculan el máximo sobre las filas **existentes**. Si se borran filas, los IDs se reutilizan (relevante para la limpieza de historial).

---

## 8. Permisos

Definidos en `PERMISOS` (`Código.js` ~L48) y **materializados como filas** de `ROLES_PERMISOS`. Los roles son las columnas de esa hoja.

| Clave | Para qué sirve |
|---|---|
| `ALTA_BAJA_USUARIOS` | Alta/baja/edición de usuarios; también habilita ver auditoría |
| `EDITAR_PERMISOS_ROLES` | Editar la matriz de permisos |
| `CONFIGURAR_HORARIOS` | Horarios |
| `CONFIGURAR_SISTEMA` | Config, creación de hojas futuras |
| `CARGAR_MODIFICAR_TAREAS` | Catálogo, trabajos programados, reordenar cola, cierre de jornada |
| `GENERAR_CODIGO_SALTO` | Códigos de salto |
| `EJECUTAR_TAREAS_COLA` | Tomar/completar tareas y comidas |
| `REGISTRAR_LECTURA_EQUIPO` | Checklist de equipos |
| `REGISTRAR_ENTRADA_MATERIAL` / `REGISTRAR_SALIDA_MATERIAL` / `REGISTRAR_CONSUMO_MATERIAL` | Almacén |
| `AUDITORIA_INVENTARIO` | Auditoría de inventario y reportes |
| `ENVIAR_TICKET` | Crear/editar/cancelar tickets |
| `ATENDER_TICKET` | Atender tickets y reordenar urgentes |
| `CONTROL_CIERRE_GAS` | Módulo de gas (también es el interruptor de encendido) |

`usuarioParaCliente_` manda al cliente `usuario.permisos` ya resueltos; el cliente **oculta** botones según eso, pero la seguridad real está en `requierePermiso_` del servidor.

---

## 9. Máquinas de estado

### 9.1 `COLA_TRABAJO_DIARIO.estado`

```
Pendiente ──tomar──► En proceso ──completar──► Completada
    │                    │
    │                    ├──pausar──► Pausado ──continuar──► En proceso
    │                    │
    │                    └──devolver──► Pendiente
    ├──saltar (código)──► Saltada ──reactivar──► Pendiente
    └──desactivar tarea / cancelar ticket──► Saltada
```

### 9.2 `TRABAJOS_EXTRA_PROGRAMADOS.estado`

`Pendiente → En proceso → Completado | Cancelado` (los cambios se hacen desde el módulo de trabajos programados o al completar la fila de cola).

### 9.3 `TICKETS_INDICACIONES.estado`

`Abierto → Atendido | Cancelado`. Al crear un ticket se crea su renglón de cola; al cancelarlo, el renglón pasa a `Saltada`.

---

## 10. Convenciones del código

- **Nombres**: `snake_case` para campos de hoja y claves de datos; `camelCase` para funciones; sufijo `_` para funciones internas del servidor (aunque son globales para Apps Script) y para helpers del cliente.
- **Helpers obligatorios**: leer con `leerTabla_`, buscar con `buscarFilaPorValor_`, escribir con `setCell_`/`escribirCamposFila_`; nunca tocar rangos a mano salvo en creación de hojas.
- **Columnas nuevas**: `asegurarColumna_(hoja, columna)` (idempotente, al final).
- **Auditoría**: toda mutación relevante llama `registrarAuditoria_`.
- **Caché**: `CacheService.getScriptCache()` para catálogo, permisos, padrón y cola; invalidar explícitamente al mutar (`invalidarCacheCatalogoTareas_`, `invalidarColaDelDia_`, `remove('PERMISOS_' + rol)`).
- **Errores**: el servidor lanza `Error` con mensaje en español; el cliente lo muestra en `#avisoGeneral` vía `mostrarError`.
- **Fechas**: `fechaHoy_()` y `soloFecha_()` para claves de día; los `Date` se serializan a ISO en `filaAObjeto_`.
- **Pantallas**: una tarjeta por módulo en `index.html`, alternadas con `mostrarSeccion(id)`; los datos se cargan al abrir (`cargarSeccion_`).

---

## 11. Puntos frágiles detectados (leer antes de modificar)

| # | Hallazgo | Impacto |
|---|---|---|
| F1 | `cambiarEstadoTrabajoExtra` cambia el estado del extra pero **no** la fila de `COLA` | Mitigado en Fase 4: la fila sigue `Pendiente` en la hoja pero se oculta de la cola y no se puede tomar |
| F2 | `completarTarea` (~L788) cierra el ticket asociado, pero **no** marca el extra como `Completado` | El extra sigue `Pendiente` en su módulo aunque ya se hizo |
| F3 | `atenderTicket` no cierra la fila de cola del ticket | Mitigado en Fase 4: se oculta de la cola (ticket `Atendido`) |
| F4 | ~~`construirColaDelDia_` no filtra por `activo` ni por estado del origen~~ (resuelto en Fase 4 con `motivoOcultoEnCola_`) | — |
| F5 | Generadores de ID basados en máximo de filas existentes | Al archivar/borrar se reutilizan IDs y se rompen referencias (`origen_id`, `registro_cola_id`) |
| F6 | Caché `COLA_OK_<fecha>` de 6 h solo se invalida para hoy | Cambios de catálogo/extras no refrescan otros días |
| F7 | ~~No hay repositorio git~~ (resuelto en la Fase 0: GitHub + clasp, etiqueta `estado-V61`) | — |
| F8 | ~~Tablas de permisos y auditoría sin diseño móvil; botón de menú que se va con el scroll~~ (resuelto: Fase 3 tarjetas, Fase 7 barra fija) | — |
| F14 | En `ROLES_PERMISOS` hay claves que el código no consulta (`VER_DASHBOARD`, `EXPORTAR_REPORTES`, `REGISTRAR_COMIDA`, `CALIFICAR_TRABAJOS_CIERRE`, `SUBIR_EVIDENCIA_FOTOGRAFICA`, `CARGAR_PENDIENTE_PREVENTIVO`). Reportes usa `PERMISOS_REPORTES_` y "Mi comida" usa EJECUTAR_TAREAS_COLA | Cambiar esos interruptores no tiene efecto; decidir si se conectan o se quitan |
| F15 | ~~Botones creados al pintar (`btnTomarSiguiente`, `btnCerrarJornada`, `btnVerOcultosCola`, `btnNuevoUsuario`) quedaban visibles para otro perfil que entrara en el mismo navegador~~ (resuelto en Fase 8: `entrarConSesion` los quita) | — |
| F16 | En la web normal (sin PWA) las tablas antiguas eran más anchas que el celular y empujaban "Salir" fuera de la pantalla | Mitigado en Fase 8: en 820 px o menos cada tarjeta del panel se desplaza por dentro (`#panel .tarjeta{overflow-x:auto}`); en la PWA las tablas ya son tarjetas |
| F13 | `listarAuditoriaReciente` solo pide sesión, no un permiso: cualquier usuario con sesión puede leer la auditoría si llama la función directamente (el botón del menú sí está restringido) | Exposición de datos de auditoría |
| F9 | `doPost` no expone cabeceras HTTP y `API_PROHIBIDAS` es una lista negra | Cualquier función global nueva queda callable desde la PWA salvo que se agregue a la lista |
| F10 | `LOG_AUDITORIA` crece sin límite ni rotación | La hoja se vuelve lenta con el tiempo |
| F11 | El estado de la cola se recalcula completo en cada lectura (`leerTabla_` de todas las hojas) | Costo creciente con el volumen |
| F12 | `cancelarTicket` deja el renglón de cola como `Saltada` con el texto del motivo | Se confunde con un salto normal en reportes |

---

## 12. Checklist para modificar sin romper

1. **¿Nueva función pública?** Agregarla a `API_PROHIBIDAS` si no debe llamarse desde la PWA; probar `apiCall_`.
2. **¿Nuevo permiso?** Agregar la clave en `PERMISOS` + fila en `ROLES_PERMISOS` + botón condicionado en `js_nucleo.html` (`entrarConSesion`) + `requierePermiso_` en el servidor.
3. **¿Nueva columna?** `asegurarColumna_` + default en el objeto que la escribe + incluirlo en `objetoAFila_` (toma las claves de los encabezados).
4. **¿Nueva hoja?** Crearla con una función idempotente tipo `crearHojasBloque2` y documentarla aquí.
5. **¿Mutación de cola/extras/tickets?** Invalidar `COLA_OK_*` y devolver `cola: construirColaDelDia_(fechaHoy_())`.
6. **¿Cambio de UI?** Respetar `mostrarSeccion`/`mostrarMenuPrincipal`, `marcarCargando_`, `escapar_` y las clases de `estilos.html`.
7. **¿Cambio de datos existentes?** Respaldo previo de la hoja en Drive y `registrarAuditoria_`.
8. **¿Despliegue?** `clasp push` + "Nueva versión" sobre la implementación activa (nunca "Nueva implementación"; verificar el selector) + probar `doGet` y `doPost`.

---

## 13. Glosario

- **Cola**: lista de trabajos de un día (`COLA_TRABAJO_DIARIO`).
- **Extra / trabajo programado**: trabajo puntual con fecha (`TRABAJOS_EXTRA_PROGRAMADOS`), entra a la cola con `tipo_origen = 'Extra'`.
- **Ticket / indicación**: petición dirigida a alguien o abierta, entra a la cola con `tipo_origen = 'Ticket'`.
- **Rollover**: traslado automático de lo pendiente al siguiente día hábil.
- **Salto**: omitir una tarea con código autorizado o con solicitud al supervisor.
- **Snapshot**: paquete de datos que la PWA guarda para trabajar sin internet.
- **Op**: cambio offline identificado por `op_id`, aplicado una sola vez en `SYNC_LOG`.

---

## 14. Historial de versiones (proyecto de mejoras, nov 2026)

| Versión Apps Script | Etiqueta git | Fase | Cambio |
|---|---|---|---|
| 62 | `estado-V61` | 0 | Referencia: código de producción sincronizado con clasp en `apps-script/` (el plan decía V61; la implementación activa estaba en la 62) |
| 63 | `fase-1-v63` | 1 | `INDICE.md`, `index.html` separado en `vista_*` con `include`, habilidad `bitacora-mm103-mapa` |
| 64 | `fase-7-v64` | 7 | Barra fija "← Menú principal / Salir", zona segura, aviso de cambios sin subir; PWA `sw.js` 0.6.1 |
| 65 | `fase-3-v65` | 3 | Permisos y auditoría en tarjetas (≤820 px), filtros y páginas de 20 |
| 66 | `fase-4-v66` | 4 | Cola sin extras/tickets terminados ni tareas desactivadas (`motivoOcultoEnCola_`), "Ver terminados y ocultos" |
| 67 | `fase-5-v67` | 5 | `HISTORIAL_TRABAJOS` al cerrar jornada, pantalla Historial, Excel/PDF |
| 68 | `fase-6-v68` | 6 | Comparativa de tiempos por técnico (Auditoría, Reportes, Excel/PDF), umbral `COMPARATIVA_MIN_REGISTROS` = 2 |
| 69 | `fase-8-v69` | 8 | Pruebas de cierre por rol; quita botones de otro perfil al cambiar de usuario; tablas antiguas contenidas en celular (web) |

Pendiente: **Fase 2** (recepción de datos de la otra app de Apps Script), pausada hasta tener acceso completo a esa app. Lista de pruebas por rol: `docs/PRUEBAS_FASE8.md`. Pruebas automáticas: `pruebas/README.md`.

## Cambios 2026-11-11 (gas desde el Probador)

- `Enlace_Probador.js`: `gasEvaluarProbador_` / `gasPendientesProbador_` leen la hoja del Probador (Medidores, CierreMontos, CierreEstado, CierreProrrogas, CierreSolicitudes, CierreImportes) y calculan el gas pendiente (solo lectura, caché 60 s). `obtenerResumenProbador` ahora exige `CONTROL_CIERRE_GAS`.
- `Control_Gas.js`: `moduloGasActivo_` devuelve `true`; `gasPendientes_` y `gasTareaVista_` usan el Probador; `registrarAccionGas` ya no registra (el técnico solo consulta); una sola tarea de gas por día en la cola.
- `js_nucleo.html`: el botón "Lecturas y gas (Probador)" solo aparece con `CONTROL_CIERRE_GAS`. `js_gas.html`: la vista del técnico es una lista de consulta.
- `pruebas/sim_gas_probador.js`: prueba de la evaluación (8 casos).
- `puente.js`/`sw.js` 0.6.3: los avisos de sesión vencida no cuentan como "con problema".

## Cambios 2026-11-11 (tickets atendidos)

- `Tareas_Cola.js` (`construirColaDelDia_`): un ticket atendido o completado hoy ya no se oculta; sale con `ticket_terminado: true`, al final de la lista, hasta el cierre de jornada (entonces pasa al historial). Los cancelados siguen ocultos. `motivoOcultoEnCola_` no cambió (el traslado de jornada y el historial dependen de él).
- `Reapertura.js`: también reabre un ticket atendido desde la pantalla de tickets (renglón aún Pendiente); en tickets la foto es opcional, el motivo sigue obligatorio.
- `js_trabajos.html`: el ticket terminado muestra "Atendido" y solo el botón "Volver a abrir". `puente.js`/`sw.js` 0.6.4: el modo sin internet marca igual el ticket atendido.
- `pruebas/sim_cola.js`: expectativas actualizadas (21 casos).

## Cambios 2026-11-11 (gas con foto y validación en el Probador)

- Flujo del técnico: (1) la app muestra la siguiente unidad con su acción (Abrir/Cerrar); (2) foto obligatoria; (3) `registrarAccionGas` guarda la evidencia y llama a `marcarGasProbador_` (`Enlace_Probador.js`), que escribe en la hoja del Probador (`CierreEstado` + `Bitacora`, a nombre del técnico; el Probador solo acepta token de Google, por eso se escribe directo); (4) se vuelve a leer el Probador (`gasPendientesProbador_(hoy, true)`) y aparece la siguiente unidad. Orden obligatorio; un reintento de una unidad ya validada responde sin error.
- `completarTareaGas_` exige que el Probador ya no tenga unidades pendientes (si no se puede leer, no cierra).
- `js_gas.html`: `pintarGasTecnico` y `confirmarAccionGasUI` vuelven a ser interactivos. `pruebas/sim_gas_probador.js`: 13 casos.
