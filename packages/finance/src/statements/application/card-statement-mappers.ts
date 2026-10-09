import { decimalToString } from '../../shared/domain/mappers';
import type { CardStatementView } from '../domain/card-statement-views';

export function mapCardStatement(view: CardStatementView) {
  return {
    id: view.id,
    currency: view.currency,
    cycleStart: view.cycleStart,
    cycleEnd: view.cycleEnd,
    dueDate: view.dueDate,
    closingBalance: decimalToString(view.closingBalance),
    amountPaid: decimalToString(view.amountPaid),
    remaining: decimalToString(view.remaining),
    status: view.status,
  };
}
