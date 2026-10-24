# Personal OS — Auditoría de fronteras de arquitectura

Estado: borrador de auditoría basado en `develop`, previo a la implementación.

## Propósito

Este documento coordina los refactors que cruzan fronteras entre paquetes. No reemplaza el roadmap detallado de IA. Cada dominio mantiene su propio roadmap cuando la auditoría encuentra suficiente trabajo independiente para justificarlo.

## Regla de auditoría

Cada componente se clasifica como:

- **KEEP** — la propiedad y la responsabilidad son correctas.
- **REFACTOR** — el dueño es correcto, pero su API interna/pública necesita limpieza.
- **MOVE** — existe comportamiento útil bajo el dueño equivocado.
- **DELETE** — comportamiento legacy que no debe sobrevivir al baseline limpio.
- **REDESIGN** — la responsabilidad o la frontera misma está mal planteada.

## Hallazgos confirmados

| Área          | Componente                                                                                                                                  | Decisión      | Destino                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------- |
| AI            | Propiedad de Email/Gmail                                                                                                                    | REDESIGN      | AI Intelligence es dueña de fuente/corpus/inteligencia; los dominios consumen señales                      |
| Finance       | Módulos núcleo del dominio (ledger, catalog, planning, analytics, reconciliation, etc.)                                                     | KEEP          | Finance                                                                                                    |
| Finance       | Responsabilidades de Gmail/fuente/clasificación en `ingestion/**`                                                                           | MOVE/DELETE   | AI Email Intelligence                                                                                      |
| Finance       | Comportamiento de ingesta propio de Finance (resolución de instrumentos, reversos, emparejamiento de transferencias, importación al ledger) | MOVE/REFACTOR | Consumidor de señales / servicios de aplicación de Finance                                                 |
| Finance       | `FinanceFacade` como API amplia para IA/externos                                                                                            | REFACTOR      | Contratos/capacidades específicos por consumidor                                                           |
| Finance       | Conceptos de contexto de chat                                                                                                               | MOVE          | Integración de capacidades/contexto de IA                                                                  |
| Notifications | Infraestructura de policy/canales/entrega                                                                                                   | KEEP          | Notifications                                                                                              |
| Notifications | Semántica de Finance y construcción de copy en `NotificationsEventsListener`                                                                | REDESIGN      | Adaptadores de intents de notificación propiedad de cada dominio + entrega genérica en Notifications       |
| Core          | Primitivas de outbox/idempotencia/colas                                                                                                     | KEEP          | Core/infraestructura compartida                                                                            |
| Core          | Catálogo global `AppEvents` y DTOs de eventos de dominio                                                                                    | REFACTOR/MOVE | Semántica de eventos propiedad de los dominios; Core conserva las primitivas de transporte                 |
| Core          | Contratos específicos de chat en `src/ai`                                                                                                   | MOVE/DELETE   | Paquete de IA en la nueva arquitectura                                                                     |
| Users         | Identidad/perfil/preferencias globales                                                                                                      | KEEP          | Users                                                                                                      |
| Users         | Validación/defaults/claves de notificación/métodos de email sync de Finance                                                                 | MOVE/REDESIGN | Contratos de settings propiedad de cada módulo; Users persiste/coordina los settings de módulo del usuario |
| Auth          | Frontera de autenticación con Supabase                                                                                                      | KEEP          | Auth                                                                                                       |
| Config        | Configuración del horario de Gmail                                                                                                          | DELETE/MOVE   | Configuración de sync de fuentes de IA, si el nuevo diseño de cursor aún la necesita                       |

## Evidencia en develop

### Finance

Finance ya está descompuesto en submódulos enfocados en el dominio y no debe reconstruirse completo. La frontera problemática se concentra en la ingesta de email, la integración con chat/IA y el facade amplio.

