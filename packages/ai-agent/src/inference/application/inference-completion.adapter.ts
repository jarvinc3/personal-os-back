import { Injectable } from '@nestjs/common';
import type {
  InferenceCompletion,
  InferenceCompletionPort,
  InferenceMessage,
  StructuredInference,
  StructuredInferenceRequest,
} from '@personal-os/contracts';
import { AiInferenceGateway } from './ai-inference.gateway';
import { AiService } from './ai.service';

@Injectable()
export class InferenceCompletionAdapter implements InferenceCompletionPort {
  constructor(
    private readonly completion: AiService,
    private readonly gateway: AiInferenceGateway,
  ) {}

  complete(
    messages: readonly InferenceMessage[],
  ): Promise<InferenceCompletion> {
    return this.completion.complete(messages);
  }

  infer<T>(
    request: StructuredInferenceRequest<T>,
  ): Promise<StructuredInference<T>> {
    return this.gateway.infer(request);
  }
}
