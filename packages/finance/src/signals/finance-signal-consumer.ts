import { Injectable } from '@nestjs/common';
import type { RoutedSignal, SignalImportPreview } from '@personal-os/contracts';
import type { FinanceSignalConsumerPort } from '../contracts';
import type {
  ImportResolutionOverride,
  SignalConsumeResult,
} from './signal-import-plan';
import { SignalImportPreviewer } from './signal-import-previewer';
import { SignalImportRunner } from './signal-import-runner';

export type { ImportResolutionOverride } from './signal-import-plan';

type ImportResolution = {
  signal: RoutedSignal;
  override: ImportResolutionOverride;
};

/**
 * Finance turns its own signals into ledger writes. The preview is read-only;
 * the import holds the user lock when a retryable review is pending.
 */
@Injectable()
export class FinanceSignalConsumer implements FinanceSignalConsumerPort {
  readonly domain = 'FINANCE';

  constructor(
    private readonly previewer: SignalImportPreviewer,
    private readonly runner: SignalImportRunner,
  ) {}

  consume(signal: RoutedSignal): Promise<SignalConsumeResult> {
    return this.runner.consume(signal);
  }

  /**
   * Reaplica un import en revisión con la decisión de una persona. El override
   * no salta validaciones: el plan vuelve a comprobar destino, referencia,
   * moneda y monto, y si algo no cuadra el import sigue en revisión. Quien
   * llama ya tiene el bloqueo por usuario del import.
   */
  consumeResolved({
    signal,
    override,
  }: ImportResolution): Promise<SignalConsumeResult> {
    return this.runner.consumeResolved({ signal, override });
  }

  /** Igual que `consume`, pero sin escribir ni señales ni ledger. */
  preview(signal: RoutedSignal): Promise<SignalImportPreview> {
    return this.previewer.preview(signal);
  }
}
