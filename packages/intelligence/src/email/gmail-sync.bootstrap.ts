import type { PrismaService } from '@personal-os/database';
import type { AiEmailSourceService } from './ai-email-source.service';
import { BOOTSTRAP_START } from './gmail-sync.constants';
import type { GmailMessageImporter } from './gmail-sync.importer';
import type { GmailSyncProgressStore } from './gmail-sync.progress';
import { gmailScopeQuery, importFiltersOf } from './gmail-sync.scope';
import type {
  GmailConnectionRecord,
  GmailMessageList,
} from './gmail-sync.types';

type GmailBootstrapSyncDependencies = {
  prisma: PrismaService;
  source: AiEmailSourceService;
  progress: GmailSyncProgressStore;
  importer: GmailMessageImporter;
};

/** Primera carga de la conexión, página por página. */
export class GmailBootstrapSync {
  private readonly prisma: PrismaService;
  private readonly source: AiEmailSourceService;
  private readonly progress: GmailSyncProgressStore;
  private readonly importer: GmailMessageImporter;

  constructor({
    prisma,
    source,
    progress,
    importer,
  }: GmailBootstrapSyncDependencies) {
    this.prisma = prisma;
    this.source = source;
    this.progress = progress;
    this.importer = importer;
  }

  async run(
    connection: GmailConnectionRecord,
    accessToken: string,
  ): Promise<{ imported: number; bootstrapComplete: boolean }> {
    const query = new URLSearchParams({
      q: gmailScopeQuery({
        afterSeconds: connection.importStartAt
          ? Math.floor(connection.importStartAt.getTime() / 1000)
          : BOOTSTRAP_START,
        senderFilter: connection.senderFilter,
      }),
      maxResults: '500',
    });
    if (connection.bootstrapPageToken) {
      query.set('pageToken', connection.bootstrapPageToken);
    }
    const page = await this.source.gmailApiRequest<GmailMessageList>(
      accessToken,
      `/users/me/messages?${query}`,
      (state) =>
        this.progress.update({
          connectionId: connection.id,
          userId: connection.userId,
          patch: { ...state, retryAt: state.retryAt },
        }),
    );
    await this.progress.update({
      connectionId: connection.id,
      userId: connection.userId,
      patch: {
        status: 'running',
        batchSize: page.messages?.length ?? 0,
        totalEstimate: page.resultSizeEstimate,
      },
    });
    const imported = await this.importer.importBatch({
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
          patch: { status: 'running' },
          delta: { processed, imported: importedCount },
        });
      },
    });
    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: {
        bootstrapStartedAt: connection.bootstrapStartedAt ?? new Date(),
        bootstrapPageToken: page.nextPageToken ?? null,
        ...(page.nextPageToken
          ? {}
          : { initialSyncCompletedAt: new Date(), bootstrapPageToken: null }),
        importedMessageCount: { increment: imported },
      },
    });
    return {
      imported,
      bootstrapComplete: !page.nextPageToken,
    };
  }
}
