import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLoanDto } from './create-loan.dto';
import { UpdateLoanDto } from './update-loan.dto';

function loanPayload(overrides: Record<string, unknown> = {}) {
  return {
    lenderName: 'Banco Popular',
    originalAmount: 1000,
    currentBalance: 800,
    installmentAmount: 100,
    installmentFreq: 'MONTHLY',
    totalInstallments: 10,
    paidInstallments: 2,
    nextDueDate: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function validateLoan(overrides: Record<string, unknown> = {}) {
  return validate(plainToInstance(CreateLoanDto, loanPayload(overrides)));
}

describe('CreateLoanDto', () => {
  it('accepts a consistent loan', async () => {
    expect(await validateLoan()).toEqual([]);
  });

  it('rejects a balance above the original amount', async () => {
    const errors = await validateLoan({
      originalAmount: 1000,
      currentBalance: 5000,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: '_loanConsistency',
          constraints: expect.objectContaining({
            loanBalanceWithinOriginal:
              'currentBalance must not exceed originalAmount',
          }),
        }),
      ]),
    );
  });

  it('rejects paid instalments above the total', async () => {
    const errors = await validateLoan({
      totalInstallments: 2,
      paidInstallments: 5,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: '_loanConsistency',
          constraints: expect.objectContaining({
            loanPaidWithinTotal:
              'paidInstallments must not exceed totalInstallments',
          }),
        }),
      ]),
    );
  });

  it('rejects a non-positive instalment', async () => {
    const errors = await validateLoan({ installmentAmount: 0 });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'installmentAmount' }),
      ]),
    );
  });
});

describe('UpdateLoanDto', () => {
  it('leaves the cross-field rule to the service', async () => {
    const dto = plainToInstance(UpdateLoanDto, { currentBalance: 5000 });

    expect(await validate(dto)).toEqual([]);
  });
});
