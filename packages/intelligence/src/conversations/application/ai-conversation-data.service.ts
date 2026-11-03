import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class AiConversationDataService {
  constructor(private readonly prisma: PrismaService) {}

  countForUser(userId: string): Promise<number> {
    return this.prisma.aiConversation.count({ where: { userId } });
  }

  async wipeForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.aiConversation.deleteMany({
      where: { userId },
    });
    return count;
  }
}
