import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTransactionDto } from './create-transaction.dto';

describe('CreateTransactionDto', () => {
  it('accepts a visible legacy category id', async () => {
    const dto = plainToInstance(CreateTransactionDto, {
      accountId: '11111111-1111-4111-8111-111111111111',
      type: 'DEBIT',
      amount: 659,
      currency: 'DOP',
      transactionDate: '2026-09-16',
      categoryId: 'cat-food',
      status: 'CONFIRMED',
    });

    const errors = await validate(dto);

    expect(errors).toEqual([]);
  });
});
