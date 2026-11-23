import type { EmailProductProposalProductLookup } from '@personal-os/contracts';
import { FinanceEmailProductProposalCatalog } from './email-product-proposal-catalog';
import { EmailProductProposalLink } from './email-product-proposal-link';
import type { CatalogService } from './catalog.service';

type InstitutionRow = {
  id: string;
  name: string;
  domain: string | null;
};

type AccountRow = {
  id: string;
  accountNumberLast4: string | null;
  isActive: boolean;
  institutionId: string | null;
  institutionRef: { isSystem: boolean } | null;
};

type CardRow = {
  id: string;
  lastFour: string | null;
  isActive: boolean;
  institutionId: string | null;
  institution: { isSystem: boolean };
};

const BHD: InstitutionRow = {
  id: 'institution-bhd',
  name: 'BHD',
  domain: 'bhd.com.do',
};

function accountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'account-1',
    accountNumberLast4: '0016',
    isActive: true,
    institutionId: BHD.id,
    institutionRef: { isSystem: false },
    ...overrides,
  };
}

function cardRow(overrides: Partial<CardRow> = {}): CardRow {
  return {
    id: 'card-1',
    lastFour: '6506',
    isActive: true,
    institutionId: BHD.id,
    institution: { isSystem: false },
    ...overrides,
  };
}

function createAdapter({
  institutions = [BHD],
  accounts = [],
  cards = [],
  linkedAccount,
  linkedCard,
}: {
  institutions?: InstitutionRow[];
  accounts?: AccountRow[];
  cards?: CardRow[];
  linkedAccount?: AccountRow;
  linkedCard?: CardRow;
} = {}) {
  const repo = {
    findInstitutionsByUser: jest.fn().mockResolvedValue(institutions),
    findEmailAccountCandidatesByLastFours: jest.fn(
      (_userId: string, lastFours: readonly string[]) =>
        Promise.resolve(
          accounts.filter(
            (account) =>
              account.accountNumberLast4 !== null &&
              lastFours.includes(account.accountNumberLast4),
          ),
        ),
    ),
    findEmailCardCandidatesByLastFours: jest.fn(
      (_userId: string, lastFours: readonly string[]) =>
        Promise.resolve(
          cards.filter(
            (card) =>
              card.lastFour !== null && lastFours.includes(card.lastFour),
          ),
        ),
    ),
    findAccountsByIds: jest
      .fn()
      .mockResolvedValue(linkedAccount ? [linkedAccount] : []),
    findCardsByIds: jest.fn().mockResolvedValue(linkedCard ? [linkedCard] : []),
  };
  const adapter = new FinanceEmailProductProposalCatalog(
    {} as CatalogService,
    new EmailProductProposalLink(repo as never, repo as never, repo as never),
  );
  return { adapter, repo };
}

function lookup(
  overrides: Partial<EmailProductProposalProductLookup> = {},
): EmailProductProposalProductLookup {
  return {
    productType: 'ACCOUNT',
    lastFour: '0016',
    institution: { name: 'BHD', domain: 'bhd.com.do' },
    ...overrides,
  };
}

describe('FinanceEmailProductProposalCatalog findProductMatches', () => {
  it('matches an active product of a compatible institution', async () => {
    const { adapter } = createAdapter({ accounts: [accountRow()] });

    await expect(
      adapter.findProductMatches('user-1', [lookup()]),
    ).resolves.toEqual([['account-1']]);
  });

  it('matches by normalized institution name when the domain differs', async () => {
    const { adapter } = createAdapter({
      accounts: [accountRow({ institutionId: 'institution-name' })],
      institutions: [
        {
          id: 'institution-name',
          name: 'Banco BHD, S.A.',
          domain: 'otro.test',
        },
      ],
    });

    await expect(
      adapter.findProductMatches('user-1', [
        lookup({
          institution: { name: 'Banco BHD SA', domain: 'correo.test' },
        }),
      ]),
    ).resolves.toEqual([['account-1']]);
  });

  it('does not match another institution or another suffix', async () => {
    const { adapter } = createAdapter({
      accounts: [
        accountRow({ id: 'account-other-bank', institutionId: 'other-bank' }),
        accountRow({ id: 'account-other-suffix', accountNumberLast4: '9999' }),
      ],
      institutions: [
        BHD,
        { id: 'other-bank', name: 'Banreservas', domain: 'banreservas.com' },
      ],
    });

    await expect(
      adapter.findProductMatches('user-1', [lookup()]),
    ).resolves.toEqual([[]]);
  });

  it('keeps the order of the lookups and the product type apart', async () => {
    const { adapter } = createAdapter({
      accounts: [accountRow()],
      cards: [cardRow()],
    });

    await expect(
      adapter.findProductMatches('user-1', [
        lookup(),
        lookup({ productType: 'CARD', lastFour: '6506' }),
        lookup({ lastFour: '1111' }),
      ]),
    ).resolves.toEqual([['account-1'], ['card-1'], []]);
  });

  it('queries each product type once for every suffix', async () => {
    const { adapter, repo } = createAdapter({
      accounts: [
        accountRow(),
        accountRow({ id: 'account-1111', accountNumberLast4: '1111' }),
      ],
    });

    await adapter.findProductMatches('user-1', [
      lookup(),
      lookup({ lastFour: '1111' }),
    ]);

    expect(repo.findEmailAccountCandidatesByLastFours).toHaveBeenCalledTimes(1);
    expect(repo.findEmailCardCandidatesByLastFours).not.toHaveBeenCalled();
  });

  it('returns no matches without lookups', async () => {
    const { adapter, repo } = createAdapter();

    await expect(adapter.findProductMatches('user-1', [])).resolves.toEqual([]);
    expect(repo.findInstitutionsByUser).not.toHaveBeenCalled();
  });
});

describe('FinanceEmailProductProposalCatalog findProductForLink', () => {
  it('maps an account with its institution', async () => {
    const { adapter } = createAdapter({ linkedAccount: accountRow() });

    await expect(
      adapter.findProductForLink('user-1', 'account-1'),
    ).resolves.toEqual({
      productId: 'account-1',
      productType: 'ACCOUNT',
      lastFour: '0016',
      isActive: true,
      institutionId: 'institution-bhd',
      institutionIsSystem: false,
    });
  });

  it('maps a cash account without an institution', async () => {
    const { adapter } = createAdapter({
      linkedAccount: accountRow({
        institutionId: null,
        institutionRef: { isSystem: true },
        accountNumberLast4: null,
      }),
    });

    const product = await adapter.findProductForLink('user-1', 'account-1');

    expect(product?.institutionId).toBeNull();
    expect(product?.institutionIsSystem).toBe(true);
    expect(product?.lastFour).toBeNull();
  });

  it('maps a card when the id is not an account', async () => {
    const { adapter } = createAdapter({ linkedCard: cardRow() });

    await expect(
      adapter.findProductForLink('user-1', 'card-1'),
    ).resolves.toEqual({
      productId: 'card-1',
      productType: 'CARD',
      lastFour: '6506',
      isActive: true,
      institutionId: 'institution-bhd',
      institutionIsSystem: false,
    });
  });

  it('returns null when the product belongs to someone else', async () => {
    const { adapter } = createAdapter();

    await expect(
      adapter.findProductForLink('user-1', 'missing'),
    ).resolves.toBeNull();
  });
});
