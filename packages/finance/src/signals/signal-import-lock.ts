import type { Prisma } from '@personal-os/database';

/**
 * Clave del bloqueo por usuario que comparten la resolución humana, el descarte
 * y el reintento automático de reversos. Un import descartado no puede recibir
 * después un movimiento de una corrida que ya estaba en curso.
 */
export const SIGNAL_IMPORT_LOCK_KEY = 'signal_import';

/**
 * El consumidor escribe con su propio cliente y puede pedir una tasa FX al
 * importar moneda distinta (hasta 10 s). La transacción que toma el bloqueo
 * debe sobrevivir a esa escritura.
 */
export const SIGNAL_IMPORT_TRANSACTION_TIMEOUT_MS = 30_000;
export const SIGNAL_IMPORT_TRANSACTION_MAX_WAIT_MS = 10_000;

export async function lockSignalImports({
  tx,
  userId,
}: {
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${SIGNAL_IMPORT_LOCK_KEY}:${userId}`}))`;
}
