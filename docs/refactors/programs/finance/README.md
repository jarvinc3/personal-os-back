# Fronteras de Finance

## Diagnóstico

Finance ya separa sus áreas de dominio y debe conservar esa lógica. El límite pendiente es la propiedad: Finance aún tiene restos de la ingesta de Gmail, expone contratos demasiado amplios a la IA y mantiene semántica de notificaciones y eventos que debe vivir en sus dominios productores, no en infraestructura compartida.

## Objetivo

Retirar la propiedad de fuentes de correo de Finance y definir contratos acotados para señales, capacidades, eventos y `NotificationIntent`. Conservar los algoritmos financieros y su comportamiento; no convertir este trabajo en una reescritura de Ledger.

## Fases

Consulta el [índice de fases](phases/README.md) para ver objetivos, issues y PRs relacionados.

## Límites que se conservan

- Los movimientos, saldos, importaciones, conciliaciones y sus algoritmos siguen siendo responsabilidad de Finance.
- La ruta de entrada es `FinanceSignalConsumer`, no Gmail. La clasificación de correo y su revisión general pertenecen a Intelligence.
- La IA usa capacidades/adaptadores de Finance; `FinanceFacade` no es la frontera universal. Finance resuelve sus entidades sin conocer `ChatContextEntity`.
- Los eventos, el copy y los intents semánticos pertenecen a Finance; transporte, policy y entrega compartidos no.
- No se reescribe Ledger ni se cambian reglas de negocio sin evidencia y un issue propio.
