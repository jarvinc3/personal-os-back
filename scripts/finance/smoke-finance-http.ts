/**
 * Smoke HTTP de endpoints clave de finanzas.
 *
 * Corre contra una API ya levantada con un bearer token de un usuario real.
 * No toca la base de datos: solo hace GET y falla si alguno responde mal.
 *
 *   SMOKE_BASE_URL=http://localhost:3100 \
 *   SMOKE_ACCESS_TOKEN=<jwt> \
 *   pnpm smoke:finance
 */

const DEFAULT_BASE_URL = 'http://localhost:3100';
const DEFAULT_API_PREFIX = 'api';

type SmokeEndpoint = {
  label: string;
  path: string;
};

type SmokeCheck = {
  baseUrl: string;
  apiPrefix: string;
  token: string;
  endpoint: SmokeEndpoint;
};

type SmokeResult = {
  endpoint: SmokeEndpoint;
  status: number | null;
  ok: boolean;
  detail: string;
};

/** GETs sin parámetros obligatorios; cubren las capabilities de finanzas. */
const SMOKE_ENDPOINTS: readonly SmokeEndpoint[] = [
  { label: 'Cuentas', path: '/finance/accounts' },
  { label: 'Tarjetas', path: '/finance/cards' },
  { label: 'Categorías', path: '/finance/categories' },
  { label: 'Instituciones', path: '/finance/institutions' },
  { label: 'Movimientos', path: '/finance/transactions' },
  { label: 'Balance general', path: '/finance/balance-sheet' },
  { label: 'Analytics', path: '/finance/analytics/summary' },
  { label: 'Presupuestos', path: '/finance/budgets' },
  { label: 'Préstamos', path: '/finance/loans' },
  { label: 'Metas de ahorro', path: '/finance/savings-goals' },
  { label: 'Cobros', path: '/finance/receivables' },
  { label: 'Suscripciones', path: '/finance/subscriptions' },
  { label: 'Recurrentes', path: '/finance/recurring' },
  { label: 'Comercios', path: '/finance/merchants' },
  { label: 'Papelera', path: '/finance/recycle-bin' },
  { label: 'Correos', path: '/finance/email-sync/mailboxes' },
];

function emit(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): void {
  process.stderr.write(`${line}\n`);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

async function checkEndpoint({
  baseUrl,
  apiPrefix,
  token,
  endpoint,
}: SmokeCheck): Promise<SmokeResult> {
  const url = `${baseUrl}/${apiPrefix}${endpoint.path}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    });
    return {
      endpoint,
      status: response.status,
      ok: response.ok,
      detail: response.ok ? '' : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      endpoint,
      status: null,
      ok: false,
      detail: error instanceof Error ? error.message : 'network error',
    };
  }
}

async function main(): Promise<void> {
  const baseUrl = trimTrailingSlash(
    process.env.SMOKE_BASE_URL?.trim() || DEFAULT_BASE_URL,
  );
  const apiPrefix = trimSlashes(
    process.env.SMOKE_API_PREFIX?.trim() || DEFAULT_API_PREFIX,
  );
  const token = process.env.SMOKE_ACCESS_TOKEN?.trim();

  if (!token) {
    fail(
      'Falta SMOKE_ACCESS_TOKEN. Consigue un access token de Supabase de un usuario real y expórtalo.',
    );
    process.exit(1);
  }

  emit(`Smoke finance → ${baseUrl}/${apiPrefix}`);

  const checks: SmokeResult[] = [];
  for (const endpoint of SMOKE_ENDPOINTS) {
    checks.push(await checkEndpoint({ baseUrl, apiPrefix, token, endpoint }));
  }

  for (const check of checks) {
    const status = check.status ?? 'ERR';
    const line = `${check.ok ? 'PASS' : 'FAIL'} ${status} ${check.endpoint.path}`;
    emit(
      check.detail
        ? `${line} · ${check.detail}`
        : `${line} · ${check.endpoint.label}`,
    );
  }

  const failures = checks.filter((check) => !check.ok);
  emit(`\n${checks.length - failures.length}/${checks.length} endpoints OK`);
  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
