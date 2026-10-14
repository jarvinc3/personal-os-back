import {
  getActionLabel,
  getToolDefinition,
  getToolsForModule,
  parseToolCallArguments,
  parseToolCallArgumentsStrict,
} from './tool.registry';

describe('tool.registry', () => {
  it('returns general tools by default', () => {
    const tools = getToolsForModule(null);
    expect(tools.some((t) => t.name === 'set_theme')).toBe(true);
  });

  it('labels theme actions', () => {
    expect(getActionLabel('set_theme', { value: 'dark' })).toContain('dark');
  });

  it('labels user context reads', () => {
    expect(getActionLabel('get_user_context', {})).toBe(
      'Consultar contexto del usuario',
    );
  });

  it('scopes agenda module tools', () => {
    const agendaTools = getToolsForModule('agenda');
    expect(agendaTools.some((t) => t.name === 'update_module_config')).toBe(
      true,
    );
    expect(agendaTools.some((t) => t.name === 'set_theme')).toBe(false);
  });

  it('derives mutating tool parameters from Zod schemas', () => {
    const theme = getToolDefinition('set_theme');
    expect(theme?.parameters).toMatchObject({
      type: 'object',
      properties: {
        value: { type: 'string', enum: ['system', 'light', 'dark'] },
      },
    });
  });

  it('exposes unconfirm_transaction as a mutating finance tool', () => {
    const unconfirm = getToolDefinition('unconfirm_transaction');
    expect(unconfirm).toMatchObject({
      mutating: true,
      targetModule: 'finance',
      parameters: {
        type: 'object',
        properties: { transactionId: { type: 'string' } },
      },
    });
  });

  it('exposes reconcile_product as a mutating finance tool from its schema', () => {
    const reconcile = getToolDefinition('reconcile_product');
    expect(reconcile).toMatchObject({
      mutating: true,
      targetModule: 'finance',
      parameters: {
        type: 'object',
        required: ['realBalance'],
        properties: {
          realBalance: { type: 'number' },
          apply: { type: 'boolean' },
          adjustments: {
            type: 'array',
            items: {
              properties: {
                kind: {
                  enum: [
                    'IMPUESTO_DGII',
                    'COMISION',
                    'CARGO_PLASTICO',
                    'INTERES',
                    'OTRO',
                  ],
                },
              },
            },
          },
        },
      },
    });
  });

  it('exposes get_bank_charges as a read-only finance tool', () => {
    const charges = getToolDefinition('get_bank_charges');
    expect(charges).toMatchObject({
      mutating: false,
      targetModule: 'finance',
      parameters: {
        type: 'object',
        properties: { groupBy: { enum: ['month', 'institution', 'kind'] } },
      },
    });
  });

  it('labels the transaction unlock action', () => {
    expect(getActionLabel('unconfirm_transaction', {})).toBe(
      'Desbloquear transacción',
    );
  });

  it('fails closed on invalid tool argument JSON', () => {
    expect(parseToolCallArgumentsStrict('{')).toEqual({
      ok: false,
      message: 'Tool arguments are not valid JSON',
    });
    expect(parseToolCallArguments('{')).toEqual({
      __parseError: 'Tool arguments are not valid JSON',
    });
    expect(parseToolCallArgumentsStrict('[]')).toMatchObject({ ok: false });
    expect(parseToolCallArgumentsStrict('{"value":"dark"}')).toEqual({
      ok: true,
      args: { value: 'dark' },
    });
  });
});
