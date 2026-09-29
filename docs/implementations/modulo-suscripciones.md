# Módulo de Suscripciones (`sub_`)

Módulo independiente dentro de Personal OS, al mismo nivel que Finanzas (`fin_`).

## 1. Principios de diseño

1. **Dependencia en una sola dirección.** Suscripciones puede leer/referenciar Finanzas (`fin_cards`, `fin_accounts`, `fin_transactions`). Finanzas **no** conoce a Suscripciones. Por eso no hay `subscription_id` en `fin_transactions`; el vínculo vive en `sub_payments`.
2. **Comunicación por eventos.** Se usa el outbox existente (`domain_event_outbox`) y la idempotencia de `processed_domain_events` con `consumer = 'subscriptions'`.
3. **Prefijo `sub_`** en todas las tablas y registro del módulo en `modules` / `user_modules`.
4. **Logos por dominio** (ver `logo-dev-integracion.md`): columnas `domain`, `logo_path`, `custom_logo_path`. Sin tabla `brands` por ahora.

## 2. Registro del módulo

```sql
insert into public.modules (slug, key, name, description, sort_order, is_active)
values ('subscriptions', 'subscriptions', 'Suscripciones',
        'Control de servicios recurrentes, cobros y renovaciones', 20, true)
on conflict (slug) do nothing;
```

Ajusta `sort_order` según tus módulos actuales. Cada usuario lo activa vía `user_modules`.

## 3. Esquema de base de datos

```sql
create table public.sub_subscriptions (
  id                text primary key default gen_random_uuid()::text,
  user_id           text not null references public.users(id) on delete cascade,
  name              text not null,

  -- logo (ver logo-dev-integracion.md)
  domain            text check (domain is null or domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  logo_path         text,
  custom_logo_path  text,

  -- cobro
  amount            numeric(14,2) not null check (amount >= 0),
  currency          text not null default 'DOP' check (currency ~ '^[A-Z]{3}$'),
  billing_cycle     text not null
                    check (billing_cycle in ('WEEKLY','MONTHLY','QUARTERLY','SEMIANNUAL','YEARLY')),
  billing_interval  integer not null default 1 check (billing_interval > 0),
  anchor_date       date not null,          -- primer cobro; de aquí se calculan los siguientes
  next_billing_date date not null,
  trial_ends_at     date,

  -- estado
  status            text not null default 'ACTIVE'
                    check (status in ('ACTIVE','PAUSED','CANCELLED')),
  cancelled_at      timestamptz,

  -- recordatorios
  reminder_days_before integer not null default 3 check (reminder_days_before >= 0),
  last_reminded_for    date,                -- evita recordatorios duplicados

  -- vínculo con Finanzas (unidireccional: sub -> fin)
  card_id           text references public.fin_cards(id)    on delete set null,
  account_id        text references public.fin_accounts(id) on delete set null,
  merchant_match    text,                   -- texto para emparejar transacciones

  manage_url        text,                   -- enlace para gestionar/cancelar
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.sub_payments (
  id              text primary key default gen_random_uuid()::text,
  subscription_id text not null references public.sub_subscriptions(id) on delete cascade,
  transaction_id  text references public.fin_transactions(id) on delete set null,
  amount          numeric(14,2) not null check (amount >= 0),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  paid_at         timestamptz not null,
  source          text not null default 'AUTO' check (source in ('AUTO','MANUAL')),
  created_at      timestamptz not null default now()
);

-- índices
create index sub_subscriptions_user_status_idx
  on public.sub_subscriptions (user_id, status);
create index sub_subscriptions_next_billing_idx
  on public.sub_subscriptions (next_billing_date) where status = 'ACTIVE';
create index sub_payments_subscription_idx
  on public.sub_payments (subscription_id, paid_at desc);
create unique index sub_payments_subscription_tx_uq
  on public.sub_payments (subscription_id, transaction_id) where transaction_id is not null;

-- RLS (sin políticas: solo Prisma/backend accede, igual que el resto)
alter table public.sub_subscriptions enable row level security;
alter table public.sub_payments      enable row level security;

-- updated_at (función genérica, ver ajustes-esquema-db.md)
create trigger sub_subscriptions_set_updated_at
  before update on public.sub_subscriptions
  for each row execute function public.set_updated_at();
```

