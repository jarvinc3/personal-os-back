import { WIPE_LAYER_IDS, type WipeLayerId } from '@personal-os/users';

/** Finance layers the wipe orchestrator can ask this package to apply. */
export type FinanceWipeLayer = Extract<WipeLayerId, `finance.${string}`>;

export const FINANCE_WIPE_LAYERS = WIPE_LAYER_IDS.filter(
  (layer): layer is FinanceWipeLayer => layer.startsWith('finance.'),
);

export function isFinanceWipeLayer(
  layer: WipeLayerId,
): layer is FinanceWipeLayer {
  return (FINANCE_WIPE_LAYERS as readonly string[]).includes(layer);
}
