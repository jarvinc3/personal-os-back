import { NotFoundException } from '@nestjs/common';
import {
  clampPageLimit,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import { assertRestored } from '../../shared/application/assert-restored';
import { PlanningRepository } from '../infrastructure/planning.repository';
import type { CreateReceivableDto } from '../presentation/dto/create-receivable.dto';
import type { UpdateReceivableDto } from '../presentation/dto/update-receivable.dto';
import { mapReceivable, mapReceivablePayment } from './planning-mappers';

/** Money a user is owed, with its payments and status. */
export class PlanningReceivables {
  constructor(private readonly repo: PlanningRepository) {}

  async listReceivables(userId: string) {
    const rows = await this.repo.listReceivables(userId);
    return rows.map(mapReceivable);
  }

  async listReceivablesPage(userId: string, query: CursorQueryDto) {
    const rows = await this.repo.listReceivablesPage(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.createdAt.toISOString(),
    );
    return { ...page, items: page.items.map(mapReceivable) };
  }

  async getReceivable(userId: string, id: string) {
    const row = await this.repo.findReceivable(userId, id);
    if (!row) {
      throw new NotFoundException('Cobro no encontrado');
    }
    return mapReceivable(row);
  }

  async lookupReceivables(userId: string, ids: readonly string[]) {
    const rows = await this.repo.findReceivablesByIds(userId, ids);
    return new Map(rows.map((row) => [row.id, mapReceivable(row)]));
  }

  async createReceivable(userId: string, dto: CreateReceivableDto) {
    const markedAsPaid = dto.status === 'PAID' && dto.paidAmount === undefined;
    const created = await this.repo.createReceivable(
      userId,
      {
        debtorName: dto.debtorName,
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency ?? 'DOP',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      },
      markedAsPaid ? dto.amount : (dto.paidAmount ?? 0),
      dto.status,
    );
    return mapReceivable(created);
  }

  async updateReceivable(userId: string, id: string, dto: UpdateReceivableDto) {
    await this.assertReceivableOwned(userId, id);
    await this.repo.updateReceivable(
      userId,
      id,
      {
        ...(dto.debtorName ? { debtorName: dto.debtorName } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
        ...(dto.currency ? { currency: dto.currency } : {}),
        ...(dto.dueDate ? { dueDate: new Date(dto.dueDate) } : {}),
      },
      dto.status,
    );
    const saved = await this.repo.findReceivable(userId, id);
    if (!saved) {
      throw new NotFoundException('Cobro no encontrado');
    }
    return mapReceivable(saved);
  }

  async listReceivablePayments(
    userId: string,
    id: string,
    query: CursorQueryDto,
  ) {
    await this.assertReceivableOwned(userId, id);
    const rows = await this.repo.listReceivablePayments(id, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.paidAt.toISOString(),
    );
    return { ...page, items: page.items.map(mapReceivablePayment) };
  }

  async deleteReceivable(userId: string, id: string) {
    const deleted = await this.repo.deleteReceivable(userId, id);
    if (deleted.count === 0) {
      throw new NotFoundException('Cobro no encontrado');
    }
    return { success: true };
  }

  async restoreReceivable(userId: string, id: string, now: Date) {
    const restored = await this.repo.restoreReceivable(userId, id, now);
    assertRestored(restored, 'Receivable not found');
    return { success: true };
  }

  private async assertReceivableOwned(
    userId: string,
    id: string,
  ): Promise<void> {
    const receivable = await this.repo.findReceivable(userId, id);
    if (!receivable) {
      throw new NotFoundException('Cobro no encontrado');
    }
  }
}
