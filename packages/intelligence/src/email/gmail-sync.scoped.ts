import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '@personal-os/database';
import type { AiEmailSourceService } from './ai-email-source.service';
import {
  GMAIL_NOT_CONNECTED,
  GMAIL_SYNC_IN_PROGRESS,
  SCOPED_BHD_SENDER,
} from './gmail-sync.constants';
import type { GmailSyncConnectionRegistry } from './gmail-sync.connection-registry';
import type { GmailMessageImporter } from './gmail-sync.importer';
import type { GmailSyncProgressStore } from './gmail-sync.progress';
import { gmailQueryDate, importFiltersOf } from './gmail-sync.scope';
import type {
  GmailMessageList,
  ScopedBhdSyncResult,
  ScopedBhdSyncScope,
} from './gmail-sync.types';
import { narrowerSenderFilter } from './gmail-import-scope';

type ScopedConnection = {
  id: string;
  userId: string;
  isActive: boolean;
  importStartAt: Date | null;
  senderFilter: string | null;
};

type GmailScopedSyncDependencies = {
  prisma: PrismaService;
  source: AiEmailSourceService;
  progress: GmailSyncProgressStore;
  importBatch: GmailMessageImporter['importBatch'];
  registry: GmailSyncConnectionRegistry;
};

/** Sync acotada del piloto: solo BHD y con un tope por página. */
export class GmailScopedSync {
  private readonly prisma: PrismaService;
  private readonly source: AiEmailSourceService;
  private readonly progress: GmailSyncProgressStore;
  private readonly importBatch: GmailMessageImporter['importBatch'];
  private readonly registry: GmailSyncConnectionRegistry;

  constructor({
    prisma,
    source,
    progress,
    importBatch,
    registry,
  }: GmailScopedSyncDependencies) {
    this.prisma = prisma;
    this.source = source;
    this.progress = progress;
    this.importBatch = importBatch;
    this.registry = registry;
  }

  async sync(
    userId: string,
    scope: ScopedBhdSyncScope,
  ): Promise<ScopedBhdSyncResult> {
    if (scope.dateFrom > scope.dateTo) {
      throw new BadRequestException('dateFrom no puede ser posterior a dateTo');
    }
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        isActive: true,
        importStartAt: true,
        senderFilter: true,
      },
    });
    if (!connection?.isActive) {
      throw new ConflictException({
        code: GMAIL_NOT_CONNECTED,
        message: 'No hay una cuenta de Gmail conectada.',
      });
    }
    if (this.registry.isActive(connection.id)) {
      throw new ConflictException({
        code: GMAIL_SYNC_IN_PROGRESS,
        message: 'Ya hay una sincronización en curso. Espera a que termine.',
      });
    }
    this.registry.markActive(connection.id);
    try {
      return await this.runScoped(connection, scope);
    } finally {
      this.registry.endSync(connection.id);
    }
  }

  private async runScoped(
    connection: ScopedConnection,
    scope: ScopedBhdSyncScope,
  ): Promise<ScopedBhdSyncResult> {
    const senderScope = resolveSenderScope(connection);
    const effectiveFrom =
      connection.importStartAt && connection.importStartAt > scope.dateFrom
        ? connection.importStartAt
        : scope.dateFrom;
    const accessToken = await this.source.getAccessToken(connection.id);
    const query = `from:${senderScope} after:${Math.floor(effectiveFrom.getTime() / 1000)} before:${gmailQueryDate(scope.dateTo)}`;
    if (effectiveFrom > scope.dateTo) {
      return {
        connected: true,
        query,
        found: 0,
        imported: 0,
        skipped: 0,
        nextPageToken: null,
        estimatedTotal: 0,
      };
    }
    const page = await this.fetchPage({
      connection,
      scope,
      accessToken,
      query,
    });
    const refs = page.messages ?? [];
    const imported = await this.importBatch({
      connectionId: connection.id,
      userId: connection.userId,
      accessToken,
      refs,
      filters: importFiltersOf(connection),
      scopeAppliedInQuery: !(
        connection.importStartAt || connection.senderFilter
      ),
    });
    return {
      connected: true,
      query,
      found: refs.length,
      imported,
      skipped: refs.length - imported,
      nextPageToken: page.nextPageToken ?? null,
      estimatedTotal: page.resultSizeEstimate ?? null,
    };
  }

  private fetchPage({
    connection,
    scope,
    accessToken,
    query,
  }: {
    connection: ScopedConnection;
    scope: ScopedBhdSyncScope;
    accessToken: string;
    query: string;
  }): Promise<GmailMessageList> {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(scope.maxMessages),
    });
    if (scope.pageToken) {
      params.set('pageToken', scope.pageToken);
    }
    return this.source.gmailApiRequest<GmailMessageList>(
      accessToken,
      `/users/me/messages?${params}`,
      (state) =>
        this.progress.update({
          connectionId: connection.id,
          userId: connection.userId,
          patch: { ...state, retryAt: state.retryAt },
        }),
    );
  }
}

function resolveSenderScope(connection: ScopedConnection): string {
  if (!connection.senderFilter) {
    return SCOPED_BHD_SENDER;
  }
  const senderScope = narrowerSenderFilter({
    first: SCOPED_BHD_SENDER,
    second: connection.senderFilter,
  });
  if (!senderScope) {
    throw new BadRequestException(
      `La conexión importa solo correo de ${connection.senderFilter}; la sync acotada es de BHD.`,
    );
  }
  return senderScope;
}
