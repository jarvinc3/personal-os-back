/**
 * Selectable data layers for the self-service wipe.
 * IDs are part of the HTTP and UI contract; keep them stable.
 */
export const WIPE_LAYERS = {
  FINANCE_LEDGER: 'finance.ledger',
  FINANCE_BALANCES: 'finance.balances',
  FINANCE_PLANNING: 'finance.planning',
  FINANCE_CATEGORIES: 'finance.categories',
  FINANCE_CATALOG: 'finance.catalog',
  FINANCE_EMAIL_CONNECTIONS: 'finance.emailConnections',
  AI_SESSIONS: 'ai.sessions',
  NOTIFICATIONS: 'notifications',
  SETTINGS_DEFAULTS: 'settings.defaults',
} as const;

export type WipeLayerId = (typeof WIPE_LAYERS)[keyof typeof WIPE_LAYERS];

export const WIPE_LAYER_IDS = Object.values(WIPE_LAYERS) as WipeLayerId[];

export function isWipeLayerId(value: string): value is WipeLayerId {
  return (WIPE_LAYER_IDS as readonly string[]).includes(value);
}

/**
 * Wiping the catalog or the categories also empties what depends on them,
 * so the server applies the dependency instead of failing on a foreign key.
 */
const WIPE_LAYER_DEPENDENCIES: Record<WipeLayerId, readonly WipeLayerId[]> = {
  [WIPE_LAYERS.FINANCE_LEDGER]: [],
  [WIPE_LAYERS.FINANCE_BALANCES]: [],
  [WIPE_LAYERS.FINANCE_PLANNING]: [],
  [WIPE_LAYERS.FINANCE_CATEGORIES]: [WIPE_LAYERS.FINANCE_PLANNING],
  [WIPE_LAYERS.FINANCE_CATALOG]: [WIPE_LAYERS.FINANCE_LEDGER],
  [WIPE_LAYERS.FINANCE_EMAIL_CONNECTIONS]: [],
  [WIPE_LAYERS.AI_SESSIONS]: [],
  [WIPE_LAYERS.NOTIFICATIONS]: [],
  [WIPE_LAYERS.SETTINGS_DEFAULTS]: [],
};

/** Order the domains must run in: instruments before the rows they own. */
export const WIPE_EXECUTION_ORDER: readonly WipeLayerId[] = [
  WIPE_LAYERS.FINANCE_LEDGER,
  WIPE_LAYERS.FINANCE_BALANCES,
  WIPE_LAYERS.FINANCE_PLANNING,
  WIPE_LAYERS.FINANCE_CATEGORIES,
  WIPE_LAYERS.FINANCE_CATALOG,
  WIPE_LAYERS.FINANCE_EMAIL_CONNECTIONS,
  WIPE_LAYERS.AI_SESSIONS,
  WIPE_LAYERS.NOTIFICATIONS,
  WIPE_LAYERS.SETTINGS_DEFAULTS,
];

export function sortWipeLayers(layers: readonly WipeLayerId[]): WipeLayerId[] {
  const selected = new Set(layers);
  return WIPE_EXECUTION_ORDER.filter((layer) => selected.has(layer));
}

export function expandWipeLayers(
  requested: readonly WipeLayerId[],
): WipeLayerId[] {
  const expanded = new Set<WipeLayerId>(requested);
  for (const layer of requested) {
    for (const dependency of WIPE_LAYER_DEPENDENCIES[layer]) {
      expanded.add(dependency);
    }
  }
  return sortWipeLayers([...expanded]);
}
