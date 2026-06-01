import {
  decodeQuotedPrintable,
  extractKeyValuePairs,
  normalizeEmailBody,
  parseAmount,
  parseDateToIso,
  stripHtml,
} from './email-body.util';
import type { EmailParser, ParsedTransaction } from './email-parser.interface';

function extractServicePaymentFields(body: string): {
  amount: number | null;
  merchant: string | null;
  date: string | null;
} {
  const decoded = decodeQuotedPrintable(body);
  const amountMatch = decoded.match(/RD\$\s*([\d,]+\.?\d*)/i);
  const amount = amountMatch ? parseAmount(amountMatch[0]) : null;

  const serviceMatch = decoded.match(
    /textDescriptionLeft[^>]*>\s*<p>\s*Servicio\s*<\/p>[\s\S]*?textDescriptionRigth[^>]*>\s*<p>\s*([^<]+?)\s*<\/p>/i,
  );
  const merchant = serviceMatch ? stripHtml(serviceMatch[1]).trim() : null;

  const dateMatch = decoded.match(
    /textDescriptionLeft[^>]*>\s*<p>\s*Fecha y hora\s*<\/p>[\s\S]*?textDescriptionRigth[^>]*>\s*<p>\s*([^<]+?)\s*<\/p>/i,
  );
  const date = dateMatch ? parseDateToIso(stripHtml(dateMatch[1])) : null;

  return { amount, merchant, date };
}

export class QikEmailParser implements EmailParser {
  readonly bankDomain = 'qik.com.do';

  canParse(fromAddress: string): boolean {
    return fromAddress.toLowerCase().includes('qik.com.do');
  }

  parse(subject: string, body: string): ParsedTransaction | null {
    const decodedBody = decodeQuotedPrintable(body);
    const subjectLower = subject.toLowerCase();
    const combined = normalizeEmailBody(`${subject}\n${decodedBody}`);

    if (subjectLower.includes('pago de servicio') || combined.includes('Monto total pagado')) {
      const payment = extractServicePaymentFields(decodedBody);
      if (payment.amount == null) return null;
      return {
        amount: payment.amount,
        currency: 'DOP',
        merchant: payment.merchant,
        description: subject.trim() || 'Pago de servicio Qik',
        transactionDate: payment.date ?? new Date().toISOString().slice(0, 10),
        type: 'DEBIT',
      };
    }

    const pairs = extractKeyValuePairs(decodedBody);
    const amountText = pairs.Monto ?? combined;
    const amount = parseAmount(amountText) ?? parseAmount(combined);
    if (amount == null) return null;

    const transactionDate =
      parseDateToIso(pairs.Fecha ?? combined) ?? new Date().toISOString().slice(0, 10);

    const isDeposit =
      subjectLower.includes('depósito') ||
      subjectLower.includes('deposito') ||
      Boolean(pairs['Entidad origen']);

    const isTransferOut =
      subjectLower.includes('transferencia') ||
      Boolean(pairs['Entidad destino'] || pairs.Destinatario);

    let merchant: string | null = null;
    let type: 'DEBIT' | 'CREDIT' = 'DEBIT';

    if (isDeposit) {
      merchant = pairs['Entidad origen'] ?? null;
      type = 'CREDIT';
    } else if (isTransferOut) {
      merchant = pairs.Destinatario ?? pairs['Entidad destino'] ?? null;
      type = 'DEBIT';
    }

    return {
      amount,
      currency: 'DOP',
      merchant,
      description: subject.trim() || 'Transacción Qik',
      transactionDate,
      type,
    };
  }
}