El subárbol de ingesta actual mezcla programación de Gmail/OAuth/persistencia de fuentes, extracción con LLM, enrutamiento, selección del destino en el ledger, recuperación de reversos, emparejamiento de transferencias y backfill. Estas responsabilidades deben separarse en lugar de moverse en bloque.

### Notifications

`NotificationsEventsListener` hoy define tipos de payload de Finance, interpreta estados de transacciones y piernas de transferencias, construye copy específico de Finance y conoce las claves de settings de notificación de Finance. Esto crecerá hasta convertirse en un switch central de dominios a medida que maduren más módulos de Personal OS.

Notifications debe ser dueño de la persistencia, la entrega, los canales, el estado de lectura y la policy de entrega. La semántica de dominio debe entrar mediante un contrato genérico `NotificationIntent`.

### Core Events

`packages/core/src/events/event.constants.ts` contiene hoy nombres de eventos de User, Finance, Notification y módulos/preferencias, mientras que `domain-events.ts` contiene DTOs de eventos específicos de Finance. Core debe ser dueño de la infraestructura de eventos, no del catálogo semántico de todos los dominios.

La infraestructura existente de outbox/idempotencia es útil y debe conservarse. Los contratos de eventos deben migrar a sus dominios dueños sin dejar de usar la infraestructura de entrega compartida.

### Users / module settings

`UsersService` hoy valida horarios de email sync de Finance y settings de recordatorios de suscripciones/tarjetas de Finance, expone consultas específicas del email sync de Finance y calcula los destinatarios del resumen semanal de Finance. `user-settings-defaults.ts` contiene los defaults detallados de Finance/Agenda/Projects/Health y las claves de notificación de Finance.

Es un problema real de frontera, no solo de nombres. Users debe seguir siendo la autoridad sobre identidad/perfil del usuario y puede persistir la activación/configuración de módulos por usuario, pero cada módulo debe ser dueño del schema, los defaults y la validación de su configuración, y de su vocabulario de preferencias de notificación.

## Invariantes de arquitectura propuestos por la auditoría

1. AI no debe importar servicios/facades de implementación de Finance.
2. Finance no debe ser dueño de conexiones de Gmail ni del corpus de email crudo/canónico.
3. Finance no debe contener conceptos específicos de chat.
4. Notifications no debe interpretar directamente eventos de negocio de Finance/Agenda/Projects/Health en un switch central que crece.
5. Core no debe ser dueño del catálogo semántico de eventos de todos los dominios.
6. Users no debe codificar validación/defaults de negocio específicos de cada módulo.
7. Los módulos de dominio son dueños de sus contratos de eventos, del schema/defaults de sus settings, de la construcción de sus intents de notificación y de sus adaptadores de capacidades de IA.
8. La infraestructura compartida puede transportar eventos de dominio sin ser dueña de su significado.
9. `AiSignal`, `DomainEvent` y `NotificationIntent` siguen siendo conceptos separados.
10. La comunicación entre módulos usa contratos/adaptadores explícitos y no facades amplios.

## Organización de la documentación

El trabajo detallado se divide por área:

- `ai-intelligence/` — programa existente de IA + Email Intelligence (hoy guardado en `personal-os-ai-redesign-context-pack/`; el renombre puede hacerse con el reset de implementación).
- `finance-boundaries/` — limpieza de fronteras de Finance, no una reescritura de Finance.
- `notifications/` — frontera Notification Intent + motor de entrega.
- `platform-boundaries/` — limpieza de Core Events + Users/module settings, porque son temas transversales de plataforma y no reescrituras de un dominio de producto.
- `00-MASTER-ROADMAP.md` — vista de dependencias/orden entre todos los programas.

## Áreas sin rediseño salvo que aparezca nueva evidencia

- Comportamiento de dominio de ledger/planning/catalog/reconciliation de Finance.
- Frontera de Auth.
- Paquete Database como infraestructura.
- Paquete Logos.
- Carga genérica de config/env.

Pueden requerir cambios mecánicos provocados por el nuevo baseline, pero hoy no justifican programas de arquitectura propios.
