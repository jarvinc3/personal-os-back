import { domainToASCII } from 'node:url';

export const NORMALIZER_VERSION = 'email-knowledge-normalizer-v1';

// Fail closed: unknown subject words may be names, merchants or references.
const GLOBAL_TEMPLATE_WORDS = new Set([
  'a',
  'abono',
  'account',
  'alert',
  'alerta',
  'al',
  'amount',
  'aviso',
  'balance',
  'bank',
  'been',
  'bill',
  'billing',
  'card',
  'cargo',
  'charged',
  'cobro',
  'comercio',
  'compra',
  'confirmacion',
  'consumo',
  'con',
  'cuenta',
  'de',
  'del',
  'deposito',
  'el',
  'en',
  'estado',
  'factura',
  'from',
  'has',
  'invoice',
  'la',
  'movimiento',
  'of',
  'on',
  'pago',
  'para',
  'payment',
  'pendiente',
  'pedido',
  'por',
  'purchase',
  'realizado',
  'realizo',
  'receipt',
  'recibo',
  'reembolso',
  'retiro',
  'se',
  'statement',
  'su',
  'subscription',
  'sus',
  'tarjeta',
  'tienda',
  'to',
  'transaction',
  'transaccion',
  'transferencia',
  'tu',
  'tus',
  'un',
  'una',
  'was',
  'you',
  'your',
]);

// Multi-label public suffixes used by the initial corpus. A sender outside this
// set is kept at its full hostname rather than merging unrelated tenants.
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.do',
  'edu.do',
  'gob.do',
  'com.mx',
  'com.br',
  'com.ar',
  'com.co',
  'com.au',
  'co.jp',
]);

export function normalizeSender(value: string): string | null {
  const address = (value.match(/<([^<>]+)>/)?.[1] ?? value)
    .trim()
    .toLowerCase();
  const parts = address.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  const domain = domainToASCII(parts[1]);
  if (!domain || !/^[a-z0-9.-]+$/.test(domain) || !domain.includes('.')) {
    return null;
  }
  const local = parts[0].split('+')[0];
  return local ? `${local}@${domain}` : null;
}

export function registrableDomain(sender: string): string | null {
  const address = normalizeSender(sender);
  if (!address) {
    return null;
  }
  const domain = address.split('@')[1];
  const labels = domain.split('.');
  if (labels.some((part) => !part) || labels.length < 2) {
    return null;
  }
  const suffix = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(suffix)) {
    return labels.length > 2 ? labels.slice(-3).join('.') : null;
  }
  // Country-code domains not in the known suffix list remain separate. This
  // avoids treating every tenant under an unknown second-level suffix as one.
  if (labels.at(-1)?.length === 2 && (labels.at(-2)?.length ?? 0) <= 3) {
    return domain;
  }
  return suffix;
}

export function normalizeSubject(subject: string): string {
  let value = subject
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  while (/^\s*(?:re|fw|fwd)\s*:\s*/.test(value)) {
    value = value.replace(/^\s*(?:re|fw|fwd)\s*:\s*/, '');
  }
  value = value
    .replace(
      /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
      '<fecha>',
    )
    .replace(/(?:rd\$|us\$|\$|€|dop\s+|usd\s+|eur\s+)\s*\d[\d.,]*/g, '<monto>')
    .replace(/\b\d[\d.,]*\b/g, '<n>')
    .replace(/\b(?:rd\$|us\$|dop|usd|eur)\b/g, '<monto>')
    .replace(/\s+/g, ' ')
    .trim();
  return value;
}

export function knowledgeKeys(fromAddress: string, subject: string) {
  const sender = normalizeSender(fromAddress);
  const domain = sender ? registrableDomain(sender) : null;
  if (!sender || !domain) {
    return [];
  }
  return [
    { knowledgeType: 'EMAIL_SENDER' as const, knowledgeKey: sender },
    { knowledgeType: 'EMAIL_DOMAIN' as const, knowledgeKey: domain },
    {
      knowledgeType: 'EMAIL_TEMPLATE' as const,
      knowledgeKey: `${domain}|${normalizeSubject(subject)}`,
    },
  ];
}

export function isSafeGlobalTemplateKey(key: string): boolean {
  const separator = key.indexOf('|');
  if (separator < 1 || separator === key.length - 1) {
    return false;
  }
  const subject = key.slice(separator + 1);
  const tokens = subject.match(/<(?:n|fecha|monto)>|[a-z]+/g) ?? [];
  const remainder = subject
    .replace(/<(?:n|fecha|monto)>|[a-z]+/g, '')
    .replace(/[\s:,.!?;()-]/g, '');
  return (
    tokens.length > 0 &&
    remainder === '' &&
    tokens.every(
      (token) => token.startsWith('<') || GLOBAL_TEMPLATE_WORDS.has(token),
    )
  );
}
