# Module settings

La plataforma expone `SettingsDescriptor`, `ModuleSettingsRegistry` y
`ModuleSettingsReader` desde `@personal-os/contracts`. Cada descriptor declara
`slug`, versión, defaults, normalización, aplicación de parches y lectura
genérica de preferencias de notificación. `createSettingsDescriptor` implementa
el merge profundo neutral; el descriptor aporta la validación de sus campos.

Cada módulo es dueño de sus defaults y reglas:

- Finance publica `FINANCE_SETTINGS_DEFAULTS`, `FINANCE_NOTIFICATION_KEYS` y las
  reglas de `reminders.cardDueDaysBefore` y `subscriptions.reminderDaysBefore`
  desde `packages/finance/src/settings/`; su descriptor las valida.
- Intelligence mantiene los defaults del módulo `ai` y valida el umbral de
  revisión de correo.
- Agenda, Projects y Health declaran sus defaults en
  `apps/api/src/module-settings/descriptors/`, su composición dueña.

`ModuleSettingsRegistry` registra descriptores sin interpretar sus campos,
rechaza slugs duplicados y delega normalización y parches en el módulo dueño;
`hasDescriptor(slug)` responde si un módulo está registrado. `ModuleSettingsService` lee el
registro `UserModule` y devuelve la configuración normalizada, responde
`hasDescriptor` y
consulta una preferencia con la semántica del descriptor. `apps/api` compone los
providers en `ModuleSettingsModule.register([...])`.

Users conserva identidad, perfil, preferencias globales y persistencia genérica:
valida el slug contra el registro, aplica el parche del descriptor y persiste el
resultado; no contiene defaults, claves de notificación ni validadores de
módulos. El reset de settings del vaciado pide al registro los defaults
registrados.

Los consumidores consultan el lector, no defaults de otros módulos:

- La policy de Notifications resuelve el módulo habilitado y el toggle con
  `hasDescriptor`, `read` y `notificationEnabled`; no importa defaults ni claves de un
  dominio.
- El guard `EnabledModuleGuard` usa `hasDescriptor` y `read` para decidir si la ruta sigue
  habilitada.
- Intelligence ya lee su propia configuración con el lector.

El formato persistido y el contrato HTTP no cambian. Un módulo de prueba puede
crear y registrar un descriptor propio mediante el contrato genérico, sin
agregar una rama por slug a Users ni editar sus defaults.
