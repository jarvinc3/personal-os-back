import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBudgetDto } from './create-budget.dto';

function budgetPayload(overrides: Record<string, unknown> = {}) {
  return {
    categoryId: 'system-alimentacion',
    periodType: 'MONTHLY',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    amountLimit: 1500,
    alertThresholdPct: 80,
    ...overrides,
  };
}

describe('CreateBudgetDto', () => {
  it('accepts system category ids that are not UUIDs', async () => {
    const dto = plainToInstance(CreateBudgetDto, budgetPayload());

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects alert thresholds above 100 percent', async () => {
    const dto = plainToInstance(CreateBudgetDto, {
      categoryId: 'cat-1',
      periodType: 'MONTHLY',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      amountLimit: 1290,
      alertThresholdPct: 1200,
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'alertThresholdPct',
          constraints: expect.objectContaining({ max: expect.any(String) }),
        }),
      ]),
    );
  });
});
