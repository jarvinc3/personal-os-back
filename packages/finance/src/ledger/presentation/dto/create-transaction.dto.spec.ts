import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto';

describe('CreateTransactionDto', () => {
  const base = {
    accountId: '11111111-1111-4111-8111-111111111111',
    type: 'DEBIT',
    amount: 659,
    currency: 'DOP',
    categoryId: 'cat-food',
    status: 'CONFIRMED',
  };

  it('accepts a visible legacy category id', async () => {
    const dto = plainToInstance(CreateTransactionDto, {
      ...base,
      transactionDate: '2026-09-16T13:02:00.000Z',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });

  it('rejects a wall clock without a zone', async () => {
    const dto = plainToInstance(CreateTransactionDto, {
      ...base,
      transactionDate: '2026-09-16T13:02',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('transactionDate');
  });

  it('accepts an instant expressed with an offset', async () => {
    const dto = plainToInstance(CreateTransactionDto, {
      ...base,
      transactionDate: '2026-09-16T09:02:00-04:00',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });
});
