import { Injectable } from '@nestjs/common';
import type {
  ListRecurringQueryDto,
  UpcomingRecurringQueryDto,
} from '../presentation/dto/list-recurring-query.dto';
import type { CreateRecurringDto } from '../presentation/dto/create-recurring.dto';
import type { UpdateRecurringDto } from '../presentation/dto/update-recurring.dto';
import { RecurringDetectionService } from './recurring-detection.service';
import { RecurringQueryService } from './recurring-query.service';
import { RecurringWriteService } from './recurring-write.service';
import type { RecurringDetectionOutcome } from './recurring-types';

export type {
  RecurringDetectionOutcome,
  RecurringPatternWithMerchant,
  RecurringPriceChange,
} from './recurring-types';

/** Entry point to recurring patterns: reads, writes and detection. */
@Injectable()
export class RecurringService {
  constructor(
    private readonly query: RecurringQueryService,
    private readonly write: RecurringWriteService,
    private readonly detection: RecurringDetectionService,
  ) {}

  list(userId: string, query: ListRecurringQueryDto, now = new Date()) {
    return this.query.list(userId, query, now);
  }

  upcoming(userId: string, query: UpcomingRecurringQueryDto, now = new Date()) {
    return this.query.upcoming(userId, query, now);
  }

  create(userId: string, dto: CreateRecurringDto, now = new Date()) {
    return this.write.create(userId, dto, now);
  }

  update(input: {
    userId: string;
    id: string;
    dto: UpdateRecurringDto;
    now?: Date;
  }) {
    return this.write.update(input);
  }

  detect(userId: string, now = new Date()): Promise<RecurringDetectionOutcome> {
    return this.detection.detect(userId, now);
  }
}
