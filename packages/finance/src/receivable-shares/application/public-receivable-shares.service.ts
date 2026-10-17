import { Injectable, NotFoundException } from '@nestjs/common';
import {
  isReceivableShareReachable,
  RECEIVABLE_SHARE_ERROR,
} from '../domain/receivable-share';
import { ReceivableSharesRepository } from '../infrastructure/receivable-shares.repository';
import { mapPublicReceivableShare } from './public-receivable-share.mapper';

/** One answer for missing, revoked, expired or inactive: no probing. */
const UNAVAILABLE_MESSAGE = 'Este link no está disponible.';

@Injectable()
export class PublicReceivableSharesService {
  constructor(private readonly shares: ReceivableSharesRepository) {}

  async getByToken(token: string, now: Date) {
    const share = await this.shares.findShareByToken(token);
    if (!share || !isReceivableShareReachable(share, now)) {
      throw new NotFoundException({
        code: RECEIVABLE_SHARE_ERROR.NOT_FOUND,
        message: UNAVAILABLE_MESSAGE,
      });
    }
    return mapPublicReceivableShare(share);
  }
}
