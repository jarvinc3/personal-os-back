import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { AuthDeletionOutboxProcessor } from './application/auth-deletion-outbox.processor';
import { UsersService } from './application/users.service';
import { UsersRepository } from './infrastructure/users.repository';
import { UsersController } from './presentation/users.controller';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService, AuthDeletionOutboxProcessor],
  exports: [UsersRepository, UsersService],
})
export class UsersModule {}
