import { buildChatBlocks } from './build-chat-blocks';
import type { ToolExecutionResult } from './ai.types';

function ok(payload: Record<string, unknown>): ToolExecutionResult {
  return { success: true, message: 'ok', data: payload };
}

function failed(): ToolExecutionResult {
  return { success: false, message: 'nope' };
}

const baseCurrency = 'DOP';

describe('buildChatBlocks', () => {
  it('turns a single transaction into a transaction_card', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'get_transaction',
          result: ok({
            id: 'tx-1',
            type: 'DEBIT',
            amount: '250',
            currency: 'DOP',
            transactionDate: '2026-10-14T10:00:00.000Z',
            merchant: 'Café',
            accountName: 'Popular',
            status: 'CONFIRMED',
          }),
        },
      ],
      userText: 'muéstrame ese movimiento',
      baseCurrency,
    });

    expect(blocks).toEqual([
      {
        type: 'transaction_card',
        transactionId: 'tx-1',
        snapshot: {
          id: 'tx-1',
          type: 'DEBIT',
          amount: '250',
          currency: 'DOP',
          transactionDate: '2026-10-14T10:00:00.000Z',
          merchant: 'Café',
          description: null,
          accountName: 'Popular',
          cardName: null,
          status: 'CONFIRMED',
        },
      },
    ]);
  });

  it('caps a transaction list and points to the ledger', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `tx-${index}`,
      type: 'DEBIT',
      amount: '10',
      currency: 'DOP',
      transactionDate: '2026-10-14T10:00:00.000Z',
      status: 'CONFIRMED',
    }));
    const blocks = buildChatBlocks({
      toolResults: [{ toolName: 'list_transactions', result: ok({ items }) }],
      userText: 'mis movimientos',
      baseCurrency,
    });

    const list = blocks[0];
    expect(list.type).toBe('transaction_list');
    if (list.type !== 'transaction_list') {
      return;
    }
    expect(list.items).toHaveLength(5);
    expect(list.moreHref).toBe('/finance/transactions');
  });

  it('picks the budget named in the message', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'get_budget_status',
          result: ok({
            items: [
              {
                id: 'budget-food',
                category: 'Comida',
                amountSpent: '300',
                amountLimit: '1000',
                pctUsed: 30,
              },
              {
                id: 'budget-home',
                category: 'Hogar',
                amountSpent: '900',
                amountLimit: '1000',
                pctUsed: 90,
              },
            ],
          }),
        },
      ],
      userText: '¿Cómo voy con el presupuesto de comida?',
      baseCurrency,
    });

    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.type).toBe('budget_progress');
    if (block.type !== 'budget_progress') {
      return;
    }
    expect(block.budgetId).toBe('budget-food');
    expect(block.spent).toBe('300');
    expect(block.limit).toBe('1000');
    expect(block.currency).toBe('DOP');
  });

  it('falls back to the budgets closest to their limit', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'get_budget_status',
          result: ok({
            items: [
              {
                id: 'budget-low',
                category: 'Comida',
                amountSpent: '10',
                amountLimit: '1000',
                pctUsed: 1,
              },
              {
                id: 'budget-high',
                category: 'Hogar',
                amountSpent: '900',
                amountLimit: '1000',
                pctUsed: 90,
              },
            ],
          }),
        },
      ],
      userText: 'cómo voy',
      baseCurrency,
    });

    const first = blocks[0];
    expect(first.type).toBe('budget_progress');
    if (first.type !== 'budget_progress') {
      return;
    }
    expect(first.budgetId).toBe('budget-high');
  });

  it('builds a loan_summary with the next installment', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'list_loans',
          result: ok({
            items: [
              {
                id: 'loan-1',
                lenderName: 'Banco',
                currentBalance: '50000',
                currency: 'DOP',
                installmentAmount: '4500',
                nextDueDate: '2026-11-01',
                paidInstallments: 3,
              },
            ],
          }),
        },
      ],
      userText: 'mis préstamos',
      baseCurrency,
    });

    expect(blocks).toEqual([
      {
        type: 'loan_summary',
        loanId: 'loan-1',
        balance: '50000',
        currency: 'DOP',
        name: 'Banco',
        nextInstallment: {
          amount: '4500',
          currency: 'DOP',
          dueDate: '2026-11-01',
          installmentNo: 4,
        },
      },
    ]);
  });

  it('builds a donut chart from spending by category', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'get_spending_by_category',
          result: ok({
            items: [
              { categoryId: 'c1', name: 'Comida', color: '#f00', total: '80' },
              { categoryId: 'c2', name: 'Transporte', color: null, total: '0' },
            ],
          }),
        },
      ],
      userText: 'gasto por categoría',
      baseCurrency,
    });

    expect(blocks).toEqual([
      {
        type: 'chart',
        kind: 'donut',
        series: [{ label: 'Comida', value: '80', color: '#f00' }],
        title: 'Gasto por categoría',
        currency: 'DOP',
      },
    ]);
  });

  it('builds a line chart from spending over time', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'get_spending_over_time',
          result: ok({
            points: [
              { date: '2026-10-01', expenses: '10', income: '0' },
              { date: '2026-10-02', expenses: '20', income: '0' },
            ],
          }),
        },
      ],
      userText: 'mi gasto',
      baseCurrency,
    });

    expect(blocks[0]).toMatchObject({ type: 'chart', kind: 'line' });
    if (blocks[0].type !== 'chart') {
      return;
    }
    expect(blocks[0].series).toHaveLength(2);
  });

  it('ignores unknown tools, failed results and duplicates', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        { toolName: 'set_theme', result: ok({ theme: 'dark' }) },
        { toolName: 'get_transaction', result: failed() },
        {
          toolName: 'get_transaction',
          result: ok({
            id: 'tx-1',
            type: 'DEBIT',
            amount: '1',
            currency: 'DOP',
            transactionDate: '2026-10-14T10:00:00.000Z',
            status: 'CONFIRMED',
          }),
        },
        {
          toolName: 'get_transaction',
          result: ok({
            id: 'tx-1',
            type: 'DEBIT',
            amount: '1',
            currency: 'DOP',
            transactionDate: '2026-10-14T10:00:00.000Z',
            status: 'CONFIRMED',
          }),
        },
      ],
      userText: 'algo',
      baseCurrency,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('transaction_card');
  });

  it('skips a malformed transaction instead of inventing values', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'get_transaction',
          result: ok({ id: 'tx-1', amount: '10', currency: 'DOP' }),
        },
      ],
      userText: 'algo',
      baseCurrency,
    });

    expect(blocks).toEqual([]);
  });

  it('derives the budget percentage when the payload omits it', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'get_budget_status',
          result: ok({
            items: [
              {
                id: 'budget-1',
                category: 'Comida',
                amountSpent: '250',
                amountLimit: '1000',
              },
            ],
          }),
        },
      ],
      userText: 'presupuesto',
      baseCurrency,
    });

    const block = blocks[0];
    expect(block.type).toBe('budget_progress');
    if (block.type !== 'budget_progress') {
      return;
    }
    expect(block.pctUsed).toBe(25);
  });

  it('omits the next installment when the loan has no installment number', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'list_loans',
          result: ok({
            items: [
              {
                id: 'loan-1',
                lenderName: 'Banco',
                currentBalance: '50000',
                currency: 'DOP',
                installmentAmount: '4500',
                nextDueDate: '2026-11-01',
              },
            ],
          }),
        },
      ],
      userText: 'mis préstamos',
      baseCurrency,
    });

    expect(blocks).toEqual([
      {
        type: 'loan_summary',
        loanId: 'loan-1',
        balance: '50000',
        currency: 'DOP',
        name: 'Banco',
      },
    ]);
  });
});
