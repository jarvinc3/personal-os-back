import {
  accountHintFromTerminatedIn,
  classifyMovementFromText,
  looksLikePayrollWithoutAmount,
  sanitizeAccountNumberHint,
} from './email-movement';

describe('email-movement', () => {
  const payrollSubject = 'Notificación Depósito de Nómina';
  const payrollBody =
    'COLLADO TERRERO JA cédula XXX-XXXX-3695 ha sido acreditado el pago de su nómina en su cuenta terminada en 3447. Descarga la App Popular.';

  it('detects payroll without an amount and does not treat the cédula as money', () => {
    expect(looksLikePayrollWithoutAmount(payrollSubject, payrollBody)).toBe(
      true,
    );
  });

  it('reads the account suffix from "terminada en" and ignores the cédula', () => {
    expect(accountHintFromTerminatedIn(payrollBody)).toBe('3447');
    expect(sanitizeAccountNumberHint(payrollBody, '3695')).toBeNull();
    expect(sanitizeAccountNumberHint(payrollBody, '3447')).toBe('3447');
  });

  it('classifies ATM withdrawals and bank transfers from saved extract text', () => {
    expect(
      classifyMovementFromText({
        description: 'Retiro en cajero automático',
        type: 'DEBIT',
      }),
    ).toBe('ATM_WITHDRAWAL');
    expect(
      classifyMovementFromText({
        description: 'Recibiste una transferencia desde BHD',
        type: 'CREDIT',
      }),
    ).toBe('TRANSFER_IN');
    expect(
      classifyMovementFromText({
        description: 'Enviaste una transferencia a Qik',
        type: 'DEBIT',
      }),
    ).toBe('TRANSFER_OUT');
  });

  it('keeps an explicit movement class from the extractor', () => {
    expect(
      classifyMovementFromText({
        description: 'Compra',
        type: 'DEBIT',
        movementClass: 'FEE',
      }),
    ).toBe('FEE');
  });
});
