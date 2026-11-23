import type { PrismaService } from '@personal-os/database';
import type { AiEmailSourceService } from './ai-email-source.service';
import { isGmailNotFound } from './gmail-sync.errors';
import type { GmailMessageImporter } from './gmail-sync.importer';
import type { GmailSyncProgressStore } from './gmail-sync.progress';
import type { GmailRecoverySync } from './gmail-sync.recovery';
import { importFiltersOf } from './gmail-sync.scope';
import type {
  GmailConnectionRecord,
  GmailHistoryPage,
} from './gmail-sync.types';

type GmailIncrementalSyncDependencies = {
  prisma: PrismaService;
  source: AiEmailSourceService;
  progress: GmailSyncProgressStore;
  importer: GmailMessageImporter;
  recovery: GmailRecoverySync;
};

/** Lee el historial desde el cursor y recupera cuando Gmail ya no lo tiene. */
export class GmailIncrementalSync {
  private readonly prisma: PrismaService;
  private readonly source: AiEmailSourceService;
  private readonly progress: GmailSyncProgressStore;
  private readonly importer: GmailMessageImporter;
  private readonly recovery: GmailRecoverySync;

  constructor({
    prisma,
    source,
    progress,
    importer,
    recovery,
  }: GmailIncrementalSyncDependencies) {
    this.prisma = prisma;
    this.source = source;
    this.progress = progress;
    this.importer = importer;
    this.recovery = recovery;
  }

  async run(
    connection: GmailConnectionRecord,
    accessToken: string,
  ): Promise<{ imported: number; bootstrapComplete: boolean }> {
    if (!connection.providerCursor) {
      await this.progress.update({
        connectionId: connection.id,
        userId: connection.userId,
        patch: { phase: 'recovery' },
      });
      return this.recovery.run(connection, accessToken);
    }

    const startCursor = connection.providerCursor;
    let pageToken: string | undefined;
    let cursor = startCursor;
    let imported = 0;
    for (;;) {
      const page = await this.fetchHistoryPage({
        connectionId: connection.id,
        userId: connection.userId,
        accessToken,
        cursor: startCursor,
        pageToken,
      });
      if (!page) {
        return this.recovery.run(connection, accessToken);
      }
      cursor = maxHistoryId(cursor, page.historyId);
      const ids = (page.history ?? [])
        .flatMap((entry) => entry.messagesAdded ?? [])
        .flatMap((entry) =>
          entry.message?.id ? [{ id: entry.message.id }] : [],
        );
      imported += await this.importer.importBatch({
        connectionId: connection.id,
        userId: connection.userId,
        accessToken,
        refs: ids,
        filters: importFiltersOf(connection),
        scopeAppliedInQuery: false,
        onBatchProgress: async (processed, importedCount) => {
          await this.progress.update({
            connectionId: connection.id,
            userId: connection.userId,
            patch: { status: 'running', batchSize: ids.length },
            delta: { processed, imported: importedCount },
          });
        },
      });
      pageToken = page.nextPageToken;
      if (!pageToken) {
        break;
      }
    }

    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: {
        providerCursor: cursor,
        importedMessageCount: { increment: imported },
      },
    });
    return { imported, bootstrapComplete: true };
  }

  private async fetchHistoryPage({
    connectionId,
    userId,
    accessToken,
    cursor,
    pageToken,
  }: {
    connectionId: string;
    userId: string;
    accessToken: string;
    cursor: string;
    pageToken?: string;
  }): Promise<GmailHistoryPage | null> {
    const query = new URLSearchParams({
      startHistoryId: cursor,
      historyTypes: 'messageAdded',
      maxResults: '500',
    });
    if (pageToken) {
      query.set('pageToken', pageToken);
    }
    try {
      return await this.source.gmailApiRequest<GmailHistoryPage>(
        accessToken,
        `/users/me/history?${query}`,
        (state) =>
          this.progress.update({
            connectionId,
            userId,
            patch: {
              ...state,
              phase: 'incremental',
              retryAt: state.retryAt,
            },
          }),
      );
    } catch (error) {
      if (isGmailNotFound(error)) {
        return null;
      }
      throw error;
    }
  }
}

function maxHistoryId(current: string, next?: string): string {
  if (!next) {
    return current;
  }
  try {
    return BigInt(next) > BigInt(current) ? next : current;
  } catch {
    return next;
  }
}
