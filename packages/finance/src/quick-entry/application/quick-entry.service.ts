import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { UsersService } from '@personal-os/users';
import { CatalogService } from '../../catalog/application/catalog.service';
import { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import {
  type QuickEntryCatalogAccount,
  type QuickEntryCatalogCard,
  type QuickEntryCatalogCategory,
  type QuickEntryExtraction,
  type QuickEntryExtractorPort,
} from '../application/ports/quick-entry-extractor.port';
import { QUICK_ENTRY_EXTRACTOR } from '../../shared/application/tokens';

const PAYROLL_TEXT = /quincena|nomina|salario|sueldo/;
const PAYROLL_CATEGORY = /nomina|salario|sueldo|ingreso/;
const MIN_MATCH_DIGITS = 3;

export type QuickEntryDraft = {
  type: 'DEBIT' | 'CREDIT';
  amount: string;
  currency: string;
  categoryId: string | null;
  accountId: string | null;
  cardId: string | null;
  date: string;
  merchant: string | null;
  description: string | null;
};

export type QuickEntryParseResult = {
  draft: QuickEntryDraft;
  confidence: number;
  missing: string[];
};

type CatalogAccount = Awaited<
  ReturnType<CatalogService['listAccounts']>
>[number];
type CatalogCard = Awaited<ReturnType<CatalogService['listCards']>>[number];
type CatalogCategory = Awaited<
  ReturnType<CatalogService['listCategories']>
>[number];

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function digitsOf(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function todayIso(timezone: string | null, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function resolveAccount(
  hint: string | null,
  accounts: CatalogAccount[],
): CatalogAccount | null {
  const needle = normalize(hint ?? '');
  if (!needle) {
    return null;
  }
  const needleDigits = digitsOf(hint);
  const scored = accounts
    .map((account) => {
      const label = normalize(
        [account.name, account.institutionName].filter(Boolean).join(' '),
      );
      const accountDigits = digitsOf(account.accountNumber);
      const textMatch = label.includes(needle) ? 2 : 0;
      const digitMatch =
        needleDigits.length >= MIN_MATCH_DIGITS &&
        accountDigits.endsWith(needleDigits)
          ? 3
          : 0;
      return { account, score: textMatch + digitMatch };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.account ?? null;
}

function resolveCard(
  hint: string | null,
  cards: CatalogCard[],
): CatalogCard | null {
  const needle = normalize(hint ?? '');
  if (!needle) {
    return null;
  }
  const needleDigits = digitsOf(hint);
  const scored = cards
    .map((card) => {
      const label = normalize(
        [card.name, card.network, card.institutionName]
          .filter(Boolean)
          .join(' '),
      );
      const cardDigits = digitsOf(card.lastFour);
      const textMatch = label.includes(needle) ? 2 : 0;
      const digitMatch =
        needleDigits.length >= MIN_MATCH_DIGITS &&
        cardDigits.endsWith(needleDigits)
          ? 3
          : 0;
      return { card, score: textMatch + digitMatch };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.card ?? null;
}

function categoryPool(
  categories: CatalogCategory[],
  type: 'DEBIT' | 'CREDIT',
): CatalogCategory[] {
  const expected = type === 'DEBIT' ? 'EXPENSE' : 'INCOME';
  return categories.filter((category) => category.type === expected);
}

function resolveCategory(
  hint: string | null,
  categories: CatalogCategory[],
  type: 'DEBIT' | 'CREDIT',
  text: string,
): CatalogCategory | null {
  const pool = categoryPool(categories, type);
  if (type === 'CREDIT' && PAYROLL_TEXT.test(normalize(text))) {
    const payroll = pool.find((category) =>
      PAYROLL_CATEGORY.test(normalize(category.name)),
    );
    if (payroll) {
      return payroll;
    }
  }
  const needle = normalize(hint ?? '');
  if (!needle) {
    return null;
  }
  const exact = pool.find((category) => normalize(category.name) === needle);
  if (exact) {
    return exact;
  }
  const partial = pool.filter((category) => {
    const name = normalize(category.name);
    return name.includes(needle) || needle.includes(name);
  });
  return partial[0] ?? null;
}

function resolveDate(value: string | null, timezone: string | null): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return todayIso(timezone, new Date());
}

@Injectable()
export class QuickEntryService {
  constructor(
    private readonly catalog: CatalogService,
    private readonly users: UsersService,
    private readonly baseCurrency: ResolveUserBaseCurrencyUseCase,
    @Inject(QUICK_ENTRY_EXTRACTOR)
    private readonly extractor: QuickEntryExtractorPort,
  ) {}

  async parse(userId: string, text: string): Promise<QuickEntryParseResult> {
    const [accounts, cards, categories, baseCurrency, profile] =
      await Promise.all([
        this.catalog.listAccounts(userId),
        this.catalog.listCards(userId),
        this.catalog.listCategories(userId),
        this.baseCurrency.execute(userId),
        this.users.findById(userId),
      ]);

    const catalogAccounts: QuickEntryCatalogAccount[] = accounts.map(
      (account) => ({
        id: account.id,
        name: account.name,
        institutionName: account.institutionName,
        accountNumber: account.accountNumber,
        currency: account.currency,
      }),
    );
    const catalogCards: QuickEntryCatalogCard[] = cards.map((card) => ({
      id: card.id,
      name: card.name,
      network: card.network,
      lastFour: card.lastFour,
      currency: card.balances[0]?.currency ?? null,
    }));
    const catalogCategories: QuickEntryCatalogCategory[] = categories.map(
      (category) => ({
        id: category.id,
        name: category.name,
        type: category.type,
      }),
    );

    const extraction = await this.runExtractor({
      text,
      todayIso: todayIso(profile.timezone, new Date()),
      baseCurrency,
      categories: catalogCategories,
      accounts: catalogAccounts,
      cards: catalogCards,
    });

    return this.buildDraft({
      extraction,
      accounts,
      cards,
      categories,
      text,
      timezone: profile.timezone,
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

  private buildDraft({
    extraction,
    accounts,
    cards,
    categories,
    text,
    timezone,
  }: {
    extraction: QuickEntryExtraction;
    accounts: CatalogAccount[];
    cards: CatalogCard[];
    categories: CatalogCategory[];
    text: string;
    timezone: string | null;
  }): QuickEntryParseResult {
    const account = resolveAccount(extraction.accountHint, accounts);
    const card = resolveCard(extraction.cardHint, cards);
    const category = resolveCategory(
      extraction.categoryNameHint,
      categories,
      extraction.type,
      text,
    );

    let accountId: string | null = null;
    let cardId: string | null = null;
    if (account) {
      accountId = account.id;
    } else if (card) {
      cardId = card.id;
    }

    const draft: QuickEntryDraft = {
      type: extraction.type,
      amount: extraction.amount,
      currency: extraction.currency,
      categoryId: category?.id ?? null,
      accountId,
      cardId,
      date: resolveDate(extraction.date, timezone),
      merchant: extraction.merchant,
      description: extraction.description,
    };

    return {
      draft,
      confidence: extraction.confidence,
      missing: this.findMissing(draft),
    };
  }

  private findMissing(draft: QuickEntryDraft): string[] {
    const missing: string[] = [];
    if (Number(draft.amount) <= 0) {
      missing.push('amount');
    }
    if (!draft.accountId && !draft.cardId) {
      missing.push('accountId');
    }
    return missing;
  }
}
