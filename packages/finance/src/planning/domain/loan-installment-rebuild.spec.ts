import { rebuildLoanInstallments } from './loan-installment-rebuild';

const utc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day));

describe('rebuildLoanInstallments', () => {
  const loan = {
    originalAmount: 1200,
    installmentAmount: 110,
    installmentFreq: 'MONTHLY' as const,
    interestRate: 0,
    insuranceAmount: 0,
  };
  const installments = [
    { id: 'i1', installmentNo: 1, paidAt: utc(2026, 1, 5) },
    { id: 'i2', installmentNo: 2, paidAt: utc(2026, 2, 5) },
    { id: 'i3', installmentNo: 3, paidAt: null },
  ];

  it('splits the principal across the ordered instalments', () => {
    const rebuilt = rebuildLoanInstallments(loan, installments);

    expect(rebuilt.map((row) => row.principal)).toEqual([110, 110, 980]);
    expect(rebuilt.every((row) => row.interest === 0)).toBe(true);
    expect(rebuilt[2]?.amount).toBe(980);
  });

  it('shows no paid principal on rows the migration left at zero', () => {
    const rebuilt = rebuildLoanInstallments(loan, installments);

    expect(rebuilt.filter((row) => row.paidAt !== null).length).toBe(2);
    expect(
      rebuilt
        .filter((row) => row.paidAt !== null)
        .reduce((sum, row) => sum + row.principal, 0),
    ).toBe(220);
  });

  it('is idempotent: a second run returns the same breakdown', () => {
    const first = rebuildLoanInstallments(loan, installments);
    const second = rebuildLoanInstallments(loan, first);

    expect(second).toEqual(first);
  });

  it('adds the insurance to every instalment', () => {
    const rebuilt = rebuildLoanInstallments(
      { ...loan, insuranceAmount: 5 },
      installments,
    );

    expect(rebuilt.every((row) => row.insurance === 5)).toBe(true);
    expect(rebuilt[0]?.amount).toBe(115);
  });
});
