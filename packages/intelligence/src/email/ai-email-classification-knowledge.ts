import type { Prisma, PrismaService } from '@personal-os/database';
import { knowledgeKeys } from '../knowledge/knowledge-normalizer';
import type { KnowledgeMatch } from './ai-email-classification.types';

/** Conocimiento verificado que aplica a un correo, del más específico al más general. */
export class EmailKnowledgeResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    userId: string,
    message: {
      fromAddress: string;
      subject: string;
    },
  ): Promise<{ matches: KnowledgeMatch[]; verifiedSender: boolean }> {
    const keys = knowledgeKeys(message.fromAddress, message.subject);
    if (keys.length === 0) {
      return { matches: [], verifiedSender: false };
    }
    const userRows = await this.prisma.aiKnowledge.findMany({
      where: {
        userId,
        scope: 'USER',
        state: 'STABLE',
        OR: keys.map(({ knowledgeType, knowledgeKey }) => ({
          knowledgeType,
          knowledgeKey,
        })),
      },
      select: {
        id: true,
        knowledgeType: true,
        knowledgeKey: true,
        scope: true,
        payload: true,
      },
    });
    const userMatches = this.orderKnowledge(userRows, keys);
    if (userMatches.length > 0) {
      return {
        matches: [userMatches[0]],
        verifiedSender: userMatches.some(
          ({ knowledgeType, scope }) =>
            knowledgeType === 'EMAIL_SENDER' && scope === 'USER',
        ),
      };
    }
    const globalRows = await this.prisma.aiKnowledge.findMany({
      where: {
        scope: 'GLOBAL',
        state: 'STABLE',
        OR: keys
          .filter(({ knowledgeType }) => knowledgeType !== 'EMAIL_SENDER')
          .map(({ knowledgeType, knowledgeKey }) => ({
            knowledgeType,
            knowledgeKey,
          })),
      },
      select: {
        id: true,
        knowledgeType: true,
        knowledgeKey: true,
        scope: true,
        payload: true,
      },
    });
    const globalMatches = this.orderKnowledge(globalRows, keys);
    return {
      matches: globalMatches.length > 0 ? [globalMatches[0]] : [],
      verifiedSender: false,
    };
  }

  private orderKnowledge<T extends KnowledgeMatch>(
    rows: T[],
    keys: ReturnType<typeof knowledgeKeys>,
  ) {
    const rank = new Map(
      keys.map((key) => [
        `${key.knowledgeType}:${key.knowledgeKey}`,
        key.knowledgeType === 'EMAIL_TEMPLATE'
          ? 0
          : key.knowledgeType === 'EMAIL_SENDER'
            ? 1
            : 2,
      ]),
    );
    return rows
      .filter((row) => readKnowledgeLabel(row.payload) !== null)
      .sort(
        (left, right) =>
          (rank.get(`${left.knowledgeType}:${left.knowledgeKey}`) ?? 99) -
          (rank.get(`${right.knowledgeType}:${right.knowledgeKey}`) ?? 99),
      );
  }
}

/** La etiqueta guardada en el conocimiento, o null si no tiene forma de etiqueta. */
export function readKnowledgeLabel(
  payload: Prisma.JsonValue | undefined,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const label = (payload as Record<string, unknown>).label;
  if (!label || typeof label !== 'object' || Array.isArray(label)) {
    return null;
  }
  return label as Record<string, unknown>;
}
