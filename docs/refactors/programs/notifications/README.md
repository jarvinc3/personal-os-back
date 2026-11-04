# Fronteras de Notifications

## Diagnóstico

La estructura interna de Notifications es adecuada. El acoplamiento está en la entrada: `NotificationsEventsListener` interpreta eventos, estados, preferencias y copy de Finance. Si se mantiene, cada dominio nuevo ampliará ese switch central.

## Objetivo

Notifications es dueño de persistencia, policy y entrega por canal. Los dominios productores crean `NotificationIntent` con su propia semántica; Notifications procesa el contrato neutral y consulta preferencias de módulo mediante settings genéricos.

## Fases

El [índice de fases](phases/README.md) reúne objetivos, issues, PRs relacionados y estados. NOTIF-2 depende de FIN-4 y NOTIF-1; NOTIF-3 depende de PLATFORM-SETTINGS-2.

## Límites que se conservan

- Se mantienen persistencia, estado de lectura, policy, canales, push tokens, reintentos, WebSocket, email, horas de silencio e idempotencia.
- `AiSignal`, `DomainEvent` y `NotificationIntent` son contratos distintos.
- Los eventos de importación por email y su copy se retiran con FIN-1; no quedan huérfanos hasta NOTIF-2.
- Se conservan BullMQ, WebSocket, FCM y Resend. No se reemplazan por simetría arquitectónica ni se genera el copy con un LLM por defecto.
