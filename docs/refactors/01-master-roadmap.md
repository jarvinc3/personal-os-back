# Personal OS — Roadmap maestro del refactor de arquitectura

## Propósito

Coordinar programas de arquitectura independientes pero relacionados, sin convertir el roadmap de IA en el roadmap de todo Personal OS.

Programas detallados:

- [Intelligence y Email](programs/intelligence/README.md), con el [índice de fases AI-0 a AI-12](programs/intelligence/phases/README.md).
- [Fronteras de Finance](programs/finance/README.md).
- [Notifications](programs/notifications/README.md).
- [Core Events y Module Settings](programs/platform/README.md).
- [Auditoría e invariantes transversales](02-architecture-audit.md).

## Decisiones e inventario actualizados

El [diseño técnico de AI-0](programs/intelligence/phases/ai-0/README.md) reúne la baseline, contratos, archivos, preflight y reconstrucción DEV. Los [artefactos de trabajo](archive/reset/ai-0-artifacts/) están archivados; no son migraciones activas ni acreditan actividad en PROD.

Las [decisiones del 2026-10-24](03-implementation-decisions.md) precisan corte, contratos, evidencia y releases. El [inventario de fase 0](archive/reset/02-PHASE-0-INVENTORY.md) conserva el detalle del corte.

Antes de Wave A se entrega la corrección independiente del outbox: leases recuperables, fencing, efectos PostgreSQL transaccionales, deduplicación del encolado externo y pruebas de caída con PostgreSQL real. Su gate no espera a AI-7.

## Seguimiento de fases en GitHub

