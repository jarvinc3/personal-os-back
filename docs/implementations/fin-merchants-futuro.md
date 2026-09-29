# `fin_merchants` — Comercios en transacciones (futuro)

> Estado: **no implementar todavía.** `fin_transactions.merchant` (texto libre) es suficiente por ahora. Este documento queda como diseño de referencia para cuando surja alguno de los disparadores de la sección 1.

## 1. Cuándo sí construirla

Créala cuando necesites alguna de estas cosas, no antes:

1. **Logos en el feed de transacciones** (icono de Uber, Netflix, Claro junto a cada movimiento). El volumen de renderizado (cientos de filas) justifica resolver el logo una vez y no al vuelo.
2. **Reportes por comercio** ("cuánto gasté en Amazon este año"). Hoy `GROUP BY merchant` da entradas duplicadas por cada variante de texto (`AMAZON.COM`, `Amazon Mktp`, `AMZN Mktp US*2A3B4`, etc.).
3. **Reutilizar el matching de Suscripciones** (normalizar texto, resolver dominio) y aplicarlo también a transacciones sueltas.

## 2. Por qué no antes

- El volumen y la variabilidad del texto son mucho mayores que en instituciones o suscripciones (pocas decenas, elegidas de un buscador) vs. comercios (cientos/miles, texto crudo de banco o correo).
- `merchant` ya cumple su función actual: mostrarse en la lista de transacciones.
- Ya existe un lugar natural y más acotado para resolver esto primero: `fin_recurring_patterns.merchant` y `sub_subscriptions.merchant_match` (módulo de Suscripciones). Conviene madurar ahí el matching antes de generalizarlo a todas las transacciones.

## 3. Diseño propuesto

**Por usuario**, a diferencia de `brands` (que es compartida): lo que cada quien considera "Amazon" puede variar, y evita mezclar la categorización de un usuario con la de otro.

```sql
create table public.fin_merchants (
  id             text primary key default gen_random_uuid()::text,
  user_id        text not null references public.users(id) on delete cascade,
  display_name   text not null,               -- nombre limpio para mostrar
  domain         text
                 check (domain is null or domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  logo_path      text,                         -- brands/{domain}.png (mismo patrón que instituciones/suscripciones)
  custom_logo_path text,
  match_patterns text[] not null default '{}', -- variantes de texto crudo que mapean aquí
  category_id    text references public.fin_categories(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.fin_transactions
  add column merchant_id text references public.fin_merchants(id) on delete set null;
-- 'merchant' se conserva sin cambios: texto crudo original (auditoría / fallback)

create index fin_merchants_user_id_idx on public.fin_merchants (user_id);
create index fin_merchants_match_patterns_gin
  on public.fin_merchants using gin (match_patterns);
create index fin_transactions_merchant_id_idx on public.fin_transactions (merchant_id);

alter table public.fin_merchants enable row level security;

create trigger fin_merchants_set_updated_at
  before update on public.fin_merchants
  for each row execute function public.set_updated_at(); -- ver ajustes-esquema-db.md
```

Notas:
- `merchant` en `fin_transactions` **no se elimina**: sigue siendo el texto crudo tal como llegó del banco o correo. `merchant_id` es la resolución opcional a un comercio normalizado.
- El logo reutiliza el mismo `LogoService` (`domain` → `brands/{domain}.png`) descrito en `logo-dev-integracion.md`. No hace falta lógica nueva de storage.
- `match_patterns` es un arreglo porque un mismo comercio suele tener varias formas de aparecer en el texto crudo.

## 4. Población gradual (no backfill masivo)

Migrar todo el histórico de golpe con fuzzy matching suele generar más ruido que valor. En su lugar:

1. Cuando el agente de IA procesa una transacción nueva, normaliza el texto de `merchant` y lo compara contra `match_patterns` de los comercios existentes del usuario.
2. Si hay coincidencia → asigna `merchant_id`.
3. Si no hay coincidencia → sugiere crear un `fin_merchant` nuevo (nombre limpio + dominio, si se puede inferir) para que el usuario confirme, o lo deja sin asignar.
4. Al confirmar, el patrón de texto usado se agrega a `match_patterns` para que la próxima vez sea automático.
5. El histórico existente se resuelve poco a poco, a medida que el usuario navega sus transacciones o corre un job en segundo plano de baja prioridad — nunca como migración bloqueante.

## 5. Relación con el módulo de Suscripciones

`sub_subscriptions.merchant_match` (ver `modulo-suscripciones.md`) es, en la práctica, una primera versión acotada de esta misma idea, limitada a comercios recurrentes. Cuando llegue el momento de construir `fin_merchants`:

- Reutiliza la función de normalización de texto que se construya para Suscripciones.
- Evalúa si conviene que `sub_subscriptions` referencie `fin_merchant_id` en vez de mantener su propio `merchant_match` por separado, para no duplicar la lógica de matching en dos lugares.

## 6. Prioridad sugerida

Terminar primero el módulo de Suscripciones (`modulo-suscripciones.md`). El `merchant_match` ahí construido sirve como banco de pruebas, con un alcance más pequeño y de mayor valor inmediato, antes de generalizar el matching a todas las transacciones con `fin_merchants`.
