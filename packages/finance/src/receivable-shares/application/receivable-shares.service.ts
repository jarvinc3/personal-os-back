import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { RECEIVABLE_SHARE_ERROR } from '../domain/receivable-share';
import { ReceivableSharesRepository } from '../infrastructure/receivable-shares.repository';
import { generateReceivableShareToken } from './receivable-share-token';

/** Web route that renders a shared link: `/c/<token>`. */
const PUBLIC_SHARE_PATH = '/c/';

export type CreateReceivableShareCommand = {
  receivableIds: string[];
  debtorName: string;
};

type ShareSummaryRow = {
  id: string;
  token: string;
  debtorName: string;
  isActive: boolean;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  _count: { items: number };
};

@Injectable()
export class ReceivableSharesService {
  constructor(
    private readonly shares: ReceivableSharesRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(userId: string, command: CreateReceivableShareCommand) {
    const receivables = await this.shares.findReceivablesForShare(
      userId,
      command.receivableIds,
    );
    if (receivables.length !== command.receivableIds.length) {
      throw new NotFoundException({
        code: RECEIVABLE_SHARE_ERROR.RECEIVABLE_NOT_FOUND,
        message: 'No encontramos algunos de los cobros.',
      });
    }

    const share = await this.shares.createShare({
      userId,
      token: generateReceivableShareToken(),
      debtorName: command.debtorName,
      receivableIds: command.receivableIds,
    });

    return {
      id: share.id,
      token: share.token,
      url: this.shareUrl(share.token),
      debtorName: share.debtorName,
      isActive: share.isActive,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
      items: command.receivableIds,
    };
  }

  async list(userId: string) {
    const shares = await this.shares.listShares(userId);
    return shares.map((share) => this.summary(share));
  }

  async revoke(userId: string, shareId: string, now: Date) {
    const share = await this.shares.revokeShare(userId, shareId, now);
    if (!share) {
      throw this.notFound();
    }
    return this.summary(share);
  }

  async regenerate(userId: string, shareId: string) {
    const share = await this.shares.rotateShareToken(
      userId,
      shareId,
      generateReceivableShareToken(),
    );
    if (!share) {
      throw this.notFound();
    }
    return this.summary(share);
  }

  private shareUrl(token: string): string {
    const [origin] = this.config
      .getOrThrow('CORS_ORIGIN', { infer: true })
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (!origin) {
      throw new Error('CORS_ORIGIN has no origin to build the share link');
    }
    return `${origin}${PUBLIC_SHARE_PATH}${token}`;
  }

  private summary(share: ShareSummaryRow) {
    return {
      id: share.id,
      token: share.token,
      url: this.shareUrl(share.token),
      debtorName: share.debtorName,
      isActive: share.isActive,
      expiresAt: share.expiresAt,
      revokedAt: share.revokedAt,
      createdAt: share.createdAt,
      itemCount: share._count.items,
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: RECEIVABLE_SHARE_ERROR.NOT_FOUND,
      message: 'No encontramos ese link.',
    });
  }
}
