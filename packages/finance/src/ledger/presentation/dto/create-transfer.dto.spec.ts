import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTransferDto } from './create-transfer.dto';

const fromAccountId = '11111111-1111-4111-8111-111111111111';
const toAccountId = '33333333-3333-4333-8333-333333333333';
const cardId = '22222222-2222-4222-8222-222222222222';

function transferDto(overrides: Record<string, unknown>) {
  return plainToInstance(CreateTransferDto, {
    fromAccountId,
    toAccountId,
    amount: 25,
    currency: 'DOP',
    transactionDate: '2026-08-01T12:00:00.000Z',
    ...overrides,
  });
}

describe('CreateTransferDto', () => {
  it('accepts two accounts', async () => {
    expect(await validate(transferDto({}))).toEqual([]);
  });

  it('requires a destination account', async () => {
    const errors = await validate(transferDto({ toAccountId: undefined }));
    expect(errors.map((error) => error.property)).toContain('toAccountId');
  });

  it('requires an account origin', async () => {
    const errors = await validate(transferDto({ fromAccountId: undefined }));
    expect(errors.map((error) => error.property)).toContain('fromAccountId');
  });

  it('keeps card fields only so the controller can answer 400', async () => {
    expect(await validate(transferDto({ toCardId: cardId }))).toEqual([]);
    expect(await validate(transferDto({ fromCardId: cardId }))).toEqual([]);
  });
});
