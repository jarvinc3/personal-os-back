import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import { ReconciliationsReadRepository } from './reconciliations-read.repository';
import { ReconciliationsWriteRepository } from './reconciliations-write.repository';
import type {
  CreateReconciliationInput,
  ListReconciliationsQuery,
  ReconciliationProduct,
  ReconciliationRow,
  ReconciliationTarget,
} from './reconciliations-types';

export type {
  CreateReconciliationInput,
  ListReconciliationsQuery,
  ReconciliationProduct,
  ReconciliationRow,
  ReconciliationTarget,
  ResolvedAdjustmentInput,
} from './reconciliations-types';

/**
 * Conciliaciones: las lecturas y las escrituras viven en su pieza y aquí solo
 * se delegan, con el mismo constructor que inyecta el módulo.
 */
@Injectable()
export class ReconciliationsRepository {
  private readonly reads: ReconciliationsReadRepository;
  private readonly writes: ReconciliationsWriteRepository;

  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {
    this.reads = new ReconciliationsReadRepository(prisma);
    this.writes = new ReconciliationsWriteRepository(prisma, journal);
  }

  findTarget(
    userId: string,
    input: { accountId?: string; cardId?: string; currency?: string },
  ): Promise<ReconciliationTarget | null> {
    return this.reads.findTarget(userId, input);
  }

  sumOutgoing(input: {
    userId: string;
    target: ReconciliationTarget;
    from: Date;
    to: Date;
  }): Promise<number> {
    return this.reads.sumOutgoing(input);
  }

  findById(userId: string, id: string): Promise<ReconciliationRow | null> {
    return this.reads.findById(userId, id);
  }

  list(
    userId: string,
    query: ListReconciliationsQuery,
  ): Promise<ReconciliationRow[]> {
    return this.reads.list(userId, query);
  }

  listProducts(userId: string): Promise<ReconciliationProduct[]> {
    return this.reads.listProducts(userId);
  }

  listBetween(
    userId: string,
    from: Date,
    to: Date,
  ): ReturnType<ReconciliationsReadRepository['listBetween']> {
    return this.reads.listBetween(userId, from, to);
  }

  listAdjustmentsBetween(
    userId: string,
    from: Date,
    to: Date,
  ): ReturnType<ReconciliationsReadRepository['listAdjustmentsBetween']> {
    return this.reads.listAdjustmentsBetween(userId, from, to);
  }

  create(
    userId: string,
    input: CreateReconciliationInput,
  ): Promise<ReconciliationRow> {
    return this.writes.create(userId, input);
  }

  delete(
    userId: string,
    id: string,
  ): Promise<{ count: number; notLatest: boolean }> {
    return this.writes.delete(userId, id);
  }

  restore(userId: string, id: string, now: Date) {
    return this.writes.restore(userId, id, now);
  }
}
