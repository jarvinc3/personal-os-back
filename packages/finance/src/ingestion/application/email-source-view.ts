import { BadRequestException } from '@nestjs/common';
import type { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { extractEmailDomain, normalizeBankSenderEmails } from './bank-sender';

export type EmailSourceRow = Awaited<
  ReturnType<EmailSourceRepository['listEmailSources']>
>[number];

type SenderFieldsInput = {
  bankSenderEmail?: string;
  bankSenderEmails?: string[];
  bankDomain?: string;
};

export type SenderFields = { bankSenderEmails: string[]; bankDomain: string };

/**
 * Senders of a source must share one domain; without senders the domain has to
 * come in the request, because the source is what tells the sync which mail to
 * read.
 */
export function resolveSenderFields(input: SenderFieldsInput): SenderFields {
  const senders = normalizeBankSenderEmails({
    bankSenderEmail: input.bankSenderEmail,
    bankSenderEmails: input.bankSenderEmails,
  });
  if (senders.length === 0) {
    const domain = input.bankDomain?.trim();
    if (!domain) {
      throw new BadRequestException(
        'bankSenderEmail or bankDomain is required',
      );
    }
    return { bankSenderEmails: [], bankDomain: domain };
  }
  const domain = extractEmailDomain(senders[0]);
  const mismatched = senders.filter(
    (email) => extractEmailDomain(email) !== domain,
  );
  if (mismatched.length > 0) {
    throw new BadRequestException(
      'All sender emails must share the same domain',
    );
  }
  return { bankSenderEmails: senders, bankDomain: domain };
}

export function mapEmailSourceResponse(source: EmailSourceRow) {
  return {
    id: source.id,
    connectionId: source.connectionId,
    institutionId: source.institutionId,
    institutionName: source.institution?.name ?? null,
    emailAddress: source.connection.emailAddress,
    bankSenderEmail: source.bankSenderEmails?.[0] ?? null,
    bankSenderEmails: source.bankSenderEmails ?? [],
    bankDomain: source.bankDomain,
    label: source.label,
    provider: source.connection.provider,
    isActive: source.isActive,
    lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
    createdAt: source.createdAt.toISOString(),
    logs: (source.logs ?? []).map((log) => ({
      id: log.id,
      status: log.status,
      error: log.error,
      emailsScanned: log.emailsScanned,
      transactionsNew: log.transactionsNew,
      startedAt: log.startedAt.toISOString(),
      completedAt: log.completedAt?.toISOString() ?? null,
    })),
  };
}
