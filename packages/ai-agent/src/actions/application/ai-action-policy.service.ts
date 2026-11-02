import { Injectable } from '@nestjs/common';
import type {
  AiActionPolicy,
  AiCapabilityDescriptor,
} from '@personal-os/contracts';

@Injectable()
export class AiActionPolicyService {
  decide(capability: AiCapabilityDescriptor): AiActionPolicy {
    if (capability.effect !== 'WRITE') {
      return 'AUTO_ALLOWED';
    }
    return capability.actionPolicy ?? 'FORBIDDEN';
  }
}
