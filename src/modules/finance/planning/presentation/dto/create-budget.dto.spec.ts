import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBudgetDto } from './create-budget.dto';

describe('CreateBudgetDto', () => {
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
