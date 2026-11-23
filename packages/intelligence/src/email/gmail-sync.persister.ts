import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { PrismaService } from '@personal-os/database';
import { createHash } from 'node:crypto';
import {
  RAW_RETENTION_DEV_DAYS,
  RAW_RETENTION_PROD_DAYS,
} from './gmail-sync.constants';
import {
  isWithinImportScope,
  readMessageEnvelope,
  type MessageEnvelope,
} from './gmail-sync.scope';
import type {
  GmailMessage,
  GmailPart,
  MessageImportFilters,
} from './gmail-sync.types';

type StoredMessageContent = {
  fromAddress: string;
  fromDomain: string;
  receivedAt: Date;
  subject: string;
  rawBody: string;
  sanitizedBody: string;
  canonicalBody: string;
  contentFingerprint: string;
  templateFingerprint: string;
};

type GmailMessagePersisterDependencies = {
  prisma: PrismaService;
  config: ConfigService<Env, true>;
};

/** Guarda el correo saneado, sus huellas y su retención. */
export class GmailMessagePersister {
  private readonly prisma: PrismaService;
  private readonly config: ConfigService<Env, true>;

  constructor({ prisma, config }: GmailMessagePersisterDependencies) {
    this.prisma = prisma;
    this.config = config;
  }

  async persist({
    connectionId,
    userId,
    message,
    filters,
  }: {
    connectionId: string;
    userId: string;
    message: GmailMessage;
    filters: MessageImportFilters;
  }): Promise<number> {
    const payload = message.payload ?? {};
    const envelope = readMessageEnvelope(message);
    if (!isWithinImportScope({ envelope, filters })) {
      return 0;
    }
    const stored = buildStoredMessage({ message, payload, envelope });
    const retentionDays = this.retentionDays();
    const retentionExpiresAt = new Date(Date.now() + retentionDays * 86400_000);

    try {
      await this.prisma.aiEmailMessage.create({
        data: {
          userId,
          connectionId,
          providerMessageId: message.id,
          providerThreadId: message.threadId ?? null,
          receivedAt: stored.receivedAt,
          fromAddress: stored.fromAddress,
          fromDomain: stored.fromDomain,
          subject: stored.subject,
          contentFingerprint: stored.contentFingerprint,
          templateFingerprint: stored.templateFingerprint,
          processingStatus: 'QUEUED',
          content: {
            create: {
              rawBody: stored.rawBody,
              sanitizedBody: stored.sanitizedBody,
              canonicalBody: stored.canonicalBody,
              snippet: message.snippet ?? null,
              retentionExpiresAt,
            },
          },
        },
      });
      return 1;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return 0;
      }
      throw error;
    }
  }

  private retentionDays(): number {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      return RAW_RETENTION_PROD_DAYS;
    }
    return RAW_RETENTION_DEV_DAYS;
  }
}

function buildStoredMessage({
  message,
  payload,
  envelope,
}: {
  message: GmailMessage;
  payload: GmailPart;
  envelope: MessageEnvelope;
}): StoredMessageContent {
  const { headers, fromAddress, fromDomain, receivedAt } = envelope;
  const subject = headers.get('subject')?.trim() || '(sin asunto)';
  const bodies = collectBodies(payload);
  const rawBody = bodies.plain || bodies.html || message.snippet || '';
  const sanitizedBody = sanitize(bodies.plain || bodies.html || rawBody);
  const canonicalBody = canonicalize(sanitizedBody);
  const contentFingerprint = createHash('sha256')
    .update(canonicalBody)
    .digest('hex');
  const templateFingerprint = createHash('sha256')
    .update(templateize(canonicalBody))
    .digest('hex');
  return {
    fromAddress,
    fromDomain,
    receivedAt,
    subject,
    rawBody,
    sanitizedBody,
    canonicalBody,
    contentFingerprint,
    templateFingerprint,
  };
}

function collectBodies(part: GmailPart): { plain: string; html: string } {
  const own = part.body?.data
    ? Buffer.from(part.body.data, 'base64url').toString('utf8')
    : '';
  const children = (part.parts ?? []).map((child) => collectBodies(child));
  const plain = part.mimeType === 'text/plain' ? own : '';
  const html = part.mimeType === 'text/html' ? own : '';
  return {
    plain: [plain, ...children.map((child) => child.plain)]
      .filter(Boolean)
      .join('\n'),
    html: [html, ...children.map((child) => child.html)]
      .filter(Boolean)
      .join('\n'),
  };
}

function sanitize(body: string): string {
  return body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function canonicalize(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .split(
      /\n(?:On .{1,200}wrote:|El .{1,200}escribi[oó]:|-{2,}\s*Original Message\s*-{2,})/i,
    )[0]
    .split(/\n--\s*\n/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function templateize(body: string): string {
  return body
    .replace(/\b\d[\d.,]{2,}\b/g, '{NUMBER}')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '{ID}')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '{DATE}')
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '{DATE}')
    .toLowerCase();
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'P2002'
  );
}
