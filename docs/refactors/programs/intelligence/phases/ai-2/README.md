# AI-2 — Roles, Gmail y corpus con consentimiento

**Issue:** [back #205](https://github.com/jarvinc3/personal-os-back/issues/205)

**PR relacionado:** el historial del issue no registra un PR de implementación único. La estrategia de sync incremental está en [#202](https://github.com/jarvinc3/personal-os-back/pull/202); la fase se incluyó en el release [#226](https://github.com/jarvinc3/personal-os-back/pull/226).

## Objetivo

Ingerir correo con consentimiento y aislamiento por usuario. Persistir el estado necesario para reintentos y recuperación, sin hacer que Finance sea dueño de Gmail.

## Alcance

- Conexión OAuth de solo lectura con tokens protegidos, roles y consentimiento revocable.
- Bootstrap histórico y polling incremental con cursor persistido; recuperación acotada e idempotente.
- Mensajes crudos, saneados y canónicos con huellas, aislamiento por usuario y retención.
- Vista de estado de conexión, progreso y detalle de mensajes.

## Gate

El bootstrap repetido no duplica mensajes; una corrida perdida o repetida no daña el corpus; el cursor avanza solo con cambios del proveedor; las pruebas de aislamiento impiden que un usuario lea mensajes de otro; los endpoints de administración exigen el rol requerido.

El diseño original y su contexto se conservan en [el roadmap archivado](../../../../archive/intelligence/07-roadmap-and-testable-phases-v1.md#phase-2--roles-gmail-source-persistent-corpus-and-consent).