Decisiones:
- **`anchor_date` + `next_billing_date`:** calcular el siguiente cobro desde el ancla evita el desfase de fin de mes (ej.: ancla día 31 → febrero 28 → marzo 31, no 28).
- **`merchant_match`:** texto que aparece en el estado de cuenta o correo (ej. `NETFLIX.COM`), útil para emparejar transacciones.
- **`ON DELETE SET NULL`** hacia `fin_*`: borrar una tarjeta no debe borrar la suscripción.
- Sin categoría propia por ahora. Si la necesitas, añade `sub_categories` en vez de reutilizar `fin_categories` (evita acoplar).

### Modelos Prisma (resumen)

```prisma
model SubSubscription {
  id                 String   @id @default(dbgenerated("(gen_random_uuid())::text"))
  userId             String   @map("user_id")
  name               String
  domain             String?
  logoPath           String?  @map("logo_path")
  customLogoPath     String?  @map("custom_logo_path")
  amount             Decimal  @db.Decimal(14, 2)
  currency           String   @default("DOP")
  billingCycle       String   @map("billing_cycle")
  billingInterval    Int      @default(1) @map("billing_interval")
  anchorDate         DateTime @db.Date @map("anchor_date")
  nextBillingDate    DateTime @db.Date @map("next_billing_date")
  trialEndsAt        DateTime? @db.Date @map("trial_ends_at")
  status             String   @default("ACTIVE")
  cancelledAt        DateTime? @map("cancelled_at")
  reminderDaysBefore Int      @default(3) @map("reminder_days_before")
  lastRemindedFor    DateTime? @db.Date @map("last_reminded_for")
  cardId             String?  @map("card_id")
  accountId          String?  @map("account_id")
  merchantMatch      String?  @map("merchant_match")
  manageUrl          String?  @map("manage_url")
  notes              String?
  createdAt          DateTime @default(now()) @map("created_at")
  updatedAt          DateTime @updatedAt @map("updated_at")

  payments SubPayment[]
  @@map("sub_subscriptions")
}

model SubPayment {
  id             String   @id @default(dbgenerated("(gen_random_uuid())::text"))
  subscriptionId String   @map("subscription_id")
  transactionId  String?  @map("transaction_id")
  amount         Decimal  @db.Decimal(14, 2)
  currency       String
  paidAt         DateTime @map("paid_at")
  source         String   @default("AUTO")
  createdAt      DateTime @default(now()) @map("created_at")

  subscription SubSubscription @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  @@map("sub_payments")
}
```

Adapta los tipos de `userId`, `cardId`, etc. a como ya los tienes definidos en tu `schema.prisma`.

## 4. Eventos entre módulos

| Evento | Emite | Consume | Efecto |
|---|---|---|---|
| `finance.recurring_pattern.detected` | Finanzas | Suscripciones | Ofrece al usuario crear una suscripción a partir del patrón |
| `finance.transaction.created` | Finanzas | Suscripciones | Empareja con una suscripción activa y crea `sub_payments` |
| `subscriptions.renewal_due` | Suscripciones | Notificaciones | Crea la notificación de renovación próxima |
| `subscriptions.subscription.cancelled` | Suscripciones | (opcional) Finanzas | Desactiva el patrón recurrente relacionado |

Reglas:
- El consumidor registra `(event_id, 'subscriptions')` en `processed_domain_events` y usa un índice único para garantizar idempotencia.
- El payload lleva solo IDs y datos mínimos; el consumidor consulta lo demás por un servicio/puerto, no importando clases del módulo Finanzas.

### Emparejar transacción con suscripción

Criterios sugeridos (todos configurables):
1. `merchant` normalizado contiene `merchant_match` o el `name`/`domain` de la suscripción.
2. Monto dentro de ±5 % de `amount` (misma moneda) o convertido con `fin_exchange_rates`.
3. Fecha dentro de ±3 días de `next_billing_date`.
4. Si coincide una sola suscripción, se registra el pago y se avanza `next_billing_date`. Si hay varias o ninguna, se genera una sugerencia para que el usuario confirme. Al confirmar, guarda el texto en `merchant_match` para que la próxima vez sea automático.

## 5. Lógica clave

### Calcular el siguiente cobro (sin desfase de fin de mes)

