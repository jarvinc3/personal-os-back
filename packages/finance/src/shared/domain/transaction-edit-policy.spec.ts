import {
  findDisallowedEditFields,
  transactionEditBlock,
  transactionEditPolicy,
} from './transaction-edit-policy';

describe('transactionEditPolicy', () => {
  it('labels each status with its editability', () => {
    expect(transactionEditPolicy('PENDING').editable).toBe('FULL');
    expect(transactionEditPolicy('CONFIRMED').editable).toBe('METADATA');
    expect(transactionEditPolicy('REVERSED').editable).toBe('NOTES');
    expect(transactionEditPolicy('CANCELLED').editable).toBe('NOTES');
    expect(transactionEditPolicy('DECLINED').editable).toBe('NOTES');
  });

  it('lists the fields a status rejects', () => {
    expect(
      findDisallowedEditFields('CONFIRMED', { amount: 10, notes: 'nota' }),
    ).toEqual(['amount']);
    expect(
      findDisallowedEditFields('REVERSED', {
        categoryId: 'cat',
        notes: 'nota',
      }),
    ).toEqual([]);
    expect(
      findDisallowedEditFields('CANCELLED', { categoryId: 'cat' }),
    ).toEqual(['categoryId']);
  });

  it('maps a rejected edit to its stable error code', () => {
    expect(transactionEditBlock('CONFIRMED', { amount: 10 })).toEqual({
      code: 'TRANSACTION_LOCKED',
      message: expect.stringContaining('pendiente'),
    });
    expect(transactionEditBlock('REVERSED', { amount: 10 })).toEqual({
      code: 'TRANSACTION_IMMUTABLE',
      message: 'Este movimiento ya no se puede editar.',
    });
    expect(transactionEditBlock('PENDING', { amount: 10 })).toBeNull();
  });
});
