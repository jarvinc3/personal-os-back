import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CardStatementsService } from '../application/card-statements.service';

@Injectable()
export class CardStatementsScheduler {
  constructor(private readonly statements: CardStatementsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  handleCron(): Promise<void> {
    return this.statements.syncAllCreditCards(new Date());
  }
}
