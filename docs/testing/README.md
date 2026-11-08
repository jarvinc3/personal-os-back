# Casos de prueba manuales

Este catálogo conserva los 104 casos de AI-0 a AI-11 y permite guardar cada ronda sin alterar el catálogo. Las pruebas son manuales; no se ejecutan desde el generador.

## Catálogos

- [Finanzas](./finance/cases.csv): 25 casos de AI-0 y AI-11.
- [Inteligencia](./intelligence/cases.csv): 79 casos de AI-1 a AI-10 y el borrado de conocimiento AI4-13.
- [Importación por correo](./finance/email-import-cases.csv): 18 casos propuestos de normalidad, borde, ambigüedad, duplicados, conflicto de referencia y aislamiento. No forman parte de la ronda de 104 hasta que el contrato esté implementado y el caso sea ejecutable; hoy no se marcan como Pasa.

Los IDs originales se conservan para mantener la trazabilidad. AI4-13 borra los datos de la cuenta de pruebas y siempre aparece al final de una ronda.

## Antes de empezar

- Usa solo un entorno local, DEV o QA. No ejecutes estos casos en producción.
- Inicia sesión con la cuenta ADMIN de QA. Los casos de permisos también requieren una cuenta de pruebas sin rol ADMIN; si no está disponible, marca el caso como **Bloqueado** y anota el motivo.
- Para los casos de Gmail, la cuenta de QA debe estar conectada y sincronizada en DEV.
- Para las pruebas de transferencias, la cuenta QA debe tener una cuenta BHD y otra cuenta propia disponible como destino.
- La cuenta de pruebas debe tener un movimiento importado de RD$1,250 y uno manual de RD$7.25, ambos pendientes.
- Usa archivos de prueba anonimizados y datos sintéticos. No copies correos, contraseñas, tokens ni datos personales reales al catálogo, a la ronda o a sus evidencias.
- Ejecuta AI4-13 solo después de terminar los demás casos. Elimina los datos de la cuenta de QA; vuelve a cargar los datos de prueba antes de iniciar otra ronda.

Si falta un requisito para ejecutar un caso, no lo marques como **Falla** ni lo omitas: usa **Bloqueado** y explica qué falta en «Resultado actual».

## Columnas

Los CSV mantienen los datos del caso, el resultado actual vacío y el estado inicial **Pendiente**. Las dependencias son IDs separados por comas.

- **Tipo:** `funcional` comprueba el flujo esperado; `borde` comprueba errores, cancelaciones o límites; `regresion` confirma que un comportamiento existente se conserva; `permisos` comprueba acceso o privacidad.
- **Prioridad:** `High` para riesgo de dinero, privacidad, acceso o borrado; `Medium` para flujos principales; `Low` para información secundaria o comprobaciones cubiertas por CI.
- **Estado:** `Pendiente`, `Pasa`, `Falla` o `Bloqueado`.

## Crear una ronda

Desde la raíz de `personal-os-back`, crea el archivo XLSX con el commit actual y la fecha UTC:

```bash
pnpm testing:build-run build
```

También puedes indicar la fecha y el identificador del build:

```bash
pnpm testing:build-run build --date=2026-11-04 --build=dbfc1b9d
```

El resultado queda en `docs/testing/runs/<fecha>-<build>.xlsx`. Si no indicas opciones, usa la fecha UTC actual y el commit actual de Git. El comando no sobrescribe una ronda existente.

El libro tiene dos hojas:

- **Casos:** datos del catálogo, estado con lista desplegable y colores, resultado actual, fecha, tester, build/commit, evidencia e issue. El build/commit se completa al crear la ronda; los demás campos de ejecución empiezan vacíos.
- **Resumen por fase:** total de casos, ejecutados, Pasa, Falla, Bloqueado, Pendiente, porcentaje ejecutado y porcentaje de aprobados.

El porcentaje ejecutado cuenta **Pasa + Falla**; los casos Bloqueado no se cuentan como ejecutados. El porcentaje de aprobados es **Pasa / (Pasa + Falla)**; si no hay casos ejecutados, muestra 0 %.

## Registrar resultados

En la hoja **Casos**, actualiza cada caso después de probarlo:

1. Elige un estado de la lista.
2. Escribe en «Resultado actual» lo que observaste y en «Fecha» cuándo lo probaste.
3. Registra el tester, el build/commit, una ruta o enlace de evidencia anonimizada y el issue relacionado, si existe.
4. Para **Falla**, abre un bug con la plantilla del repositorio. Incluye el ID del caso en el título y registra los pasos, el resultado esperado y el observado, el entorno y el build/commit. Enlaza el issue en la columna «Issue».
5. Para **Bloqueado**, explica el requisito que falta. No abras un bug si no se observó un fallo del producto.

No guardes resultados reales en los archivos de catálogo; cada ronda conserva su propio resultado.

## Exportar una ronda

Después de registrar los resultados en Excel, exporta la hoja **Casos** a CSV:

```bash
pnpm testing:build-run export docs/testing/runs/2026-11-04-dbfc1b9d.xlsx
```

El comando crea `docs/testing/runs/2026-11-04-dbfc1b9d.csv` con los datos y resultados de cada caso. No exporta la hoja de resumen y no sobrescribe un archivo existente. El XLSX se conserva como registro editable de la ronda.

El nombre debe incluir una fecha real. La hoja **Casos** debe conservar exactamente todos los IDs de los catálogos vigentes (hoy 104), sin duplicados ni IDs ajenos; se permiten todos los estados válidos, incluido **Pendiente**. El exportador rechaza fórmulas insertadas en sus celdas y antepone un apóstrofo a valores de texto que comienzan, incluso tras espacios o controles, con `=`, `+`, `-` o `@`.

La guía de pruebas automáticas sigue en [operations/testing.md](../operations/testing.md). Esta herramienta no ejecuta esos tests ni sustituye la CI.
