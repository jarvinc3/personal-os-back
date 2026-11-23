import type { Prisma } from '@personal-os/database';
import type { CursorPoint } from '@personal-os/core';
import type { ResolvedAmounts } from '../../shared/domain/money';
import type { ReconciliationAdjustmentKind } from '../domain/reconciliation-adjustment';

export type ReconciliationTarget = {
  accountId: string | null;
  cardId: string | null;
  cardType: 'CREDIT' | 'DEBIT' | null;
  derivedAccountId: string | null;
  currency: string;
  name: string;
  institutionName: string | null;
  currentBalance: number;
};

export type ResolvedAdjustmentInput = {
  kind: ReconciliationAdjustmentKind;
  amounts: ResolvedAmounts;
};

export type CreateReconciliationInput = {
  target: ReconciliationTarget;
  asOfDate: Date;
  appBalance: number;
  realBalance: number;
  difference: number;
  note: string | null;
  adjustments: ResolvedAdjustmentInput[];
};

export type ReconciliationRow = {
  id: string;
  userId: string;
  accountId: string | null;
  cardId: string | null;
  currency: string;
  asOfDate: Date;
  appBalance: unknown;
  realBalance: unknown;
  difference: unknown;
  note: string | null;
  createdAt: Date;
  adjustments: Array<{
    id: string;
    kind: ReconciliationAdjustmentKind;
    amount: unknown;
    transactionId: string;
  }>;
};

export type ReconciliationProduct = {
  key: string;
  kind: 'account' | 'card';
  accountId: string | null;
  cardId: string | null;
  currency: string;
  name: string;
  institutionName: string | null;
  balance: number;
};

export type ListReconciliationsQuery = {
  accountId?: string;
  cardId?: string;
  cursor: CursorPoint | null;
  take: number;
};

export const ADJUSTMENT_DESCRIPTION = 'Ajuste de conciliación';

export const reconciliationInclude = {
  adjustments: {
    select: { id: true, kind: true, amount: true, transactionId: true },
    orderBy: { id: 'asc' as const },
  },
} satisfies Prisma.FinReconciliationInclude;
