import type { PrismaService } from '@personal-os/database';
import type { AiEmailSourceService } from './ai-email-source.service';
import { GMAIL_MESSAGE_FETCH_CONCURRENCY } from './gmail-sync.constants';
import { isGmailNotFound } from './gmail-sync.errors';
import type { GmailMessagePersister } from './gmail-sync.persister';
import type { GmailSyncProgressStore } from './gmail-sync.progress';
import { isWithinImportScope, readMessageEnvelope } from './gmail-sync.scope';
import type { GmailMessage, MessageImportFilters } from './gmail-sync.types';

type GmailMessageImporterDependencies = {
  prisma: PrismaService;
  source: AiEmailSourceService;
  progress: GmailSyncProgressStore;
  persister: GmailMessagePersister;
};

/** Importa un lote de correos y descarta los que ya existen. */
export class GmailMessageImporter {
  private readonly prisma: PrismaService;
  private readonly source: AiEmailSourceService;
  private readonly progress: GmailSyncProgressStore;
  private readonly persister: GmailMessagePersister;

  constructor({
    prisma,
    source,
    progress,
    persister,
  }: GmailMessageImporterDependencies) {
    this.prisma = prisma;
    this.source = source;
    this.progress = progress;
    this.persister = persister;
  }

  async importBatch({
    connectionId,
    userId,
    accessToken,
    refs,
    filters,
    scopeAppliedInQuery,
    onBatchProgress,
  }: {
    connectionId: string;
    userId: string;
    accessToken: string;
    refs: Array<{ id: string; threadId?: string }>;
    filters: MessageImportFilters;
    /** El bootstrap y la recuperación ya acotan en la consulta de Gmail. */
    scopeAppliedInQuery: boolean;
    onBatchProgress?: (processed: number, imported: number) => Promise<void>;
  }): Promise<number> {
    // El historial no acepta consulta: sin alcance en la query hay que leer la
    // metadata antes del cuerpo para no descargar correo fuera del alcance.
    const filterBeforeFetch =
      !scopeAppliedInQuery &&
      Boolean(filters.importStartAt || filters.senderFilter);
    let imported = 0;
    let unreportedProcessed = 0;
    let unreportedImported = 0;
    for (
      let offset = 0;
      offset < refs.length;
      offset += GMAIL_MESSAGE_FETCH_CONCURRENCY
    ) {
      const batch = refs.slice(
        offset,
        offset + GMAIL_MESSAGE_FETCH_CONCURRENCY,
      );
      const counts = await Promise.all(
        batch.map(async (ref) => {
          const existing = await this.prisma.aiEmailMessage.findUnique({
            where: {
              connectionId_providerMessageId: {
                connectionId,
                providerMessageId: ref.id,
              },
            },
            select: { id: true },
          });
          if (existing) {
            return 0;
          }
          try {
            if (filterBeforeFetch) {
              const metadata = await this.fetchMessage({
                accessToken,
                connectionId,
                userId,
                messageId: ref.id,
                format: 'metadata',
              });
              if (
                !isWithinImportScope({
                  envelope: readMessageEnvelope(metadata),
                  filters,
                })
              ) {
                return 0;
              }
            }
            const message = await this.fetchMessage({
              accessToken,
              connectionId,
              userId,
              messageId: ref.id,
              format: 'full',
            });
            return this.persister.persist({
              connectionId,
              userId,
              message,
              filters,
            });
          } catch (error) {
            if (isGmailNotFound(error)) {
              return 0;
            }
            throw error;
          }
        }),
      );
      const batchImported = counts.reduce<number>(
        (sum, count) => sum + count,
        0,
      );
      imported += batchImported;
      unreportedProcessed += batch.length;
      unreportedImported += batchImported;
      const isLastBatch = offset + batch.length >= refs.length;
      if (unreportedProcessed >= 30 || isLastBatch) {
        await onBatchProgress?.(unreportedProcessed, unreportedImported);
        unreportedProcessed = 0;
        unreportedImported = 0;
      }
    }
    return imported;
  }

  private async fetchMessage({
    accessToken,
    connectionId,
    userId,
    messageId,
    format,
  }: {
    accessToken: string;
    connectionId: string;
    userId: string;
    messageId: string;
    format: 'metadata' | 'full';
  }): Promise<GmailMessage> {
    return this.source.gmailApiRequest<GmailMessage>(
      accessToken,
      `/users/me/messages/${encodeURIComponent(messageId)}?format=${format}`,
      (state) =>
        this.progress.update({
          connectionId,
          userId,
          patch: { ...state, retryAt: state.retryAt },
        }),
    );
  }
}
