import { matchesSenderFilter } from './gmail-import-scope';
import type { GmailMessage, MessageImportFilters } from './gmail-sync.types';

/** Consulta de Gmail con el corte de fecha y el remitente de la conexión. */
export function gmailScopeQuery({
  afterSeconds,
  beforeSeconds,
  senderFilter,
}: {
  afterSeconds: number;
  beforeSeconds?: number;
  senderFilter: string | null;
}): string {
  const parts = [`after:${afterSeconds}`];
  if (beforeSeconds) {
    parts.push(`before:${beforeSeconds}`);
  }
  if (senderFilter) {
    parts.push(`from:${senderFilter}`);
  }
  return parts.join(' ');
}

export function importFiltersOf(connection: {
  importStartAt: Date | null;
  senderFilter: string | null;
}): MessageImportFilters {
  return {
    importStartAt: connection.importStartAt,
    senderFilter: connection.senderFilter,
  };
}

export type MessageEnvelope = {
  headers: Map<string, string>;
  fromAddress: string;
  fromDomain: string;
  receivedAt: Date;
};

export function readMessageEnvelope(message: GmailMessage): MessageEnvelope {
  const headers = new Map(
    (message.payload?.headers ?? []).map((header) => [
      header.name.toLowerCase(),
      header.value,
    ]),
  );
  const fromHeader = headers.get('from') ?? '';
  const fromAddress =
    fromHeader.match(/<([^>]+)>/)?.[1]?.trim() ?? fromHeader.trim();
  const fromDomain = fromAddress.split('@').at(-1)?.toLowerCase() ?? '';
  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate))
    : new Date(headers.get('date') ?? Date.now());
  return { headers, fromAddress, fromDomain, receivedAt };
}

export function isWithinImportScope({
  envelope,
  filters,
}: {
  envelope: MessageEnvelope;
  filters: MessageImportFilters;
}): boolean {
  if (filters.importStartAt && envelope.receivedAt < filters.importStartAt) {
    return false;
  }
  if (
    filters.senderFilter &&
    !matchesSenderFilter({
      fromDomain: envelope.fromDomain,
      senderFilter: filters.senderFilter,
    })
  ) {
    return false;
  }
  return true;
}

export function gmailQueryDate(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '/');
}
