import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class ViewSuggestionDataService {
  constructor(private readonly prisma: PrismaService) {}

  countForUser(userId: string): Promise<number> {
    return this.prisma.aiViewSuggestion.count({ where: { userId } });
  }

  async wipeForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.aiViewSuggestion.deleteMany({
      where: { userId },
    });
    return count;
  }
}
