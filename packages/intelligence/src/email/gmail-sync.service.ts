import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';
import { AiDataDeletionService } from '../knowledge/ai-data-deletion.service';
import { AiEmailClassificationService } from './ai-email-classification.service';
import { AiEmailSourceService } from './ai-email-source.service';
import { GmailSyncAttemptWriter } from './gmail-sync.attempt-writer';
import { GmailClassificationBacklog } from './gmail-sync.backlog';
import { GmailBootstrapSync } from './gmail-sync.bootstrap';
import { GmailSyncConnectionRegistry } from './gmail-sync.connection-registry';
import { GmailIncrementalSync } from './gmail-sync.incremental';
import { GmailMessageImporter } from './gmail-sync.importer';
import { GmailMessagePersister } from './gmail-sync.persister';
import { GmailSyncProgressStore } from './gmail-sync.progress';
import { GmailRecoverySync } from './gmail-sync.recovery';
import { GmailCorpusReset } from './gmail-sync.reset';
import { GmailSyncRunner } from './gmail-sync.runner';
import { GmailSyncScheduler } from './gmail-sync.scheduler';
import { GmailScopedSync } from './gmail-sync.scoped';
import type {
  ScopedBhdSyncResult,
  ScopedBhdSyncScope,
} from './gmail-sync.types';
import { GmailSyncWatchdog } from './gmail-sync.watchdog';

@Injectable()
export class GmailSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GmailSyncService.name);
  private readonly scheduler: GmailSyncScheduler;
  private readonly scoped: GmailScopedSync;
  private readonly reset: GmailCorpusReset;
  private readonly importer: GmailMessageImporter;
  private readonly activeSyncConnections = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly source: AiEmailSourceService,
    private readonly config: ConfigService<Env, true>,
    private readonly eventEmitter: EventEmitter2,
    private readonly deletion: AiDataDeletionService,
    private readonly classification: AiEmailClassificationService,
  ) {
    const progress = new GmailSyncProgressStore({
      prisma: this.prisma,
      events: this.eventEmitter,
    });
    const registry = new GmailSyncConnectionRegistry(
      this.activeSyncConnections,
    );
    const persister = new GmailMessagePersister({
      prisma: this.prisma,
      config: this.config,
    });
    this.importer = new GmailMessageImporter({
      prisma: this.prisma,
      source: this.source,
      progress,
      persister,
    });
    const bootstrap = new GmailBootstrapSync({
      prisma: this.prisma,
      source: this.source,
      progress,
      importer: this.importer,
    });
    const recovery = new GmailRecoverySync({
      prisma: this.prisma,
      source: this.source,
      progress,
      importer: this.importer,
    });
    const incremental = new GmailIncrementalSync({
      prisma: this.prisma,
      source: this.source,
      progress,
      importer: this.importer,
      recovery,
    });
    const backlog = new GmailClassificationBacklog({
      classification: this.classification,
      config: this.config,
      progress,
      logger: this.logger,
    });
    const attemptWriter = new GmailSyncAttemptWriter({
      prisma: this.prisma,
      progress,
    });
    const runner = new GmailSyncRunner({
      prisma: this.prisma,
      source: this.source,
      config: this.config,
      progress,
      bootstrap,
      incremental,
      backlog,
      attemptWriter,
      logger: this.logger,
    });
    const watchdog = new GmailSyncWatchdog({
      prisma: this.prisma,
      config: this.config,
      progress,
      registry,
      logger: this.logger,
    });
    this.scheduler = new GmailSyncScheduler({
      prisma: this.prisma,
      source: this.source,
      config: this.config,
      progress,
      runner,
      watchdog,
      registry,
      logger: this.logger,
    });
    this.scoped = new GmailScopedSync({
      prisma: this.prisma,
      source: this.source,
      progress,
      importBatch: (input) => this.importMessageBatch(input),
      registry,
    });
    this.reset = new GmailCorpusReset({
      prisma: this.prisma,
      deletion: this.deletion,
      progress,
      registry,
    });
  }

  onModuleInit(): void {
    this.scheduler.start();
  }

  onModuleDestroy(): void {
    this.scheduler.stop();
  }

  async syncForUser(userId: string) {
    return this.scheduler.syncForUser(userId);
  }

  async isSyncingForUser(userId: string) {
    return (await this.scheduler.snapshot(userId)).syncInProgress;
  }

  /**
   * Sync acotada del piloto: solo BHD y con un tope por página. No cambia el
   * cursor del bootstrap ni el estado de la sync normal.
   */
  async syncScopedBhdForUser(
    userId: string,
    scope: ScopedBhdSyncScope,
  ): Promise<ScopedBhdSyncResult> {
    return this.scoped.sync(userId, scope);
  }

  async getProgressForUser(userId: string) {
    return (await this.scheduler.snapshot(userId)).syncProgress;
  }

  async getSyncSnapshotForUser(userId: string) {
    return this.scheduler.snapshot(userId);
  }

  async resetEmailCorpus(userId: string) {
    return this.reset.reset(userId);
  }

  private async importMessageBatch(
    input: Parameters<GmailMessageImporter['importBatch']>[0],
  ): Promise<number> {
    return this.importer.importBatch(input);
  }

  async syncAllActiveConnections(): Promise<void> {
    return this.scheduler.syncAllActiveConnections();
  }

  async markStalledSyncs(): Promise<void> {
    return this.scheduler.markStalledSyncs();
  }

  async syncConnection(connectionId: string) {
    return this.scheduler.syncConnection(connectionId);
  }
}
