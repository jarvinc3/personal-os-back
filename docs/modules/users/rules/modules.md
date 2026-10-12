# Users — reglas de módulos

| ID           | Condición                                | Resultado                                                                                                | Evidencia                                                                     |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `BR-USR-001` | No hay fila `UserModule`                 | Tratado como disabled                                                                                    | `UsersService.assertModuleEnabled`, policy notif `module_disabled_or_missing` |
| `BR-USR-002` | Finance `isEnabled=false` o missing      | REST `/api/finance/*` → 403 `Finance module is disabled`; tools finance `success: false`                 | `EnabledModuleGuard`, `ToolExecutorService`                                   |
| `BR-USR-003` | Otros slugs sin `@RequiresEnabledModule` | APIs de dominio no existen aún; toggle solo persiste config                                              | `MODULE_SLUGS`                                                                |
| `BR-USR-004` | `FINANCE_NOTIFICATION_KEYS`              | `budgetAlerts`, `aiSuggestions`, `transactionDetected`, `monthlyReport`, `cardDueDate`, `unusualExpense` | barrel users                                                                  |

> [!WARNING]
> **REV-BACK-006** (`PARCIALMENTE_IMPLEMENTADO`) — docs antiguas implicaban que cada módulo de producto respeta enable; solo finance REST/tools lo enforzan. [review-register.md](../../../review-register.md#rev-back-006)
