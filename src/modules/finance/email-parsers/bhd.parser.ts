import {
  decodeQuotedPrintable,
  extractBhdTransactionRow,
  normalizeEmailBody,
  parseAmount,
  parseDateToIso,
} from './email-body.util';
import type { EmailParser, ParsedTransaction } from './email-parser.interface';

export class BhdEmailParser implements EmailParser {
  readonly bankDomain = 'bhd.com.do';

  canParse(fromAddress: string): boolean {
    const lower = fromAddress.toLowerCase();
    return lower.includes('bhd.com.do') || lower.includes('bhdleon.com.do');
  }

  parse(subject: string, body: string): ParsedTransaction | null {
    const decodedBody = decodeQuotedPrintable(body);
    const row = extractBhdTransactionRow(decodedBody);
    const combined = normalizeEmailBody(`${subject}\n${decodedBody}`);

    const amount = row.amount ?? parseAmount(combined);
    if (amount == null) return null;

    const transactionDate =
      row.date ?? parseDateToIso(combined) ?? new Date().toISOString().slice(0, 10);

    const merchant =
      row.merchant ??
      combined.match(/(?:comercio)[:\s]+([^\n\r.]+)/i)?.[1]?.trim() ??
      null;

    const typeLabel = row.typeLabel?.toLowerCase() ?? '';
    const type =
      typeLabel.includes('crédito') || typeLabel.includes('credito') || typeLabel.includes('abono')
        ? 'CREDIT'
        : 'DEBIT';

    return {
      amount,
      currency: 'DOP',
      merchant,
      description: subject.trim() || 'Transacción BHD',
      transactionDate,
      type,
    };
  }
}
