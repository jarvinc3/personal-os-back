import { FinanceEvents } from '../../contracts';
import { CardPaymentRemindersService } from './card-payment-reminders.service';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function dueStatement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'st-1',
    cardId: 'card-1',
    currency: 'DOP',
    cycleStart: day('2026-01-01'),
    cycleEnd: day('2026-01-31'),
    dueDate: day('2026-02-15'),
    closingBalance: 12000,
    minimumPayment: 400,
    minimumSource: 'ESTIMATED',
    status: 'CLOSED',
    card: { id: 'card-1', name: 'Visa', lastFour: '1234' },
    ...overrides,
  };
}

const payment = {
  type: 'CARD_PAYMENT',
  status: 'CONFIRMED',
  ledgerAmount: 12000,
  ledgerCurrency: 'DOP',
  transactionDate: day('2026-02-05'),
};

function build(
  options: {
    hasEvent?: boolean;
    paid?: boolean;
    cardDueDaysBefore?: number;
    timezone?: string;
  } = {},
) {
  const repo = {
    listDueStatements: jest.fn().mockResolvedValue([dueStatement()]),
    findCreditCard: jest.fn().mockResolvedValue({
      id: 'card-1',
      balances: [{ currency: 'DOP', balance: 38000, creditLimit: 50000 }],
      transactions: options.paid ? [payment] : [],
    }),
  };
  const users = {
    findById: jest.fn().mockResolvedValue({
      timezone: options.timezone ?? 'UTC',
      userModules: [
        {
          slug: 'finance',
          config: {
            reminders: {
              cardDueDaysBefore: options.cardDueDaysBefore ?? 3,
            },
          },
        },
      ],
    }),
  };
  const events = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const outbox = {
    hasEvent: jest.fn().mockResolvedValue(options.hasEvent ?? false),
  };
  const dispatcher = { wake: jest.fn().mockResolvedValue(0) };

  const service = new CardPaymentRemindersService(
    repo as never,
    users as never,
    events,
    outbox,
    dispatcher,
  );

  return { service, repo, events };
}

describe('CardPaymentRemindersService', () => {
  const now = day('2026-02-12');

  it('raises one payment-due event for an unpaid statement in the window', async () => {
    const { service, events } = build();

    await service.evaluate('user-1', now);

    expect(events.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'finance-card-payment-due:st-1:2026-02-15',
        eventName: FinanceEvents.CARD_PAYMENT_DUE,
        payload: expect.objectContaining({
          cardId: 'card-1',
          statementId: 'st-1',
          currency: 'DOP',
          remaining: 12000,
          dueDate: '2026-02-15',
          daysUntil: 3,
        }),
      }),
    );
  });

  it('stays quiet when the statement is already paid', async () => {
    const { service, events } = build({ paid: true });

    await service.evaluate('user-1', now);

    expect(events.enqueue).not.toHaveBeenCalled();
  });

  it('does not repeat an event already in the outbox', async () => {
    const { service, events } = build({ hasEvent: true });

    await service.evaluate('user-1', now);

    expect(events.enqueue).not.toHaveBeenCalled();
  });

  it('queries the repository with the configured day window', async () => {
    const { service, repo } = build({ cardDueDaysBefore: 0 });

    await service.evaluate('user-1', now);

    expect(repo.listDueStatements).toHaveBeenCalledWith({
      userId: 'user-1',
      from: day('2026-02-12'),
      to: day('2026-02-12'),
    });
  });

  it('uses the user local date for the reminder window', async () => {
    const { service, repo } = build({ timezone: 'America/Santo_Domingo' });

    await service.evaluate('user-1', new Date('2026-02-12T02:00:00.000Z'));

    expect(repo.listDueStatements).toHaveBeenCalledWith({
      userId: 'user-1',
      from: day('2026-02-11'),
      to: day('2026-02-14'),
    });
  });
});
