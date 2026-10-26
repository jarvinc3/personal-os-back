# Plan de archivos del corte

Estado: corte de código implementado en `refactor/ai-0`; reset y baseline DEV
ejecutados el 2026-10-24;
[#193](https://github.com/jarvinc3/personal-os-back/issues/193). El
[manifiesto](artifacts/file-plan.json) es el inventario base del plan; los
cambios y archivos nuevos ya se aplican en los checkouts back/web.

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

La rama web conserva `docs/handoff/` y `public/images/neo-sekuo-art-style.png`
fuera del commit. Los helpers de entity lookup y tarjetas de dominio se revisan
por uso real; no se borran por coincidencia textual.

El selector web de vaciado refleja las ramas vigentes del backend. Chat/Gmail y
sus ramas retiradas no se pueden enviar desde el cliente.

Para cada grupo del manifiesto se revisan imports, barrels, módulos Nest,
providers, scripts, tests y documentación. La búsqueda textual es un inventario
de consumidores, no una orden automática de borrar cada coincidencia. Los tests
financieros conservados deben compilar y ejecutarse después de retirar FinEmail;
no se permite ocultarlos con skip ni excluir carpetas de Jest.
