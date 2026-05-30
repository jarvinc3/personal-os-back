import type { EmailParser, ParsedTransaction } from './email-parser.interface';

function extractAmount(text: string): { amount: number; currency: string } | null {
  const match =
    text.match(/(?:RD\$|DOP|\$)\s*([\d,]+\.?\d*)/i) ??
    text.match(/(?:monto|amount|total)[:\s]*([\d,]+\.?\d*)/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: 'DOP' };
}

function extractDate(text: string): string {
  const iso = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const dmy = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return new Date().toISOString().slice(0, 10);
}

export class BhdEmailParser implements EmailParser {
  readonly bankDomain = 'bhd.com.do';

  canParse(fromAddress: string): boolean {
    const lower = fromAddress.toLowerCase();
    return lower.includes('bhd.com.do') || lower.includes('bhdleon.com.do');
  }

  parse(subject: string, body: string): ParsedTransaction | null {
    const combined = `${subject}\n${body}`;
    const amounts = extractAmount(combined);
    if (!amounts) return null;

    const merchant =
      combined.match(/(?:en|at|comercio)[:\s]+([^\n\r.]+)/i)?.[1]?.trim() ??
      subject.replace(/notificaci[oó]n/i, '').trim() ??
      null;

    return {
      amount: amounts.amount,
      currency: amounts.currency,
      merchant,
      description: subject.trim() || 'Transacción BHD',
      transactionDate: extractDate(combined),
    };
  }
}
