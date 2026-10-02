# `fin_merchants` — Comercios en transacciones

## 1. Cuándo construirla

Se crea porque se necesitan estas cosas:

1. **Logos en el feed de transacciones** (icono de Uber, Netflix, Claro junto a cada movimiento). El volumen de renderizado (cientos de filas) justifica resolver el logo una vez y no al vuelo.
2. **Reportes por comercio** ("cuánto gasté en Amazon este año/mes"). Hoy `GROUP BY merchant` da entradas duplicadas por cada variante de texto (`AMAZON.COM`, `Amazon Mktp`, `AMZN Mktp US*2A3B4`, etc.).

## 2. Diseño propuesto

**Por usuario**: lo que cada quien considera "Uber" puede variar, y evita mezclar la categorización de un usuario con la de otro.

```sql
create table public.fin_merchants (
  id             text primary key default gen_random_uuid()::text,
  user_id        text not null references public.users(id) on delete cascade,
  display_name   text not null,               -- nombre limpio para mostrar
  domain         text
                 check (domain is null or domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  logo_path      text,                         -- mismo patrón que instituciones
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

- `merchant` en `fin_transactions` **no se elimina**: sigue siendo el texto crudo tal como llegó del banco o correo. `merchant_id` es la resolución a un comercio normalizado.
- El logo reutiliza el mismo `LogoService` (`domain` → `brands/{domain}.png`) descrito en `logo-dev-integracion.md`. No hace falta lógica nueva de storage.
- `match_patterns` es un arreglo porque un mismo comercio suele tener varias formas de aparecer en el texto crudo.



## 3. Población gradual (no backfill masivo)

Migrar todo el histórico de golpe con fuzzy matching suele generar más ruido que valor. En su lugar:

1. Cuando el agente de IA procesa una transacción nueva, normaliza el texto de `merchant` y lo compara contra `match_patterns` de los comercios existentes del usuario.
2. Si hay coincidencia → asigna `merchant_id`.
3. Si no hay coincidencia → sugiere crear un `fin_merchant` nuevo (nombre limpio + dominio, si se puede inferir) para que el usuario confirme, o lo deja sin asignar.
4. Al confirmar, el patrón de texto usado se agrega a `match_patterns` para que la próxima vez sea automático.
5. El histórico existente se resuelve solo ya que el usuario borrara manualmente los datos de prueba que hay actualmente.

