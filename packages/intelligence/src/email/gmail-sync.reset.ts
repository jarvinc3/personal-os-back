import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '@personal-os/database';
import type { AiDataDeletionService } from '../knowledge/ai-data-deletion.service';
import {
  GMAIL_NOT_CONNECTED,
  GMAIL_SYNC_IN_PROGRESS,
} from './gmail-sync.constants';
import type { GmailSyncConnectionRegistry } from './gmail-sync.connection-registry';
import type { GmailSyncProgressStore } from './gmail-sync.progress';
import type { GmailSyncProgress } from './gmail-sync.types';

type GmailCorpusResetDependencies = {
  prisma: PrismaService;
  deletion: AiDataDeletionService;
  progress: GmailSyncProgressStore;
  registry: GmailSyncConnectionRegistry;
};

/** Reinicia el corpus de correo de la conexión, sin corridas activas. */
export class GmailCorpusReset {
  private readonly prisma: PrismaService;
  private readonly deletion: AiDataDeletionService;
  private readonly progress: GmailSyncProgressStore;
  private readonly registry: GmailSyncConnectionRegistry;

  constructor({
    prisma,
    deletion,
    progress,
    registry,
  }: GmailCorpusResetDependencies) {
    this.prisma = prisma;
    this.deletion = deletion;
    this.progress = progress;
    this.registry = registry;
  }

  async reset(
    userId: string,
  ): Promise<{ connected: true; deletedMessages: number }> {
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { userId },
      select: { id: true, syncState: true },
    });
    if (!connection) {
      throw new ConflictException({
        code: GMAIL_NOT_CONNECTED,
        message:
          'No hay una cuenta de Gmail conectada; no hay corpus que reiniciar.',
      });
    }
    if (this.registry.isActive(connection.id)) {
      throw new ConflictException({
        code: GMAIL_SYNC_IN_PROGRESS,
        message:
          'Espera a que termine la sincronización antes de reiniciar el correo.',
      });
    }
    const existingState = connection.syncState as GmailSyncProgress | null;
    if (
      existingState &&
      ['running', 'waiting', 'retrying'].includes(existingState.status)
    ) {
      throw new ConflictException({
        code: GMAIL_SYNC_IN_PROGRESS,
        message:
          'La sincronización sigue activa. Actualiza el estado e inténtalo de nuevo.',
      });
    }
    this.registry.beginReset(connection.id);
    this.registry.clearRetry(connection.id);
    try {
      const { deletedMessages } = await this.deletion.removeEmailData({
        userId,
      });
      this.progress.delete(connection.id);
      return { connected: true, deletedMessages };
    } finally {
      this.registry.endReset(connection.id);
    }
  }
}
