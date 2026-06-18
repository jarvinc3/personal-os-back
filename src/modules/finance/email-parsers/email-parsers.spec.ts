import { BhdEmailParser } from './bhd.parser';
import { loadEmailFixture } from './fixture.util';
import { PopularEmailParser } from './popular.parser';
import { QikEmailParser } from './qik.parser';

describe('BhdEmailParser', () => {
  const parser = new BhdEmailParser();

  it('parses bhd-email.txt fixture', () => {
    const { from, subject, body } = loadEmailFixture('bhd-email.txt');
    expect(parser.canParse(from)).toBe(true);
    const result = parser.parse(subject, body);
    expect(result).not.toBeNull();
    expect(result?.amount).toBe(325);
    expect(result?.merchant).toContain('PedidosYa');
    expect(result?.transactionDate).toBe('2026-05-26');
    expect(result?.type).toBe('DEBIT');
  });
});

describe('PopularEmailParser', () => {
  const parser = new PopularEmailParser();

  it('parses popular-email.txt fixture', () => {
    const { from, subject, body } = loadEmailFixture('popular-email.txt');
    expect(parser.canParse(from)).toBe(true);
    const result = parser.parse(subject, body);
    expect(result).not.toBeNull();
    expect(result?.amount).toBe(500);
    expect(result?.transactionDate).toBe('2026-05-29');
    expect(result?.type).toBe('DEBIT');
  });
});

describe('QikEmailParser', () => {
  const parser = new QikEmailParser();

  it('parses deposit fixture', () => {
    const { from, subject, body } = loadEmailFixture('qik-email.txt');
    expect(parser.canParse(from)).toBe(true);
    const result = parser.parse(subject, body);
    expect(result).not.toBeNull();
    expect(result?.amount).toBe(10000);
    expect(result?.transactionDate).toBe('2026-04-01');
    expect(result?.type).toBe('CREDIT');
    expect(result?.merchant).toContain('BHD');
  });

  it('parses transfer fixture', () => {
    const { subject, body } = loadEmailFixture('qik-email-transfer.txt');
    const result = parser.parse(subject, body);
    expect(result).not.toBeNull();
    expect(result?.amount).toBe(24800);
    expect(result?.transactionDate).toBe('2025-05-26');
    expect(result?.type).toBe('DEBIT');
    expect(result?.merchant).toContain('Ana Deborah');
  });

  it('parses service payment fixture', () => {
    const { from, subject, body } = loadEmailFixture('qik-email-pago.txt');
    expect(parser.canParse(from)).toBe(true);
    const result = parser.parse(subject, body);
    expect(result).not.toBeNull();
    expect(result?.amount).toBe(1744);
    expect(result?.transactionDate).toBe('2025-07-30');
    expect(result?.type).toBe('DEBIT');
    expect(result?.merchant).toContain('Altice');
  });
});
