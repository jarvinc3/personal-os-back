# Fronteras de plataforma

## Diagnóstico

Core concentra hoy contratos semánticos de eventos de varios dominios; Finance contiene un relay de outbox genérico. Users concentra defaults y validadores de settings de módulos. Estos límites hacen que agregar eventos o settings de un dominio requiera editar infraestructura compartida.

## Objetivo

Core conserva la infraestructura genérica de transporte de eventos y de module settings. Cada dominio es dueño de sus nombres, payloads, defaults y validación. La composición de providers queda en la aplicación, mediante contratos neutrales.

## Fases

El [índice de fases](phases/README.md) reúne objetivos, issues, PRs relacionados y estados. PLATFORM-SETTINGS-2 depende de PLATFORM-SETTINGS-1.

## Propiedad y garantías

- Cada módulo es dueño de su schema, defaults, validación, versión del payload y semántica de preferencias de notificación. La capa de plataforma registra providers y ofrece merge, validación, actualización y lectura genéricos.
- Users conserva identidad, perfil, preferencias globales, orquestación de borrado y la asociación/activación de módulos mientras esa siga siendo la frontera de persistencia elegida; no absorbe semántica de configuración de otros módulos.
- Los roles son una responsabilidad de autorización/cuenta; el consentimiento para contribuir a Knowledge pertenece semánticamente a Intelligence aunque se persista mediante settings genéricos.
- Los contratos en `@personal-os/contracts` no dependen de Nest, Prisma ni SDKs. `apps/api` compone providers; los módulos sin Nest pueden registrar descriptores estáticos.
- Mover el relay no elimina las garantías de leases, fencing, atomicidad ni recuperación ante fallos.
- No se cambia el formato persistido de settings mientras no sea necesario para el contrato aprobado.
