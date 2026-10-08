import { Global, Module } from '@nestjs/common';
import { AuthModule } from '@personal-os/auth';
import { USERS_REPOSITORY } from './application/ports/users.repository.port';
import { AuthDeletionOutboxProcessor } from './application/auth-deletion-outbox.processor';
import { UsersService } from './application/users.service';
import { WipeUserDataUseCase } from './application/wipe-user-data.use-case';
import { UsersRepository } from './infrastructure/users.repository';
import { UsersController } from './presentation/users.controller';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [
    UsersRepository,
    {
      provide: USERS_REPOSITORY,
      useExisting: UsersRepository,
    },
    UsersService,
    WipeUserDataUseCase,
    AuthDeletionOutboxProcessor,
  ],
  exports: [USERS_REPOSITORY, UsersService],
})
export class UsersModule {}
