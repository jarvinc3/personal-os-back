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

  /** Reads the link, runs the revoke command and returns the resulting view. */
  async revoke(input: { userId: string; shareId: string; now: Date }) {
    const share = await this.requireShare(input.userId, input.shareId);
    await this.shares.revokeShare(input);
    return this.summary({ ...share, isActive: false, revokedAt: input.now });
  }

  async regenerate(userId: string, shareId: string) {
    const share = await this.requireShare(userId, shareId);
    const token = generateReceivableShareToken();
    await this.shares.rotateShareToken({ userId, shareId, token });
    return this.summary({ ...share, token, isActive: true, revokedAt: null });
  }

  private async requireShare(
    userId: string,
    shareId: string,
  ): Promise<ShareSummaryRow> {
    const share = await this.shares.findShare(userId, shareId);
    if (!share) {
      throw this.notFound();
    }
    return share;
  }

  private shareUrl(token: string): string {
    const base =
      this.config.get('PUBLIC_WEB_URL', { infer: true }) ??
      this.firstCorsOrigin();
    return `${base.replace(/\/+$/, '')}${PUBLIC_SHARE_PATH}${token}`;
  }

  /** Legacy fallback for environments without PUBLIC_WEB_URL. */
  private firstCorsOrigin(): string {
    const [origin] = this.config
      .getOrThrow('CORS_ORIGIN', { infer: true })
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (!origin) {
      throw new Error('CORS_ORIGIN has no origin to build the share link');
    }
    return origin;
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
