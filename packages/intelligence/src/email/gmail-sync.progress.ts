import type { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents } from '@personal-os/core';
import type { PrismaService } from '@personal-os/database';
import type {
  GmailSyncProgress,
  GmailSyncProgressPatch,
} from './gmail-sync.types';

type GmailSyncProgressStoreDependencies = {
  prisma: PrismaService;
  events: EventEmitter2;
};

/** Estado de avance en memoria, con sus escrituras serializadas por conexión. */
export class GmailSyncProgressStore {
  private readonly prisma: PrismaService;
  private readonly events: EventEmitter2;
  private readonly syncProgress = new Map<string, GmailSyncProgress>();
  private readonly syncStateWrites = new Map<string, Promise<void>>();

  constructor({ prisma, events }: GmailSyncProgressStoreDependencies) {
    this.prisma = prisma;
    this.events = events;
  }

  current(connectionId: string): GmailSyncProgress | undefined {
    return this.syncProgress.get(connectionId);
  }

  set(connectionId: string, state: GmailSyncProgress): void {
    this.syncProgress.set(connectionId, state);
  }

  delete(connectionId: string): void {
    this.syncProgress.delete(connectionId);
  }

  async update({
    connectionId,
    userId,
    patch,
    delta,
  }: {
    connectionId: string;
    userId: string;
    patch: GmailSyncProgressPatch;
    delta?: { processed: number; imported: number };
  }): Promise<void> {
    const previousWrite =
      this.syncStateWrites.get(connectionId) ?? Promise.resolve();
    const nextWrite = previousWrite.then(async () => {
      const current = this.syncProgress.get(connectionId) ?? {
        status: 'running' as const,
        phase: 'bootstrap' as const,
        attempt: 0,
        processedThisRun: 0,
        importedThisRun: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const state: GmailSyncProgress = {
        ...current,
        ...patch,
        processedThisRun:
          (patch.processedThisRun ?? current.processedThisRun) +
          (delta?.processed ?? 0),
        importedThisRun:
          (patch.importedThisRun ?? current.importedThisRun) +
          (delta?.imported ?? 0),
        updatedAt: new Date().toISOString(),
      };
      this.syncProgress.set(connectionId, state);
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
        data: { syncState: JSON.parse(JSON.stringify(state)) },
      });
      this.events.emit(AppEvents.AI_EMAIL_SYNC_UPDATED, {
        userId,
        state,
      });
    });
    this.syncStateWrites.set(
      connectionId,
      nextWrite.catch(() => undefined),
    );
    await nextWrite;
  }
}
