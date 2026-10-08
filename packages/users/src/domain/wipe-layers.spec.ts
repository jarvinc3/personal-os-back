import {
  expandWipeLayers,
  isWipeLayerId,
  sortWipeLayers,
  WIPE_LAYERS,
  WIPE_LAYER_IDS,
} from './wipe-layers';

describe('isWipeLayerId', () => {
  it('accepts every declared layer', () => {
    for (const layer of WIPE_LAYER_IDS) {
      expect(isWipeLayerId(layer)).toBe(true);
    }
  });

  it('rejects unknown layers', () => {
    expect(isWipeLayerId('finance.unknown')).toBe(false);
  });
});

describe('expandWipeLayers', () => {
  it('adds the ledger when the catalog is requested', () => {
    expect(expandWipeLayers([WIPE_LAYERS.FINANCE_CATALOG])).toEqual([
      WIPE_LAYERS.FINANCE_LEDGER,
      WIPE_LAYERS.FINANCE_CATALOG,
    ]);
  });

  it('adds planning when categories are requested', () => {
    expect(expandWipeLayers([WIPE_LAYERS.FINANCE_CATEGORIES])).toEqual([
      WIPE_LAYERS.FINANCE_PLANNING,
      WIPE_LAYERS.FINANCE_CATEGORIES,
    ]);
  });

  it('keeps independent layers unchanged and deduplicated', () => {
    expect(
      expandWipeLayers([
        WIPE_LAYERS.AI_SESSIONS,
        WIPE_LAYERS.AI_SESSIONS,
        WIPE_LAYERS.NOTIFICATIONS,
      ]),
    ).toEqual([WIPE_LAYERS.AI_SESSIONS, WIPE_LAYERS.NOTIFICATIONS]);
  });

  it('does not drop an explicitly requested layer', () => {
    expect(
      expandWipeLayers([WIPE_LAYERS.FINANCE_LEDGER, WIPE_LAYERS.AI_SESSIONS]),
    ).toEqual([WIPE_LAYERS.FINANCE_LEDGER, WIPE_LAYERS.AI_SESSIONS]);
  });
});

describe('sortWipeLayers', () => {
  it('orders by execution order regardless of input order', () => {
    expect(
      sortWipeLayers([
        WIPE_LAYERS.SETTINGS_DEFAULTS,
        WIPE_LAYERS.FINANCE_CATALOG,
        WIPE_LAYERS.FINANCE_LEDGER,
      ]),
    ).toEqual([
      WIPE_LAYERS.FINANCE_LEDGER,
      WIPE_LAYERS.FINANCE_CATALOG,
      WIPE_LAYERS.SETTINGS_DEFAULTS,
    ]);
  });
});
