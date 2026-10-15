# Matriz de trazabilidad — personal-os-back

Fecha: 2026-09-15. Cada fila: documentación destino + evidencia de código. Afirmaciones no verificadas → [review-register.md](../review-register.md).

| Área                 | Doc destino                             | Código / tests                                                                              |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| Auth session         | `modules/auth/`                         | `auth.controller.ts`, `test/auth.e2e-spec.ts`                                               |
| Users me/modules     | `modules/users/`                        | `users.service.ts`, e2e                                                                     |
| Notifications        | `modules/notifications/`                | controller, policy, listener, e2e                                                           |
| AI chat/tools        | `modules/ai-agent/`                     | `tool.registry.ts`, `module-context.ts`, e2e                                                |
| Finance capabilities | `modules/finance/capabilities/*`        | `packages/finance/src/*`, `test/finance.e2e-spec.ts`                                        |
| Env                  | `infrastructure/config.md`              | `env.schema.ts`                                                                             |
| Health               | `infrastructure/health.md`              | `health.controller.ts`                                                                      |
| Events/queues        | `infrastructure/events-and-queues.md`   | `event.constants.ts`, `queue.constants.ts`                                                  |
| Envelope             | `infrastructure/errors-and-envelope.md` | `transform.interceptor.ts`                                                                  |
| Module folders       | `architecture/modules.md`               | barrels + eslint                                                                            |
| Scripts fantasma     | REV-BACK-005                            | resuelto (2026-10-15, back `v0.36.0`): `db:reconcile-balances` retirado                     |
| Health envelope      | REV-BACK-012                            | curl `/api/health*` envuelve `{data,meta}` (2026-09-15, PORT 3100)                          |
| LoggingInterceptor   | REV-BACK-001                            | resuelto (2026-10-15, back `v0.36.0`): registrado en `CoreModule`; guard/decorador borrados |
| email_sync.failed    | REV-BACK-003                            | resuelto (2026-10-15, back `v0.36.0`): outbox al fallar el sync                             |
| MAX_EMAIL_* env      | REV-BACK-002                            | resuelto (2026-10-15, back `v0.36.0`): validados en `env.schema`                            |
| Cron comment         | REV-BACK-004                            | resuelto (2026-10-15, back `v0.36.0`): comentario actualizado                               |
| Smoke finance        | REV-BACK-005, 011                       | resuelto (2026-10-15, back `v0.36.0`): `pnpm smoke:finance`; `db:reconcile-balances` fuera  |
| Roadmap back         | REV-BACK-006, 007, 008                  | `docs/roadmap.md`                                                                           |

Inventario de endpoints finance: controllers bajo cada capability (no se duplica aquí la tabla completa de 40+ rutas).
