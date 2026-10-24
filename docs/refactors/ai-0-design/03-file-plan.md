# Plan de archivos del corte

Estado: `NO_IMPLEMENTADO`; [#193](https://github.com/jarvinc3/personal-os-back/issues/193).
El [manifiesto](artifacts/file-plan.json) captura rutas, operación propuesta,
revisión y hashes. Las rutas nuevas están marcadas como propuestas; no son
archivos ya implementados. Antes de ejecutar se regenera contra los SHA finales.

| Área                   | Operación de AI-0                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Prisma                 | Promover candidata, sustituir historial solo tras gates, conservar SQL complementario                                    |
| Finance ingestion      | Retirar conexión Gmail, OAuth, sync, processors, scheduler y persistencia FinEmail                                       |
| Importación financiera | Conservar resolver institución/instrumento, dedupe, reversos y transferencias con pruebas; adaptar referencias y puertos |
| AI chat                | Retirar sesiones, mensajes, controladores, tools y ensamblado de contexto antiguos                                       |
| Inferencia             | Conservar AiService, proveedores y pruebas; mover al núcleo de inferencia y conectar puerto neutral                      |
| AiAction               | Conservar tabla; ownership directo por userId y CAS por estado; no exponer ejecutor ni endpoints antiguos                |
| Wipe                   | Retirar ai.sessions, finance.emailMessages y finance.emailConnections; rechazar ramas retiradas con 400                  |
| Eventos                | Retirar eventos/copy exclusivos de Gmail; conservar eventos financieros y entrega Resend                                 |
| Settings               | Extraer descriptores preservando ajustes válidos; no añadir consentimiento a defaults centrales de Users                 |
| Web                    | Retirar ruta/provider/launchers de chat y superficie de sync; conservar consultas y tarjetas financieras compartidas     |

`packages/notifications/src/infrastructure/email-sync.processor.ts` entrega
correo por Resend. Su nombre no autoriza borrarlo: se conserva junto a su cola
EMAIL_SYNC y pruebas. Se retiran exclusivamente productores/copy de la antigua
ingesta. WeeklySummary deja de consultar FinEmail; si conserva temporalmente un
campo `pendingEmails` por compatibilidad, devuelve cero documentado.

La web tiene trabajo ajeno sin commit, capturado por hash y estado en el
manifiesto. Este diseño no modifica ni incorpora esos archivos. Los helpers de
entity lookup y las tarjetas de dominio pueden ser reutilizables aunque hoy se
consuman desde chat: no se borran por coincidencia textual.

Hay un gate adicional de contrato: `src/modules/settings/lib/wipe-layers.ts`
todavía representa capas mientras el backend recibe ramas. Antes del corte, la
web debe consumir el catálogo real de ramas y enviar el DTO actual. Eliminar
botones no resuelve esa incompatibilidad.

Para cada grupo del manifiesto se revisan imports, barrels, módulos Nest,
providers, scripts, tests y documentación. La búsqueda textual es un inventario
de consumidores, no una orden automática de borrar cada coincidencia. Los tests
financieros conservados deben compilar y ejecutarse después de retirar FinEmail;
no se permite ocultarlos con skip ni excluir carpetas de Jest.