Cada fase pendiente tiene un issue propio en `personal-os-back`, enlazado como sub-issue del [programa #193](https://github.com/jarvinc3/personal-os-back/issues/193). AI-0 a AI-11 y los contratos de la oleada A están cerrados; AI-12 sigue abierto y fuera de `0.100.0`. FIN-2 ya cumple su gate mediante AI-8 (#211), y FIN-3 quedó implementada con AI-11 (#214); la vista de evidencia está cubierta por web #383. La prioridad del Project 3 sigue este criterio: **High** cuando la fase es prerrequisito de un gate de otro programa o del release; **Medium** para el resto del trabajo de `0.100.0`; **Low** para lo que sale después del release.

| Fase                                 | Issue                                                           | Wave                 | Estado  | Prioridad |
| ------------------------------------ | --------------------------------------------------------------- | -------------------- | ------- | --------- |
| AI-0 reset controlado                | [#203](https://github.com/jarvinc3/personal-os-back/issues/203) | A                    | Cerrado | High      |
| AI-1 Inference Gateway               | [#204](https://github.com/jarvinc3/personal-os-back/issues/204) | B1                   | Cerrado | High      |
| AI-2 Gmail/corpus                    | [#205](https://github.com/jarvinc3/personal-os-back/issues/205) | B1                   | Cerrado | High      |
| AI-3 evidencia y verificación humana | [#206](https://github.com/jarvinc3/personal-os-back/issues/206) | C                    | Cerrado | Medium    |
| AI-4 knowledge                       | [#207](https://github.com/jarvinc3/personal-os-back/issues/207) | C                    | Cerrado | Medium    |
| AI-5 email intelligence              | [#208](https://github.com/jarvinc3/personal-os-back/issues/208) | C                    | Cerrado | Medium    |
| AI-6 evaluación                      | [#209](https://github.com/jarvinc3/personal-os-back/issues/209) | C                    | Cerrado | Medium    |
| AI-7 Signals                         | [#210](https://github.com/jarvinc3/personal-os-back/issues/210) | D                    | Cerrado | High      |
| AI-8 Capabilities                    | [#211](https://github.com/jarvinc3/personal-os-back/issues/211) | D                    | Cerrado | Medium    |
| AI-9 Agent Runtime                   | [#212](https://github.com/jarvinc3/personal-os-back/issues/212) | E                    | Cerrado | Medium    |
| AI-10 Action Policy                  | [#213](https://github.com/jarvinc3/personal-os-back/issues/213) | E                    | Cerrado | Medium    |
| AI-11 Finance IMPORT                 | [#214](https://github.com/jarvinc3/personal-os-back/issues/214) | F                    | Cerrado | High      |
| AI-12 Proactive Intelligence         | [#215](https://github.com/jarvinc3/personal-os-back/issues/215) | Después de `0.100.0` | Abierto | Low       |

Cada fase enlaza su issue, PR relacionado y estado en el [índice AI-0 a AI-12](programs/intelligence/phases/README.md); consulta los [diseños de AI-0](programs/intelligence/phases/ai-0/README.md) y [AI-1](programs/intelligence/phases/ai-1/README.md).

### Contratos de frontera de la oleada A

Estos issues se abrieron el 2026-10-28 para que el trabajo pendiente de la oleada A quede trazable. No reinician AI-0 a AI-4 ni cambian el orden de las waves.

| Fase                | Issue                                                           | Programa      | Estado  | Prioridad |
| ------------------- | --------------------------------------------------------------- | ------------- | ------- | --------- |
| FIN-0               | [#242](https://github.com/jarvinc3/personal-os-back/issues/242) | Finance       | Cerrado | High      |
| PLATFORM-EVENTS-0   | [#243](https://github.com/jarvinc3/personal-os-back/issues/243) | Plataforma    | Cerrado | High      |
| PLATFORM-SETTINGS-0 | [#244](https://github.com/jarvinc3/personal-os-back/issues/244) | Plataforma    | Cerrado | Medium    |
| NOTIF-0             | [#245](https://github.com/jarvinc3/personal-os-back/issues/245) | Notifications | Cerrado | Medium    |

El gate de la oleada A quedó cerrado: AI-0 y los cuatro contratos de frontera están cerrados. AI-12 (#215) permanece después de `0.100.0`, como `0.101.0`.

### Fases de Finance, Platform y Notifications antes de 0.100.0

La decisión registrada en #308 mantiene las diez fases como requisito del release. FIN-2 y FIN-3 ya están cubiertas por AI-8 y AI-11; no se abren issues duplicados. Las otras ocho fases tienen issues de back. No requieren issues web mientras mantengan los contratos, textos y pantallas existentes.

| Fase                | Issue                                                                                                                                               | Estado             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| FIN-1               | [#317](https://github.com/jarvinc3/personal-os-back/issues/317)                                                                                     | En revisión (#332) |
| FIN-2               | AI-8 [#211](https://github.com/jarvinc3/personal-os-back/issues/211)                                                                                | Cubierto           |
| FIN-3               | AI-11 [#214](https://github.com/jarvinc3/personal-os-back/issues/214); evidencia web [#383](https://github.com/jarvinc3/personal-os-web/issues/383) | Cubierto           |
| FIN-4               | [#318](https://github.com/jarvinc3/personal-os-back/issues/318)                                                                                     | Pendiente          |
| PLATFORM-EVENTS-1   | [#319](https://github.com/jarvinc3/personal-os-back/issues/319)                                                                                     | En revisión (#378) |
| PLATFORM-SETTINGS-1 | [#320](https://github.com/jarvinc3/personal-os-back/issues/320)                                                                                     | En revisión (#381) |
| PLATFORM-SETTINGS-2 | [#321](https://github.com/jarvinc3/personal-os-back/issues/321)                                                                                     | Pendiente          |
| NOTIF-1             | [#322](https://github.com/jarvinc3/personal-os-back/issues/322)                                                                                     | Pendiente          |
| NOTIF-2             | [#323](https://github.com/jarvinc3/personal-os-back/issues/323)                                                                                     | Pendiente          |
| NOTIF-3             | [#324](https://github.com/jarvinc3/personal-os-back/issues/324)                                                                                     | Pendiente          |

Los hallazgos de la QA de AI-4 forman parte de AI-5: #238 y #239 corrigen la proyección y la revocación, y #246 cubre la promoción manual de ADMIN.

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

Mientras el gate no se cumpla, los hotfixes de PROD siguen la estrategia de `release/0.55.x` descrita en _Estrategia de release y hotfixes durante el reset_.

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

- **web #216 / #217 (settings):** solo web por ahora. Las claves nuevas de un módulo se agregan a su descriptor, no a Users, y no se añaden métodos específicos a `UsersService`. Cualquier backend de "Vaciar datos" es un endpoint por módulo dentro de cada módulo. PLATFORM-SETTINGS-0 se mantiene en Wave A.
- **back #161 (moneda extranjera):** se hace ahora solo la conversión de ledger/FX (dominio Finance que se conserva). La parte de importación por email no se adapta; FIN-3 debe guardar monto original y tasa.
- **AI-12:** fuera de 0.100.0; release `0.101.0`.

## Estrategia de release y hotfixes durante el reset

Decisión del owner: excepción explícita a la regla "todo en `develop`, sin ramas".

- Al iniciar el reset (AI-0 / Wave A) se crea `release/0.55.x` desde `master`. No se crea antes. Primero se verifica que master contenga la base estable prevista 0.55.1 y los hotfixes previos aprobados; el master local antiguo no sirve como corte. El nombre sigue la línea estable verificada.
- Las ramas de hotfix son **por repo**: cada repo crea `release/<minor actual>.x` desde su propio `master` (por ejemplo `release/0.55.x` en back y la línea vigente de web, como `release/0.50.x`).
- Esa rama se usa **solo** para hotfixes de PROD mientras `develop` contiene el reset 0.100.0 y no es desplegable.
- Cada hotfix se versiona como `0.55.x` según `docs/versionado.md` y se lleva de vuelta a `develop` (cherry-pick o merge) cuando aplique; si el código afectado fue eliminado o rediseñado por el reset, se deja constancia en el issue de que no aplica.
- No se desarrollan features en `release/0.55.x`.
- La rama se retira cuando 0.100.0 llega a PROD.
- Merges y deploys siguen siendo decisión del owner.

## Relación con los releases

Este roadmap maestro no crea releases de producción independientes por cada fase documentada. El release de reset de arquitectura `0.100.0` sigue siendo el objetivo coordinado de backend y web, salvo que el owner cambie esa decisión.

**Versión del release del refactor:** `0.100.0` es la versión coordinada para **back y web** cuando salga el refactor: ambos repos saltan a `0.100.0` en ese release, sin importar en qué versión estén. Hasta entonces, cada repo sigue con sus números normales de patch/minor (por ejemplo, web ya llegó a `0.50.x` por su cuenta), que no tienen relación con el refactor. Se eligió `0.100.0` en lugar de `0.50.0` para evitar esa confusión. AI-12 sale después, como `0.101.0`. Hasta su salida a PROD, los parches de producción van por `release/0.55.x` (ver sección anterior).
