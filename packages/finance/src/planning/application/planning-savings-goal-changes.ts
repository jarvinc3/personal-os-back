import type { Prisma } from '@personal-os/database';
import type { UpdateSavingsGoalDto } from '../presentation/dto/update-savings-goal.dto';

export type SavingsGoalUpdateFields =
  Prisma.FinSavingsGoalUncheckedUpdateManyInput;

/** Fields of a savings goal that a PATCH may change. */
export function savingsGoalUpdateFields(
  dto: UpdateSavingsGoalDto,
): SavingsGoalUpdateFields {
  const fields: SavingsGoalUpdateFields = {};
  if (dto.name) {
    fields.name = dto.name.trim();
  }
  if (dto.description !== undefined) {
    fields.description = dto.description;
  }
  if (dto.targetAmount !== undefined) {
    fields.targetAmount = dto.targetAmount;
  }
  if (dto.currency) {
    fields.currency = dto.currency;
  }
  if (dto.targetDate !== undefined) {
    fields.targetDate = dto.targetDate ? new Date(dto.targetDate) : null;
  }
  if (dto.accountId !== undefined) {
    fields.accountId = dto.accountId;
  }
  if (dto.mode) {
    fields.mode = dto.mode;
  }
  if (dto.spendReducesProgress !== undefined) {
    fields.spendReducesProgress = dto.spendReducesProgress;
  }
  return fields;
}
