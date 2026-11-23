import type { Prisma } from '@personal-os/database';
import type { UpdateBudgetDto } from '../presentation/dto/update-budget.dto';

export type BudgetUpdateFields = Prisma.FinBudgetUncheckedUpdateManyInput;

/** Fields of the budget itself that a PATCH may change. */
export function budgetContentFields(dto: UpdateBudgetDto): BudgetUpdateFields {
  const fields: BudgetUpdateFields = {};
  if (dto.name !== undefined) {
    fields.name = dto.name;
  }
  if (dto.amountLimit !== undefined) {
    fields.amountLimit = dto.amountLimit;
  }
  if (dto.alertThresholdPct !== undefined) {
    fields.alertThresholdPct = dto.alertThresholdPct;
  }
  if (dto.includeChildren !== undefined) {
    fields.includeChildren = dto.includeChildren;
  }
  if (dto.rollover) {
    fields.rollover = dto.rollover;
  }
  if (dto.recurring !== undefined) {
    fields.recurring = dto.recurring;
  }
  return fields;
}

/** Period and category fields; the repository replaces the category set. */
export function budgetScheduleFields(dto: UpdateBudgetDto): BudgetUpdateFields {
  const fields: BudgetUpdateFields = {};
  if (dto.categoryIds) {
    fields.categoryId = dto.categoryIds[0];
  }
  if (dto.periodType) {
    fields.periodType = dto.periodType;
  }
  if (dto.periodStart) {
    fields.periodStart = new Date(dto.periodStart);
  }
  if (dto.periodEnd) {
    fields.periodEnd = new Date(dto.periodEnd);
  }
  return fields;
}
