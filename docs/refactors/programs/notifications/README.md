# Fronteras de Notifications

## Diagnóstico

La entrada ya es neutral después de NOTIF-2: `NotificationsEventsListener` solo atiende eventos de plataforma y los dominios productores, como Finance, traducen sus propios eventos y envían intents al sink. No queda interpretación de eventos, estados ni copy de Finance en este paquete.

## Objetivo

Notifications es dueño de persistencia, policy y entrega por canal. Los dominios productores crean `NotificationIntent` con su propia semántica; Notifications procesa el contrato neutral y consulta preferencias de módulo mediante settings genéricos.

## Fases

El [índice de fases](phases/README.md) reúne objetivos, issues, PRs relacionados y estados. NOTIF-2 depende de FIN-4 y NOTIF-1; NOTIF-3 depende de PLATFORM-SETTINGS-2.

## Límites que se conservan

- Se mantienen persistencia, estado de lectura, policy, canales, push tokens, reintentos, WebSocket, email, horas de silencio e idempotencia.
- `AiSignal`, `DomainEvent` y `NotificationIntent` son contratos distintos.
- Ningún dominio importa Notifications para producir un aviso: usan el token de `@personal-os/contracts` y la app compone el sink.
- Se conservan BullMQ, WebSocket, FCM y Resend. No se reemplazan por simetría arquitectónica ni se genera el copy con un LLM por defecto.
