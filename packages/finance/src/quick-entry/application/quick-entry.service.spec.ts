import type { UsersService } from '@personal-os/users';
import type { CatalogService } from '../../catalog/application/catalog.service';
import type { ResolveUserBaseCurrencyUseCase } from '../../fx/application/resolve-user-base-currency';
import { QuickEntryService } from './quick-entry.service';
import type {
  QuickEntryExtraction,
  QuickEntryExtractorPort,
} from './ports/quick-entry-extractor.port';

const account = (overrides: Record<string, unknown> = {}) => ({
  id: 'account-popular',
  name: 'Cuenta Popular',
  institutionName: 'Banco Popular',
  accountNumber: '00003447',
  currency: 'DOP',
  ...overrides,
});

const card = (overrides: Record<string, unknown> = {}) => ({
  id: 'card-visa',
  name: 'BHD Visa',
  network: 'VISA',
  lastFour: '6506',
  institutionName: 'BHD',
  balances: [{ currency: 'DOP' }],
  ...overrides,
});

const category = (name: string, type: string, id: string) => ({
  id,
  name,
  type,
});

const categories = [
  category('Comida', 'EXPENSE', 'cat-food'),
  category('Café', 'EXPENSE', 'cat-coffee'),
  category('Servicios', 'EXPENSE', 'cat-utilities'),
  category('Nómina', 'INCOME', 'cat-payroll'),
  category('Otros ingresos', 'INCOME', 'cat-income'),
];

type ServiceOverrides = {
  accounts?: unknown[];
  cards?: unknown[];
  categories?: unknown[];
  extraction?: Partial<QuickEntryExtraction>;
  timezone?: string | null;
};

function extractionWith(overrides: Partial<QuickEntryExtraction>) {
  return {
    type: 'DEBIT' as const,
    amount: '0',
    currency: 'DOP',
    categoryNameHint: null,
    accountHint: null,
    cardHint: null,
    date: null,
    merchant: null,
    description: null,
    confidence: 0.8,
    ...overrides,
  };
}

function createService(overrides: ServiceOverrides = {}) {
  const extractor: QuickEntryExtractorPort = {
    extract: jest
      .fn()
      .mockResolvedValue(extractionWith(overrides.extraction ?? {})),
  };
  const catalog = {
    listAccounts: jest
      .fn()
      .mockResolvedValue(overrides.accounts ?? [account()]),
    listCards: jest.fn().mockResolvedValue(overrides.cards ?? [card()]),
    listCategories: jest
      .fn()
      .mockResolvedValue(overrides.categories ?? categories),
  } as unknown as CatalogService;
  const users = {
    findById: jest.fn().mockResolvedValue({
      timezone: overrides.timezone ?? 'America/Santo_Domingo',
    }),
  } as unknown as UsersService;
  const baseCurrency = {
    execute: jest.fn().mockResolvedValue('DOP'),
  } as unknown as ResolveUserBaseCurrencyUseCase;

  return new QuickEntryService(catalog, users, baseCurrency, extractor);
}

describe('QuickEntryService', () => {
  it('proposes a DEBIT on the Popular account without saving', async () => {
    const service = createService({
      extraction: {
        type: 'DEBIT',
        amount: '250.00',
        categoryNameHint: 'Café',
        accountHint: 'popular',
        merchant: 'Café',
      },
    });

    const parseResult = await service.parse('user-1', 'café 250 popular');

    expect(parseResult.draft).toMatchObject({
      type: 'DEBIT',
      amount: '250.00',
      currency: 'DOP',
      categoryId: 'cat-coffee',
      accountId: 'account-popular',
      cardId: null,
    });
    expect(parseResult.missing).toEqual([]);
  });

  it('proposes the visa card when the card is named', async () => {
    const service = createService({
      extraction: {
        type: 'DEBIT',
        amount: '3500.00',
        categoryNameHint: 'Servicios',
        cardHint: 'visa',
        merchant: 'Luz',
      },
    });

    const parseResult = await service.parse(
      'user-1',
      'pagué 3,500 de luz con la visa',
    );

    expect(parseResult.draft.cardId).toBe('card-visa');
    expect(parseResult.draft.accountId).toBeNull();
    expect(parseResult.draft.categoryId).toBe('cat-utilities');
  });

  it('routes quincena to the payroll income category', async () => {
    const service = createService({
      extraction: {
        type: 'CREDIT',
        amount: '45000.00',
        accountHint: 'popular',
      },
    });

    const parseResult = await service.parse('user-1', 'me pagaron la quincena');

    expect(parseResult.draft.type).toBe('CREDIT');
    expect(parseResult.draft.categoryId).toBe('cat-payroll');
  });

  it('flags a missing amount and target', async () => {
    const service = createService({
      extraction: { type: 'DEBIT', amount: '0' },
      accounts: [],
      cards: [],
    });

    const parseResult = await service.parse('user-1', 'algo');

    expect(parseResult.missing).toEqual(['amount', 'accountId']);
  });

  it('keeps a valid date from the model', async () => {
    const service = createService({
      extraction: { type: 'DEBIT', amount: '10', date: '2026-10-01' },
    });

    const parseResult = await service.parse('user-1', 'ayer');

    expect(parseResult.draft.date).toBe('2026-10-01');
  });

  it('uses today when the model states no date', async () => {
    const service = createService({
      extraction: { type: 'DEBIT', amount: '10', date: null },
    });

    const parseResult = await service.parse('user-1', 'algo sin fecha');

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    expect(parseResult.draft.date).toBe(today);
  });
});
