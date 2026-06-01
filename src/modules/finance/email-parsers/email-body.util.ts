export function stripHtml(html: string): string {
  return html
    .replace(/=\r?\n/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#173;/g, '')
    .replace(/&shy;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

export function normalizeEmailBody(body: string): string {
  const decoded = decodeQuotedPrintable(body);
  return stripHtml(decoded);
}

export function extractKeyValuePairs(htmlOrText: string): Record<string, string> {
  const text = htmlOrText.includes('<') ? stripHtml(decodeQuotedPrintable(htmlOrText)) : htmlOrText;
  const pairs: Record<string, string> = {};

  const rowPattern =
    /<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/gi;
  let match = rowPattern.exec(htmlOrText);
  while (match) {
    const key = stripHtml(match[1]).trim();
    const value = stripHtml(match[2]).trim();
    if (key && value) pairs[key] = value;
    match = rowPattern.exec(htmlOrText);
  }

  if (Object.keys(pairs).length > 0) return pairs;

  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const tabParts = line.split(/\t+/).map((part) => part.trim()).filter(Boolean);
    if (tabParts.length >= 2) {
      pairs[tabParts[0]] = tabParts.slice(1).join(' ');
    }
  }

  return pairs;
}

export function parseAmount(value: string): number | null {
  const match = value.match(/(?:RD\$?\s*|DOP\s*)?([\d,]+\.?\d*)/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

export function parseDateToIso(value: string): string | null {
  const iso = value.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  const dmy = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  const dmyShort = value.match(/(\d{2})\/(\d{2})\/(\d{2})/);
  if (dmyShort) return `20${dmyShort[3]}-${dmyShort[2]}-${dmyShort[1]}`;

  const monthNames: Record<string, string> = {
    enero: '01',
    febrero: '02',
    marzo: '03',
    abril: '04',
    mayo: '05',
    junio: '06',
    julio: '07',
    agosto: '08',
    septiembre: '09',
    octubre: '10',
    noviembre: '11',
    diciembre: '12',
  };
  const verbal = value.toLowerCase().match(/(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})/i);
  if (verbal) {
    const month = monthNames[verbal[2].normalize('NFD').replace(/\p{M}/gu, '')] ?? null;
    if (month) {
      return `${verbal[3]}-${month}-${verbal[1].padStart(2, '0')}`;
    }
  }

  return null;
}

export function extractBhdTransactionRow(body: string): {
  date: string | null;
  amount: number | null;
  merchant: string | null;
  typeLabel: string | null;
} {
  const tbodyMatch = body.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const rowHtml = tbodyMatch?.[1] ?? body;
  const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) =>
    stripHtml(decodeQuotedPrintable(cell[1])).trim(),
  );

  if (cells.length >= 6) {
    return {
      date: parseDateToIso(cells[0]),
      amount: parseAmount(cells[2]),
      merchant: cells[3] || null,
      typeLabel: cells[5] || null,
    };
  }

  return { date: null, amount: null, merchant: null, typeLabel: null };
}
