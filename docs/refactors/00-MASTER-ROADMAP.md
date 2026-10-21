# Personal OS — Roadmap maestro del refactor de arquitectura

## Propósito

Coordinar programas de arquitectura independientes pero relacionados, sin convertir el roadmap de IA en el roadmap de todo Personal OS.

Programas detallados:

- AI Intelligence + Email: `personal-os-ai-redesign-context-pack/07-ROADMAP-AND-TESTABLE-PHASES.md` (fuente de verdad vigente hasta renombrar la carpeta).
- Fronteras de Finance: `finance-boundaries/00-README.md`.
- Notifications: `notifications/00-README.md`.
- Core Events + Module Settings: `platform-boundaries/00-README.md`.
- Auditoría e invariantes transversales: `00-ARCHITECTURE-AUDIT.md`.

## Principio

Cada programa tiene sus propias fases verificables. Este roadmap maestro define el orden y los gates de integración, no duplica el detalle de implementación.

## Mapa de dependencias

```text
BASE / BASELINE LIMPIO
        |
        +------------------------------+
        |                              |
        v                              v
AI-0 reset controlado          PLATFORM-EVENTS-0 contratos
        |                       PLATFORM-SETTINGS-0 registro
        |                              |
        +-----------+------------------+
                    |
          +---------+---------+
          |                   |
          v                   v
 AI-1 Inference Gateway    FIN-0 contratos de frontera
          |                   |
          v                   v
 AI-2 Gmail/corpus         FIN-1 quitar Gmail de Finance
          |
 AI-3 evidencia/revisión
          |
 AI-4 knowledge
          |
 AI-5 email intelligence
          |
 AI-6 evaluación
          |
          v
 AI-7 Signals -----------------------> FIN-3 Signal Consumer
          |                                  |
          |                                  v
          |                           estado/eventos de dominio Finance
          |
          +-----> AI-8 Capabilities <------ FIN-2 adaptadores de IA
          |                |
          |                v
          |          AI-9 Agent Runtime
          |                |
          |          AI-10 Action Policy
          |
          +------------------------------+
                                         |
                              NOTIF-0/1 intents genéricos
                                         |
                              FIN-4 productor de intents de Finance
                                         |
                              NOTIF-2 migración de Finance
                                         |
                              NOTIF-3 desacople de settings
```

El diagrama muestra dependencias, no un calendario estricto de una tarea a la vez. Las fases independientes pueden avanzar en paralelo cuando sus prerrequisitos estén estables.

## Waves de ejecución recomendadas

### Wave A — Baseline de arquitectura

- AI-0 reset controlado;
- FIN-0 contratos de frontera;
- PLATFORM-EVENTS-0 propiedad semántica de eventos;
- PLATFORM-SETTINGS-0 contrato/registro de module settings;
- NOTIF-0 contrato `NotificationIntent`.

**Gate integrado:** las reglas de dependencia son explícitas antes de construir infraestructura nueva. No se introduce acoplamiento legacy nuevo durante el reset.

### Wave B — Propiedad de la infraestructura

Se divide en dos sub-waves con gates propios para reducir el riesgo.

#### Wave B1 — Fuente de email

- AI-1 Inference Gateway;
- AI-2 Gmail/corpus;
- FIN-1 retirar a Finance la propiedad de Gmail (incluye borrar en el mismo paso los eventos de importación por email: `FINANCE_TRANSACTION_IMPORTED`, `FinanceEmailSyncCompletedEvent` y sus listeners/copy/constantes; no quedan huérfanos hasta NOTIF-2).

**Gate B1:** AI posee la fuente de email y Finance compila sin Gmail/OAuth ni eventos de importación por email.

#### Wave B2 — Eventos, settings y delivery

- PLATFORM-EVENTS-1 relay de outbox genérico (`OutboxRelay` en Core detrás del port `DomainEventPublisher`);
- PLATFORM-SETTINGS-1 mover la semántica de configuración a cada módulo;
- NOTIF-1 pipeline genérico de entrega de intents.

**Gate B2 / gate integrado:** AI posee la fuente externa de email, Finance es agnóstico de la fuente, los dominios son dueños de la semántica de sus eventos y settings, y Notifications puede entregar un intent genérico.

### Wave C — Ciclo de inteligencia

- AI-3 Dataset/Runs/Evidencia/Verificación humana;
- AI-4 Knowledge Engine;
- AI-5 Email Intelligence;
- AI-6 Evaluación.

Los demás programas deben mantenerse estables mientras se valida este ciclo.

**Gate integrado:** la inteligencia puede clasificar/evaluar sin mutar Finance.

### Wave D — Integración entre dominios

- AI-7 Signals;
- FIN-3 Finance Signal Consumer;
- FIN-2 adaptadores de IA/contexto de Finance;
- AI-8 Capability Registry.

**Gate integrado:** Email -> Signal -> Finance funciona sin Gmail en Finance, y la IA descubre Finance mediante contratos de capacidades y no mediante un facade.

