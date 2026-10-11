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
  it('accepts an account origin with an account or card destination', async () => {
    expect(await validate(transferDto({}))).toEqual([]);
    expect(
      await validate(transferDto({ toAccountId: undefined, toCardId: cardId })),
    ).toEqual([]);
  });

  it('rejects a card origin', async () => {
    const errors = await validate(
      transferDto({ fromAccountId: undefined, fromCardId: cardId }),
    );

    expect(errors.map((error) => error.property)).toContain('fromAccountId');
  });

  it('rejects a destination with both or neither target', async () => {
    const both = await validate(transferDto({ toCardId: cardId }));
    const neither = await validate(transferDto({ toAccountId: undefined }));

    expect(both.map((error) => error.property)).toContain('_destinationXor');
    expect(neither.map((error) => error.property)).toContain('_destinationXor');
  });
});
