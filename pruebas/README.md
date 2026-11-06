# Pruebas automáticas (sin tocar Google)

Simulan el servidor de Apps Script con hojas en memoria y **datos ficticios**. Se corren desde la raíz del repositorio:

```
node pruebas/sim_cola.js apps-script         # Fase 4: qué se oculta en la cola, tomar, mover, reabrir, cierre
node pruebas/sim_historial.js apps-script    # Fase 5: archivado en HISTORIAL_TRABAJOS, sin duplicados, consulta
node pruebas/sim_comparativa.js apps-script  # Fase 6: comparativa de tiempos, umbral en CONFIG_SISTEMA, auditoría, reportes
```

Cada una termina con `Resultado: N OK, 0 FALLA`. Córrelas todas antes de publicar cualquier cambio en `apps-script/`.

Revisión visual (Fase 8): se arma la interfaz completa expandiendo los `include` de `apps-script/index.html`, con un `google.script.run` simulado, y se entra como cada rol a 360, 768 y 1280 px. En teléfono simulado no basta comparar `scrollWidth` con `innerWidth` (la página se agranda con el contenido): hay que buscar elementos cuyo borde derecho pase del ancho y no estén dentro de un contenedor con desplazamiento propio.
