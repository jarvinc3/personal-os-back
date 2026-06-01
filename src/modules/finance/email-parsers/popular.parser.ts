import {
  decodeQuotedPrintable,
  extractKeyValuePairs,
  normalizeEmailBody,
  parseAmount,
  parseDateToIso,
} from './email-body.util';
import type { EmailParser, ParsedTransaction } from './email-parser.interface';

export class PopularEmailParser implements EmailParser {
  readonly bankDomain = 'popularenlinea.com';

  canParse(fromAddress: string): boolean {
    const lower = fromAddress.toLowerCase();
    return (
      lower.includes('popularenlinea.com') ||
      lower.includes('bpd.com.do') ||
      lower.includes('bancopopular.com.do')
    );
  }

  parse(subject: string, body: string): ParsedTransaction | null {
    const decodedBody = decodeQuotedPrintable(body);
    const pairs = extractKeyValuePairs(decodedBody);
    const combined = normalizeEmailBody(`${subject}\n${decodedBody}`);

    const amountText =
      pairs.Monto ??
      combined.match(/RD\$[\d,]+\.?\d*/i)?.[0] ??
      combined.match(/\$[\d,]+\.?\d*/)?.[0];
    const amount = amountText ? parseAmount(amountText) : parseAmount(combined);
    if (amount == null) return null;

    const dateText = pairs.Fecha ?? combined;
    const transactionDate =
      parseDateToIso(dateText) ?? new Date().toISOString().slice(0, 10);

    const merchant =
      pairs['Cajero Automatico'] ??
      pairs['Cajero Automático'] ??
      combined.match(/BANCO POPULAR[^\n\r]*/i)?.[0]?.trim() ??
      null;

    return {
      amount,
      currency: 'DOP',
      merchant,
      description: subject.trim() || 'Transacción Popular',
      transactionDate,
      type: 'DEBIT',
    };
  }
}
