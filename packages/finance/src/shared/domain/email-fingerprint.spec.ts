import { emailFingerprint } from './email-fingerprint';

describe('emailFingerprint', () => {
  it('ignores repeated whitespace and case', () => {
    const a = emailFingerprint({
      from: 'Banco  <bank@bhd.com>',
      subject: 'Compra   aprobada',
      body: 'Monto:\n  RD$1,000',
    });
    const b = emailFingerprint({
      from: 'banco <bank@bhd.com>',
      subject: 'compra aprobada',
      body: 'monto: rd$1,000',
    });
    expect(a).toBe(b);
  });

  it('changes when the content changes', () => {
    expect(emailFingerprint({ from: 'a', subject: 'b', body: 'c' })).not.toBe(
      emailFingerprint({ from: 'a', subject: 'b', body: 'd' }),
    );
  });
});
