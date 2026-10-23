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
  it('turns a single transaction into an entity_card reference', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'get_transaction',
          result: ok({ id: 'tx-1', type: 'DEBIT', amount: '250' }),
        },
      ],
      userText: 'muéstrame ese movimiento',
      baseCurrency,
    });

    expect(blocks).toEqual([
      { type: 'entity_card', ref: { type: 'transaction', id: 'tx-1' } },
    ]);
  });

  it('caps a transaction list and points to the ledger', () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `tx-${index}`,
      amount: '10',
    }));
    const blocks = buildChatBlocks({
      toolResults: [{ toolName: 'list_transactions', result: ok({ items }) }],
      userText: 'mis movimientos',
      baseCurrency,
    });

    expect(blocks).toEqual([
      {
        type: 'entity_list',
        refs: items
          .slice(0, 5)
          .map((item) => ({ type: 'transaction', id: item.id })),
        moreHref: '/finance/transactions',
      },
    ]);
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

    expect(blocks).toEqual([
      {
        type: 'entity_list',
        refs: [{ type: 'budget', id: 'budget-food' }],
        moreHref: '/finance/budgets',
      },
    ]);
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

    const block = blocks[0];
    expect(block.type).toBe('entity_list');
    if (block.type !== 'entity_list') {
      return;
    }
    expect(block.refs[0]).toEqual({ type: 'budget', id: 'budget-high' });
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

    expect(blocks).toEqual([
      {
        type: 'entity_list',
        refs: [{ type: 'budget', id: 'budget-1' }],
        moreHref: '/finance/budgets',
      },
    ]);
  });

  it('lists loan references without copying their data', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'list_loans',
          result: ok({
            items: [
              { id: 'loan-1', lenderName: 'Banco', currentBalance: '50000' },
              { id: 'loan-2', lenderName: 'Cooperativa' },
            ],
          }),
        },
      ],
      userText: 'mis préstamos',
      baseCurrency,
    });

    expect(blocks).toEqual([
      {
        type: 'entity_list',
        refs: [
          { type: 'loan', id: 'loan-1' },
          { type: 'loan', id: 'loan-2' },
        ],
        moreHref: '/finance/loans',
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
        { toolName: 'get_transaction', result: ok({ id: 'tx-1' }) },
        { toolName: 'get_transaction', result: ok({ id: 'tx-1' }) },
      ],
      userText: 'algo',
      baseCurrency,
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('entity_card');
  });

  it('skips a payload without an id instead of inventing a reference', () => {
    const blocks = buildChatBlocks({
      toolResults: [
        {
          toolName: 'get_transaction',
          result: ok({ amount: '10', currency: 'DOP' }),
        },
        {
          toolName: 'list_loans',
          result: ok({ items: [{ lenderName: 'Banco' }] }),
        },
      ],
      userText: 'algo',
      baseCurrency,
    });

    expect(blocks).toEqual([]);
  });
});
