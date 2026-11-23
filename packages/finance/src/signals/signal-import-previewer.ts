import { Injectable } from '@nestjs/common';
import type { RoutedSignal, SignalImportPreview } from '@personal-os/contracts';
import { SignalImportPlanner } from './signal-import-planner';
import { SignalImportPreviewReader } from './signal-import-preview';

/** Read-only view of an import: the plan plus its review reasons. */
@Injectable()
export class SignalImportPreviewer {
  constructor(
    private readonly planner: SignalImportPlanner,
    private readonly previewReader: SignalImportPreviewReader,
  ) {}

  async preview(signal: RoutedSignal): Promise<SignalImportPreview> {
    const plan = await this.planner.build({ signal });
    return this.previewReader.describe({ signal, plan });
  }
}