### Wave E — Agencia y limpieza de notificaciones

- AI-9 Agent Runtime V2;
- AI-10 Action Policy;
- FIN-4 limpieza de propiedad de notificaciones/eventos de Finance;
- NOTIF-2 migrar la semántica de notificaciones de Finance;
- PLATFORM-SETTINGS-2 migración de consumidores;
- NOTIF-3 desacople de settings.

**Gate integrado:** Agent, Finance, Notifications, Core y Users interactúan mediante fronteras explícitas; no queda ningún switch central de dominios en AI/Notifications/Core/Users.

### Wave F — Finance IMPORT / gate de release

Contiene AI-11 (Finance Signal Consumer / IMPORT) junto con FIN-3 como gate de 0.100.0. AI-12 (Proactive Intelligence) queda **después** del release, como `0.101.0`. El roadmap de IA ya ubica Finance IMPORT en la Fase 11 y el despliegue a PROD después de ella. Se mantiene esa condición: `0.100.0` no está listo para PROD hasta que la importación de Finance funcione de punta a punta y pasen todos los tests de integración de fronteras.

Mientras el gate no se cumpla, los hotfixes de PROD siguen la estrategia de `release/0.49.x` descrita en _Estrategia de release y hotfixes durante el reset_.

## Tests de arquitectura obligatorios entre programas

Agregar tests estáticos/de imports o verificaciones equivalentes para estos invariantes:

1. El runtime genérico de IA no puede importar la implementación ni el facade de Finance.
2. Finance no puede importar infraestructura de proveedor/fuente de Gmail.
3. Finance no puede importar contratos de contexto de chat.
4. Tras la migración, Notifications no puede importar payloads de eventos, copy ni constantes de settings de Finance.
5. Tras la migración, Core no puede contener constantes/DTOs de eventos de Finance.
6. Tras la migración, Users no puede importar validadores/defaults de configuración de Finance.
7. Los settings de un módulo nuevo se registran sin modificar los defaults centrales de Users.
8. Los eventos de dominio nuevos se publican sin modificar las constantes de eventos de Core.

## Regla de cierre de fase

Cada fase local sigue requiriendo:

```text
IMPLEMENTACIÓN
      |
TESTS AUTOMATIZADOS
      |
DEMO OBSERVABLE
      |
GATE LOCAL
      |
GATE DE INTEGRACIÓN MAESTRO (cuando aplique)
```

Un refactor no se considera terminado solo porque se movieron archivos.

## Decisiones del owner sobre trabajo en curso

- **web #216 / #217 (settings):** solo web por ahora. No se agregan claves nuevas a `user-settings-defaults.ts` ni métodos a `UsersService`. Cualquier backend de "Vaciar datos" es un endpoint por módulo dentro de cada módulo. PLATFORM-SETTINGS-0 se mantiene en Wave A.
- **back #161 (moneda extranjera):** se hace ahora solo la conversión de ledger/FX (dominio Finance que se conserva). La parte de importación por email no se adapta; FIN-3 debe guardar monto original y tasa.
- **AI-12:** fuera de 0.100.0; release `0.101.0`.

## Estrategia de release y hotfixes durante el reset

Decisión del owner: excepción explícita a la regla "todo en `develop`, sin ramas".

- Al iniciar el reset (AI-0 / Wave A) se crea `release/0.49.x` desde `master`. No se crea antes. El nombre sigue la línea de versión actual del back al momento del corte.
- Las ramas de hotfix son **por repo**: cada repo crea `release/<minor actual>.x` desde su propio `master` (por ejemplo `release/0.49.x` en back y la línea vigente de web, como `release/0.50.x`).
- Esa rama se usa **solo** para hotfixes de PROD mientras `develop` contiene el reset 0.100.0 y no es desplegable.
- Cada hotfix se versiona como `0.49.x` según `docs/versionado.md` y se lleva de vuelta a `develop` (cherry-pick o merge) cuando aplique; si el código afectado fue eliminado o rediseñado por el reset, se deja constancia en el issue de que no aplica.
- No se desarrollan features en `release/0.49.x`.
- La rama se retira cuando 0.100.0 llega a PROD.
- Merges y deploys siguen siendo decisión del owner.

## Relación con los releases

Este roadmap maestro no crea releases de producción independientes por cada fase documentada. El release de reset de arquitectura `0.100.0` sigue siendo el objetivo coordinado de backend y web, salvo que el owner cambie esa decisión.

**Versión del release del refactor:** `0.100.0` es la versión coordinada para **back y web** cuando salga el refactor: ambos repos saltan a `0.100.0` en ese release, sin importar en qué versión estén. Hasta entonces, cada repo sigue con sus números normales de patch/minor (por ejemplo, web ya llegó a `0.50.x` por su cuenta), que no tienen relación con el refactor. Se eligió `0.100.0` en lugar de `0.50.0` para evitar esa confusión. AI-12 sale después, como `0.101.0`. Hasta su salida a PROD, los parches de producción van por `release/0.49.x` (ver sección anterior).
