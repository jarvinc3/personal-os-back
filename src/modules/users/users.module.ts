import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthDeletionOutboxProcessor } from './auth-deletion-outbox.processor';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService, AuthDeletionOutboxProcessor],
  exports: [UsersRepository, UsersService],
})
export class UsersModule {}
