import type { PrismaService } from '@personal-os/database';
import type { AiEmailSourceService } from './ai-email-source.service';
import { RECOVERY_WINDOW_MS } from './gmail-sync.constants';
import type { GmailMessageImporter } from './gmail-sync.importer';
import type { GmailSyncProgressStore } from './gmail-sync.progress';
import { gmailScopeQuery, importFiltersOf } from './gmail-sync.scope';
import type {
  GmailConnectionRecord,
  GmailMessageList,
} from './gmail-sync.types';

type GmailRecoverySyncDependencies = {
  prisma: PrismaService;
  source: AiEmailSourceService;
  progress: GmailSyncProgressStore;
  importer: GmailMessageImporter;
};

/** Vuelve a leer la ventana cuando el cursor de historial no sirve. */
export class GmailRecoverySync {
  private readonly prisma: PrismaService;
  private readonly source: AiEmailSourceService;
  private readonly progress: GmailSyncProgressStore;
  private readonly importer: GmailMessageImporter;

  constructor({
    prisma,
    source,
    progress,
    importer,
  }: GmailRecoverySyncDependencies) {
    this.prisma = prisma;
    this.source = source;
    this.progress = progress;
    this.importer = importer;
  }

  async run(
    connection: GmailConnectionRecord,
    accessToken: string,
  ): Promise<{
    imported: number;
    recovered: true;
    bootstrapComplete: true;
  }> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStartMs =
      connection.lastSyncedAt?.getTime() ?? Date.now() - RECOVERY_WINDOW_MS;
    const importFloorMs = connection.importStartAt?.getTime() ?? 0;
    const startSeconds = Math.floor(
      Math.max(windowStartMs, importFloorMs) / 1000,
    );
    const recoveryRange = {
      from: new Date(startSeconds * 1000).toISOString(),
      to: new Date(nowSeconds * 1000).toISOString(),
    };
    await this.progress.update({
      connectionId: connection.id,
      userId: connection.userId,
      patch: { phase: 'recovery', recoveryRange },
    });
    const profile = await this.source.gmailApiRequest<{ historyId?: string }>(
      accessToken,
      '/users/me/profile',
      (state) =>
        this.progress.update({
          connectionId: connection.id,
          userId: connection.userId,
          patch: { ...state, phase: 'recovery', retryAt: state.retryAt },
        }),
    );
    const query = new URLSearchParams({
      q: gmailScopeQuery({
        afterSeconds: startSeconds,
        beforeSeconds: nowSeconds,
        senderFilter: connection.senderFilter,
      }),
      maxResults: '500',
    });
    let pageToken: string | undefined;
    let imported = 0;
    for (;;) {
      if (pageToken) {
        query.set('pageToken', pageToken);
      }
      const page = await this.source.gmailApiRequest<GmailMessageList>(
        accessToken,
        `/users/me/messages?${query}`,
        (state) =>
          this.progress.update({
            connectionId: connection.id,
            userId: connection.userId,
            patch: {
              ...state,
              status: state.status,
              phase: 'recovery',
              retryAt: state.retryAt,
            },
          }),
      );
      await this.progress.update({
        connectionId: connection.id,
        userId: connection.userId,
        patch: {
          status: 'running',
          phase: 'recovery',
          batchSize: page.messages?.length ?? 0,
          totalEstimate: page.resultSizeEstimate,
        },
      });
      imported += await this.importer.importBatch({
        connectionId: connection.id,
        userId: connection.userId,
        accessToken,
        refs: page.messages ?? [],
        filters: importFiltersOf(connection),
        scopeAppliedInQuery: true,
        onBatchProgress: async (processed, importedCount) => {
          await this.progress.update({
            connectionId: connection.id,
            userId: connection.userId,
            patch: { status: 'running', phase: 'recovery' },
            delta: { processed, imported: importedCount },
          });
        },
      });
      pageToken = page.nextPageToken;
      if (!pageToken) {
        query.delete('pageToken');
        break;
      }
      query.set('pageToken', pageToken);
    }

    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: {
        providerCursor: profile.historyId ?? connection.providerCursor,
        lastRecoverySyncAt: new Date(),
        importedMessageCount: { increment: imported },
      },
    });
    return { imported, recovered: true, bootstrapComplete: true };
  }
}
