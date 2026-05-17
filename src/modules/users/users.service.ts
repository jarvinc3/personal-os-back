import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findById(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.findById(userId);

    return this.usersRepository.updateProfile(userId, {
      fullName: dto.fullName,
      timezone: dto.timezone,
      locale: dto.locale,
      avatarUrl: dto.avatarUrl,
      preferences: dto.preferences,
    });
  }
}
