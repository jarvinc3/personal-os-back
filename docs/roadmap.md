# Roadmap — personal-os-back

> Hallazgos del [registro de revisión](./review-register.md) que se decidieron **no** implementar en el saneamiento (pendiente 17). Sin código asociado. Se retoman cuando el producto los pida y con presupuesto propio.

| REV          | Qué falta                                                                      | Evidencia                                                         | Cuándo se retoma                                                   |
| ------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| REV-BACK-006 | Generalizar `@RequiresEnabledModule` a módulos que aún no lo usan              | Solo `finance` lo usa; el resto no opta por el guard              | Cuando un módulo que no sea finanzas deba apagarse por preferencia |
| REV-BACK-007 | Adaptador FCM/APNs dedicado (sender real)                                      | Hay `EXPO_ACCESS_TOKEN` y Web Push VAPID; no hay adapter FCM/APNs | Si se reactiva un cliente móvil o se exige push nativo             |
| REV-BACK-008 | Tools de dominio por slug en `MODULE_CONTEXT` (`agenda`, `projects`, `health`) | `MODULE_CONTEXT` solo expone tools de usuario/módulo              | Cuando existan las capabilities de esos módulos                    |

Los hallazgos con dueño en la web (`REV-WEB-009`, `REV-WEB-011`, `REV-WEB-014`) viven en el roadmap de `personal-os-web`.
