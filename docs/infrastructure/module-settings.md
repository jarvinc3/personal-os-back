# Module settings

La plataforma expone `SettingsDescriptor` y `ModuleSettingsReader` desde
`@personal-os/contracts`. Cada descriptor declara `slug`, versión, defaults,
normalización, aplicación de parches y lectura genérica de preferencias de
notificación. `createSettingsDescriptor` implementa el merge profundo neutral;
el descriptor puede aportar su propia validación.

`ModuleSettingsRegistry` registra descriptores sin interpretar sus campos,
rechaza slugs duplicados y delega normalización y parches en el módulo dueño.
`ModuleSettingsService` lee el registro `UserModule` y devuelve la configuración
normalizada. `apps/api` compone los providers para Finance, Agenda, Projects y
Health.

En PLATFORM-SETTINGS-0 los descriptores existentes son un puente de
compatibilidad: reutilizan los defaults actuales de Users para conservar la
forma y los valores persistidos. Finance publica su descriptor desde el paquete
Finance; los descriptores estáticos de Agenda, Projects y Health viven en
`apps/api/src/module-settings/descriptors/`. La semántica de defaults y
validadores se mueve en PLATFORM-SETTINGS-1. Los consumers y el endpoint actual
siguen con su implementación vigente hasta las fases de migración.

Un módulo de prueba puede crear y registrar un descriptor propio mediante el
contrato genérico, sin agregar una rama por slug a Users ni editar sus defaults.
