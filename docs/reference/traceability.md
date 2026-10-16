# Matriz de trazabilidad — personal-os-back

Cada fila: documentación destino + evidencia de código. El seguimiento de estado, roadmap y hallazgos vive en GitHub Issues del repositorio (label `roadmap`).

| Área                 | Doc destino                                                                                         | Código / tests                                       |
| -------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Auth session         | `modules/auth/`                                                                                     | `auth.controller.ts`, `test/auth.e2e-spec.ts`        |
| Users me/modules     | `modules/users/`                                                                                    | `users.service.ts`, e2e                              |
| Notifications        | `modules/notifications/`                                                                            | controller, policy, listener, e2e                    |
| AI chat/tools        | `modules/ai-agent/`                                                                                 | `tool.registry.ts`, `module-context.ts`, e2e         |
| Logos                | `modules/logos/`                                                                                    | `packages/logos/src`, tareas de `LogoService`        |
| Finance capabilities | `modules/finance/capabilities/*`                                                                    | `packages/finance/src/*`, `test/finance.e2e-spec.ts` |
| Env                  | `infrastructure/config.md`                                                                          | `env.schema.ts`                                      |
| Health               | `infrastructure/health.md`                                                                          | `health.controller.ts`                               |
| Events/queues        | `infrastructure/events-and-queues.md`                                                               | `event.constants.ts`, `queue.constants.ts`           |
| Envelope             | `infrastructure/errors-and-envelope.md`                                                             | `transform.interceptor.ts`                           |
| Observabilidad       | `infrastructure/observability.md`                                                                   | `apps/api/src/instrument.ts`, `sentry-scrubber.ts`   |
| Module folders       | `architecture/modules.md`                                                                           | barrels + eslint                                     |
| Docs cerrados        | `archive/` (registro de revisión e implementaciones)                                                | histórico; no es fuente de comportamiento vigente    |
| Trabajo abierto      | [Issues con label `roadmap`](https://github.com/jarvinc3/personal-os-back/issues?q=label%3Aroadmap) | sin código todavía                                   |

Inventario de endpoints finance: controllers bajo cada capability (no se duplica aquí la tabla completa de 40+ rutas).