```ts
import { addWeeks, addMonths, addYears, isAfter, startOfDay } from 'date-fns';

const STEP = {
  WEEKLY:     (d: Date, n: number) => addWeeks(d, n),
  MONTHLY:    (d: Date, n: number) => addMonths(d, n),
  QUARTERLY:  (d: Date, n: number) => addMonths(d, 3 * n),
  SEMIANNUAL: (d: Date, n: number) => addMonths(d, 6 * n),
  YEARLY:     (d: Date, n: number) => addYears(d, n),
} as const;

export function nextBillingDate(
  anchor: Date,
  cycle: keyof typeof STEP,
  interval: number,
  after: Date = new Date(),
): Date {
  const today = startOfDay(after);
  let k = 0;
  let candidate = anchor;
  while (!isAfter(candidate, today) && candidate.getTime() !== today.getTime()) {
    k += 1;
    candidate = STEP[cycle](anchor, k * interval); // siempre desde el ancla
  }
  return candidate;
}
```

Usa la zona horaria del usuario (`users.timezone`) al calcular "hoy".

### Costo mensual equivalente (para totales y gráficos)

```ts
const PER_YEAR = { WEEKLY: 52, MONTHLY: 12, QUARTERLY: 4, SEMIANNUAL: 2, YEARLY: 1 } as const;

export const monthlyCost = (amount: number, cycle: keyof typeof PER_YEAR, interval = 1) =>
  (amount * (PER_YEAR[cycle] / interval)) / 12;
```

Para sumar en varias monedas, convierte con `fin_exchange_rates` a través de un puerto (`ExchangeRatePort`) implementado por el módulo Finanzas, sin importar sus tablas directamente.

### Job diario de recordatorios

1. Buscar suscripciones `ACTIVE` con `next_billing_date - reminder_days_before <= hoy` y `last_reminded_for is distinct from next_billing_date`.
2. Crear registro en `notifications` (`type = 'SUBSCRIPTION_RENEWAL'`) y enviar por los canales del usuario (`users.preferences.notifications`, respetando `quietHours`).
3. Guardar `last_reminded_for = next_billing_date`.

También un job que avance `next_billing_date` de las suscripciones cuyo cobro ya pasó sin transacción emparejada (marcándolas como "cobro no confirmado").

## 6. API (REST)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/subscriptions` | Lista con filtros `status`, `q`, orden por `next_billing_date` |
| `POST` | `/subscriptions` | Crea (incluye `domain` → resolución de logo) |
| `GET` | `/subscriptions/:id` | Detalle + últimos pagos |
| `PATCH` | `/subscriptions/:id` | Edita |
| `POST` | `/subscriptions/:id/pause` · `/resume` · `/cancel` | Cambios de estado |
| `POST` | `/subscriptions/:id/payments` | Registro manual de pago |
| `POST` | `/subscriptions/:id/logo` | Subida de logo propio (multipart) |
| `GET` | `/subscriptions/summary` | Total mensual/anual, próximos cobros |
| `GET` | `/brands/search?q=` | Búsqueda Logo.dev (compartida con Finanzas) |

Todos protegidos con el guard de autenticación y filtrados por `user_id`. Valida que `card_id` / `account_id` pertenezcan al mismo usuario.

## 7. Estructura sugerida en NestJS

```
src/modules/subscriptions/
  subscriptions.module.ts
  subscriptions.controller.ts
  subscriptions.service.ts
  billing/
    next-billing-date.ts
    monthly-cost.ts
  events/
    subscriptions.consumer.ts        # consume eventos de finanzas
    subscriptions.publisher.ts       # escribe en domain_event_outbox
  jobs/
    renewal-reminders.job.ts
  dto/
  ports/
    exchange-rate.port.ts            # implementado por el módulo de finanzas
src/shared/logos/
  logo.service.ts                    # compartido con finanzas
  logos.controller.ts                # /brands/search
```

`shared/logos` no pertenece a ningún módulo: lo usan `fin_institutions` y `sub_subscriptions`.

## 8. UI (Next.js)

- **Lista:** logo (`BrandLogo`), nombre, monto y ciclo, próximo cobro con cuenta regresiva, badge de estado.
- **Resumen superior:** total mensual equivalente, total anual, próximos 7 días.
- **Formulario:** buscador de marca (autocompleta nombre + dominio + logo) y campos de monto, ciclo, primer cobro, tarjeta/cuenta y recordatorio.
- **Sugerencias:** tarjeta "detectamos un cobro recurrente de X, ¿es una suscripción?".

## 9. Fases

1. Migración SQL + registro del módulo + modelos Prisma.
2. CRUD de suscripciones con logo (Logo.dev).
3. Cálculo de próximo cobro, resumen y estados.
4. Job de recordatorios + notificaciones.
5. Eventos: emparejar transacciones y sugerencias desde `fin_recurring_patterns`.
6. Pulido: pruebas de fin de mes, zonas horarias y multimoneda.
