import { createHash } from 'node:crypto';

// Fingerprint of the DEV Supabase project, never a database password or token.
const DEV_PROJECT_SHA256 =
  'ef83b1ec8ea0c5e8fb11856bf22575b6607e8b01aeb1afcea836fe9b7d7e5688';

const DEV_ENV_MARKERS = [
  'INFISICAL_ENV',
  'INFISICAL_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_NAME',
  'APP_ENV',
  'ENVIRONMENT',
  'STAGE',
] as const;

const DEV_VALUES = new Set(['dev', 'development']);

export class SeedGuardError extends Error {}

type DevEnvironment = { databaseUrl: string; supabaseUrl: string };

export function assertDevelopmentEnvironment(): DevEnvironment {
  if (process.env.NODE_ENV !== 'development') {
    throw new SeedGuardError('NODE_ENV debe ser development');
  }
  for (const key of DEV_ENV_MARKERS) {
    const value = process.env[key]?.trim().toLowerCase();
    if (value && !DEV_VALUES.has(value)) {
      throw new SeedGuardError(`${key} no indica DEV`);
    }
  }

  const databaseUrl = process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!databaseUrl || !supabaseUrl) {
    throw new SeedGuardError('Faltan las URL de la base DEV');
  }
  let database: URL;
  let supabase: URL;
  try {
    database = new URL(databaseUrl);
    supabase = new URL(supabaseUrl);
  } catch {
    throw new SeedGuardError('Las URL de DEV no son válidas');
  }
  const projectRef = supabase.hostname.split('.')[0];
  const databaseRef = database.username.split('.').at(-1);
  const fingerprint = createHash('sha256').update(projectRef).digest('hex');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !database.hostname.endsWith('.pooler.supabase.com') ||
    supabase.protocol !== 'https:' ||
    !supabase.hostname.endsWith('.supabase.co') ||
    !databaseRef ||
    databaseRef !== projectRef ||
    fingerprint !== DEV_PROJECT_SHA256
  ) {
    throw new SeedGuardError('La conexión no coincide con Supabase DEV');
  }
  return { databaseUrl, supabaseUrl };
}
