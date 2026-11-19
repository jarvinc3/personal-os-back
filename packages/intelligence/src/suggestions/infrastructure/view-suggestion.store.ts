import { PrismaService } from '@personal-os/database';
import { Injectable } from '@nestjs/common';

export type StoredViewSuggestion = {
  id: string;
  label: string;
  prompt: string;
  actionId: string | null;
};

export type StoredViewSuggestionAction = {
  id: string;
  actionType: string;
  targetModule: string;
  policy: 'AUTO_ALLOWED' | 'CONFIRM_REQUIRED' | 'FORBIDDEN';
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  payload: unknown;
};

type ViewScopeFilter = {
  userId: string;
  route: string;
  viewKey: string;
};

const SUGGESTION_FIELDS = {
  id: true,
  label: true,
  prompt: true,
  actionId: true,
} as const;

@Injectable()
export class ViewSuggestionStore {
  constructor(private readonly prisma: PrismaService) {}

  findActive({
    userId,
    route,
    viewKey,
    now,
    limit,
  }: ViewScopeFilter & { now: Date; limit: number }) {
    return this.prisma.aiViewSuggestion.findMany({
      where: {
        userId,
        route,
        viewKey,
        status: 'ACTIVE',
        expiresAt: { gt: now },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: SUGGESTION_FIELDS,
    });
  }

  async findKnownKeys({
    userId,
    route,
    viewKey,
    limit,
  }: ViewScopeFilter & { limit: number }): Promise<string[]> {
    const rows = await this.prisma.aiViewSuggestion.findMany({
      where: { userId, route, viewKey },
      orderBy: { suggestionKey: 'asc' },
      take: limit,
      select: { suggestionKey: true },
    });
    return rows.map((row) => row.suggestionKey);
  }

  findExpiredActive({
    userId,
    route,
    viewKey,
    now,
  }: ViewScopeFilter & { now: Date }) {
    return this.prisma.aiViewSuggestion.findMany({
      where: {
        userId,
        route,
        viewKey,
        status: 'ACTIVE',
        expiresAt: { lte: now },
      },
      select: { id: true, actionId: true },
    });
  }

  async deleteByIds({
    userId,
    suggestionIds,
  }: {
    userId: string;
    suggestionIds: string[];
  }): Promise<void> {
    if (!suggestionIds.length) {
      return;
    }
    await this.prisma.aiViewSuggestion.deleteMany({
      where: { userId, id: { in: suggestionIds } },
    });
  }

  createMany({
    userId,
    route,
    viewKey,
    suggestions,
    expiresAt,
  }: ViewScopeFilter & {
    suggestions: Array<{
      suggestionKey: string;
      label: string;
      prompt: string;
    }>;
    expiresAt: Date;
  }) {
    return this.prisma.aiViewSuggestion.createManyAndReturn({
      data: suggestions.map((suggestion) => ({
        userId,
        route,
        viewKey,
        suggestionKey: suggestion.suggestionKey,
        label: suggestion.label,
        prompt: suggestion.prompt,
        expiresAt,
      })),
      skipDuplicates: true,
      select: {
        ...SUGGESTION_FIELDS,
        suggestionKey: true,
      },
    });
  }

  async setActionId({
    userId,
    suggestionId,
    actionId,
  }: {
    userId: string;
    suggestionId: string;
    actionId: string;
  }): Promise<void> {
    await this.prisma.aiViewSuggestion.updateMany({
      where: { id: suggestionId, userId },
      data: { actionId },
    });
  }

  findOwned({
    userId,
    suggestionId,
  }: {
    userId: string;
    suggestionId: string;
  }) {
    return this.prisma.aiViewSuggestion.findFirst({
      where: { id: suggestionId, userId },
      select: { id: true, status: true, actionId: true },
    });
  }

  async dismiss({
    userId,
    suggestionId,
  }: {
    userId: string;
    suggestionId: string;
  }): Promise<boolean> {
    const dismissed = await this.prisma.aiViewSuggestion.updateMany({
      where: { id: suggestionId, userId, status: 'ACTIVE' },
      data: { status: 'DISMISSED', dismissedAt: new Date() },
    });
    return dismissed.count === 1;
  }

  findActions({
    userId,
    actionIds,
  }: {
    userId: string;
    actionIds: string[];
  }): Promise<StoredViewSuggestionAction[]> {
    return this.prisma.aiAction.findMany({
      where: { userId, id: { in: actionIds } },
      select: {
        id: true,
        actionType: true,
        targetModule: true,
        policy: true,
        status: true,
        payload: true,
      },
    });
  }
}
