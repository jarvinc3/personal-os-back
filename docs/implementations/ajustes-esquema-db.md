# Ajustes al esquema de base de datos

Cambios propuestos sobre el esquema actual (Supabase + Prisma). Ya están activos RLS e índices de FK, así que aquí solo va lo que falta.

> Como usas Prisma Migrate (`_prisma_migrations`), crea la migración con `prisma migrate dev --create-only` y pega el SQL en el archivo generado. Los `CHECK`, índices parciales y triggers no se modelan en `schema.prisma`, pero se conservan en el SQL de la migración.

## 1. `fin_institutions`: tipo, orden y logo

```sql
alter table public.fin_institutions
  add column type text not null default 'bank'
    check (type in ('bank','credit_union','digital_wallet','broker','cash','other')),
  add column short_name text,
  add column sort_order integer not null default 0,
  add column domain text
    check (domain is null or domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  add column logo_path text,          -- archivo compartido: brands/{domain}.png
  add column custom_logo_path text;   -- logo subido por el usuario (tiene prioridad)
```

Unicidad por usuario y nombre. Antes de crear el índice, revisa si ya tienes duplicados:

```sql
-- 1) ¿hay duplicados?
select user_id, lower(name), count(*)
from public.fin_institutions
group by 1, 2
having count(*) > 1;

-- 2) crear el índice (si el paso 1 no devuelve filas)
create unique index if not exists fin_institutions_user_name_uq
  on public.fin_institutions (user_id, lower(name));
```



### Sobre `logo_url`

Mantén `logo_url` mientras migras; después de rellenar `logo_path`, puedes eliminarlo:

```sql
-- solo cuando ya no lo uses en el código
alter table public.fin_institutions drop column logo_url;
```



### Backfill de dominios existentes

Ejemplo (verifica cada dominio antes de ejecutar):

```sql
update public.fin_institutions set domain = 'bhd.com.do'       where domain is null and lower(name) like '%bhd%';
update public.fin_institutions set domain = 'banreservas.com'  where domain is null and lower(name) like '%banreservas%';
update public.fin_institutions set domain = 'popularenlinea.com' where domain is null and lower(name) like '%popular%';
```

Luego un script de NestJS recorre las filas con `domain` y `logo_path is null` y llama a `LogoService.ensureLogo(domain)` (ver `logo-dev-integracion.md`).

## 2. `updated_at` automático

Prisma solo actualiza `updated_at` cuando escribe él (`@updatedAt`). Un trigger genérico cubre también el SQL directo:

```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger fin_institutions_set_updated_at
  before update on public.fin_institutions
  for each row execute function public.set_updated_at();
```

Repite el `create trigger` en las tablas que tengan `updated_at` y considerar agregar esta columna a tablas que lo ameriten. 

## 3. Datos sensibles



### `fin_accounts.account_number` (se guarda completo, pero cifrado)

```sql
alter table public.fin_accounts
  add column account_number_last4 text
    check (account_number_last4 is null or char_length(account_number_last4) = 4);
```

- `account_number` pasa a guardar el **texto cifrado** (AES-256-GCM, formato `v1:iv:tag:ciphertext`).
- `account_number_last4` sirve para mostrar y buscar sin descifrar.
- Los endpoints de lista/detalle devuelven solo `last4`. El número completo se entrega en una acción explícita (copiar/compartir datos para depósito).
- Filtra el número completo de logs, `ai_messages`, `tool_calls` y mensajes de error.

Helper de cifrado (Node/NestJS):

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const KEY = Buffer.from(process.env.DATA_ENCRYPTION_KEY!, 'base64'); // 32 bytes

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(':');
  if (v !== 'v1') throw new Error('Unsupported encryption version');
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
```

Migración de datos existentes: un script único que lea cada `account_number` en claro, guarde `last4`, cifre y sobrescriba. Haz respaldo antes y ejecútalo en una transacción por lotes. La versión (`v1`) permite rotar la clave más adelante.

### `fin_email_connections` (tokens de Gmail)

Aplica el mismo helper a `access_token` y `refresh_token`. Son las credenciales más sensibles de la base.

## 4. Registro del módulo de suscripciones

Ver `modulo-suscripciones.md` (tablas `sub_subscriptions`, `sub_payments`, inserción en `modules`).

## 5. Checklist de revisión pendiente

- [ ] Cifrar `fin_email_connections.access_token` / `refresh_token`.
- [ ] Cifrar `fin_accounts.account_number` + `account_number_last4`.
- [ ] Unicidad para idempotencia (verifica que existan):
  - `fin_email_messages (source_id, gmail_message_id)`
  - `processed_domain_events (event_id, consumer)`
  - `domain_event_outbox (event_id)`
  - `ai_messages (session_id, client_message_id)` (donde `client_message_id` no sea nulo)
- [ ] `fin_budgets`: único `(user_id, category_id, period_start)` y `check (period_end >= period_start)`.
- [ ] `fin_exchange_rates`: único `(from_currency, to_currency, rate_date)`.
- [ ] Definir estrategia para valores derivados (`fin_accounts.balance`, `fin_budgets.amount_spent`, `fin_savings_goals.current_amount`): una sola vía de escritura y un job de reconciliación.
- [ ] Timestamps faltantes: `updated_at` en `fin_budgets` y `fin_email_sources`; `created_at` en `ai_actions` y `fin_recurring_patterns`. Añadir `user_id` a `ai_actions` para auditoría.
- [ ] Unificar `bpchar` y `text` en defaults de moneda.
- [ ] Cambiar defaults de `uuid_generate_v4()` a `gen_random_uuid()` en tablas nuevas.
- [ ] Definir `ON DELETE` explícito en FKs importantes (por ejemplo, cuentas → institución).
- [ ] `fin_loans`: usar `institution_id` como fuente principal y `lender_name` como respaldo.
- [ ] Retención de `fin_email_messages.extracted_payload` (cuánto tiempo se conserva).



## 6. Evitado a propósito (por ahora)

- **Tabla** `brands` **compartida:** no hace falta. El "catálogo" es el bucket, con el dominio como llave. Se puede crear después a partir de los `domain` distintos existentes y añadiendo `brand_id`.
- `subscription_id` **en** `fin_transactions`**:** el vínculo va en `sub_payments` para que Finanzas no dependa de Suscripciones.

