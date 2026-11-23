import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { QUICK_ENTRY_EXTRACTOR } from '../../shared/application/tokens';
import { QuickEntryContextService } from './quick-entry-context';
import { buildDraft, type QuickEntryParseResult } from './quick-entry-draft';
import type {
  QuickEntryExtraction,
  QuickEntryExtractorPort,
} from './ports/quick-entry-extractor.port';

export type {
  QuickEntryDraft,
  QuickEntryParseResult,
} from './quick-entry-draft';

/** Interprets a sentence and turns it into a draft the user can confirm. */
@Injectable()
export class QuickEntryService {
  constructor(
    private readonly context: QuickEntryContextService,
    @Inject(QUICK_ENTRY_EXTRACTOR)
    private readonly extractor: QuickEntryExtractorPort,
  ) {}

  async parse(userId: string, text: string): Promise<QuickEntryParseResult> {
    const context = await this.context.load(userId);
    const extraction = await this.runExtractor({
      userId,
      text,
      todayIso: context.todayIso,
      baseCurrency: context.baseCurrency,
      categories: context.catalogCategories,
      accounts: context.catalogAccounts,
      cards: context.catalogCards,
    });

    return buildDraft({
      extraction,
      accounts: context.accounts,
      cards: context.cards,
      categories: context.categories,
      text,
      timezone: context.timezone,
    });
  }

  private async runExtractor(
    input: Parameters<QuickEntryExtractorPort['extract']>[0],
  ): Promise<QuickEntryExtraction> {
    try {
      return await this.extractor.extract(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(
        `No se pudo interpretar el texto: ${message}`,
        {
          cause: error as Error,
        },
      );
    }
  }
}
