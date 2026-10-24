import { Injectable } from '@nestjs/common';
import type { DataBranchDescriptor } from '@personal-os/users';
import { PrismaService } from '@personal-os/database';
import { DATA_APP } from '@personal-os/users';

export const AI_DATA_BRANCHES: readonly DataBranchDescriptor[] = [
  {
    id: 'ai.inferences',
    app: DATA_APP.AI,
    label: 'Historial de uso de IA',
    includes: [],
    order: 1,
  },
];

@Injectable()
export class AiInferenceDataService {
  constructor(private readonly prisma: PrismaService) {}

  async countForUser(userId: string): Promise<number> {
    return this.prisma.aiInference.count({ where: { userId } });
  }

  async wipeForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.aiInference.deleteMany({
      where: { userId },
    });
    return count;
  }
}
