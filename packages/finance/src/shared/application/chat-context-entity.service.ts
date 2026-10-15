import { Injectable } from '@nestjs/common';
import type { ChatContextEntity, EntityRef } from '@personal-os/core';
import { PrismaService } from '@personal-os/database';

function asDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : 'sin fecha';
}

@Injectable()
export class ChatContextEntityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    switch (ref.type) {
      case 'transaction':
      case 'transfer':
        return this.resolveTransaction(userId, ref);
      case 'account':
        return this.resolveAccount(userId, ref);
      case 'card':
        return this.resolveCard(userId, ref);
      case 'card_statement':
        return this.resolveCardStatement(userId, ref);
      case 'loan':
        return this.resolveLoan(userId, ref);
      case 'loan_installment':
        return this.resolveLoanInstallment(userId, ref);
      case 'receivable':
        return this.resolveReceivable(userId, ref);
      case 'savings_goal':
        return this.resolveSavingsGoal(userId, ref);
      case 'budget':
        return this.resolveBudget(userId, ref);
      case 'institution':
        return this.resolveInstitution(userId, ref);
      case 'email_message':
        return this.resolveEmailMessage(userId, ref);
    }
  }

  private async resolveTransaction(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finTransaction.findFirst({
      where: { id: ref.id, userId },
      include: {
        account: { select: { name: true } },
        card: { select: { name: true } },
      },
    });
    if (!row) {
      return null;
    }

    const target = row.account?.name ?? row.card?.name ?? 'sin instrumento';
    const name =
      row.description ??
      row.merchant ??
      (ref.type === 'transfer' ? 'Transferencia' : 'Movimiento');
    const summary = `${row.type} ${row.amount.toString()} ${row.currency} · ${row.status} · ${asDate(row.transactionDate)} · ${target}`;

    return { type: ref.type, id: row.id, name, summary };
  }

  private async resolveAccount(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finAccount.findFirst({
      where: { id: ref.id, userId },
      include: { institutionRef: { select: { name: true } } },
    });
    if (!row) {
      return null;
    }

    const institution = row.institutionRef?.name ?? 'efectivo';
    const summary = `${row.type} · saldo ${row.balance.toString()} ${row.currency} · ${institution} · ${row.isActive ? 'activa' : 'archivada'}`;

    return { type: ref.type, id: row.id, name: row.name, summary };
  }

  private async resolveCard(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finCard.findFirst({
      where: { id: ref.id, userId },
      include: {
        balances: true,
        institution: { select: { name: true } },
      },
    });
    if (!row) {
      return null;
    }

    const balances = row.balances
      .map((balance) => `${balance.balance.toString()} ${balance.currency}`)
      .join(', ');
    const summary = `${row.type} · ${row.institution.name} · saldo ${balances || '0'} · ${row.isActive ? 'activa' : 'archivada'}`;

    return { type: ref.type, id: row.id, name: row.name, summary };
  }

  private async resolveCardStatement(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finCardStatement.findFirst({
      where: { id: ref.id, card: { userId } },
      include: { card: { select: { name: true } } },
    });
    if (!row) {
      return null;
    }

    const summary = `saldo al corte ${row.closingBalance.toString()} ${row.currency} · mínimos ${row.minimumPayment?.toString() ?? 'sin dato'} · vence ${asDate(row.dueDate)} · ${row.status} · ciclo ${asDate(row.cycleStart)}–${asDate(row.cycleEnd)}`;

    return {
      type: ref.type,
      id: row.id,
      name: `Corte ${row.card.name}`,
      summary,
    };
  }

  private async resolveLoan(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finLoan.findFirst({
      where: { id: ref.id, userId },
    });
    if (!row) {
      return null;
    }

    const summary = `saldo ${row.currentBalance.toString()} ${row.currency} · cuota ${row.installmentAmount.toString()} · ${row.paidInstallments}/${row.totalInstallments} pagadas · próxima ${asDate(row.nextDueDate)}`;

    return { type: ref.type, id: row.id, name: row.lenderName, summary };
  }

  private async resolveLoanInstallment(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finLoanInstallment.findFirst({
      where: { id: ref.id, loan: { userId } },
      include: { loan: { select: { lenderName: true, currency: true } } },
    });
    if (!row) {
      return null;
    }

    const summary = `${row.amount.toString()} ${row.loan.currency} · vence ${asDate(row.dueDate)} · ${row.status}`;

    return {
      type: ref.type,
      id: row.id,
      name: `Cuota ${row.installmentNo} de ${row.loan.lenderName}`,
      summary,
    };
  }

  private async resolveReceivable(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finReceivable.findFirst({
      where: { id: ref.id, userId },
    });
    if (!row) {
      return null;
    }

    const summary = `cobrado ${row.paidAmount.toString()} de ${row.amount.toString()} ${row.currency} · ${row.status} · vence ${asDate(row.dueDate)}`;

    return { type: ref.type, id: row.id, name: row.debtorName, summary };
  }

  private async resolveSavingsGoal(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finSavingsGoal.findFirst({
      where: { id: ref.id, userId },
    });
    if (!row) {
      return null;
    }

    const summary = `${row.currentAmount.toString()} de ${row.targetAmount.toString()} ${row.currency} · ${row.isCompleted ? 'completada' : 'en curso'}`;

    return { type: ref.type, id: row.id, name: row.name, summary };
  }

  private async resolveBudget(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finBudget.findFirst({
      where: { id: ref.id, userId },
      include: {
        categories: { include: { category: { select: { name: true } } } },
      },
    });
    if (!row) {
      return null;
    }

    const name = row.name ?? row.categories[0]?.category.name ?? 'Presupuesto';
    const summary = `límite ${row.amountLimit.toString()} · gastado ${row.amountSpent.toString()} · ${asDate(row.periodStart)}–${asDate(row.periodEnd)}`;

    return { type: ref.type, id: row.id, name, summary };
  }

  private async resolveInstitution(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finInstitution.findFirst({
      where: { id: ref.id, userId },
    });
    if (!row) {
      return null;
    }

    const summary = `${row.type} · ${row.country} · ${row.isActive ? 'activa' : 'archivada'}`;

    return { type: ref.type, id: row.id, name: row.name, summary };
  }

  private async resolveEmailMessage(
    userId: string,
    ref: EntityRef,
  ): Promise<ChatContextEntity | null> {
    const row = await this.prisma.finEmailMessage.findFirst({
      where: { id: ref.id, source: { userId } },
      include: {
        source: { select: { institution: { select: { name: true } } } },
      },
    });
    if (!row) {
      return null;
    }

    const name = row.source.institution.name;
    const summary = `correo de banco · ${row.outcome}${row.reason ? ` · ${row.reason}` : ''}`;

    return { type: ref.type, id: row.id, name, summary };
  }
}
