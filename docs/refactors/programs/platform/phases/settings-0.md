# PLATFORM-SETTINGS-0 — Contrato y registro de module settings

**Issue:** [back #244](https://github.com/jarvinc3/personal-os-back/issues/244)

**PR:** [back #304](https://github.com/jarvinc3/personal-os-back/pull/304)

## Objetivo

Definir un descriptor de settings por módulo, un registro y una API neutral de lectura/validación/actualización.

## Contrato y gate

El descriptor conceptual incluye `slug`, `version`, `defaults` y `validate(input: unknown)`:

```ts
interface ModuleSettingsProvider<TConfig> {
  slug: string;
  version: number;
  defaults: TConfig;
  validate(input: unknown): TConfig;
}
```

Los tipos y tokens genéricos viven en `@personal-os/contracts`, sin dependencias de ejecución de Nest, Prisma o SDKs; `apps/api` compone los providers. Los módulos sin Nest pueden registrar descriptores estáticos.

Registrar los módulos existentes sin cambiar el formato persistido ni la API vigente. Un módulo de prueba puede declarar defaults y validar settings sin modificar un switch central de Users.

[Índice de fases de plataforma](README.md).
