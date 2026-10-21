import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from '@personal-os/users';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { EmailSourceRepository } from '../infrastructure/email-source.repository';
import type { ConnectEmailSourceDto } from '../presentation/dto/connect-email-source.dto';
import type { UpdateEmailSourceDto } from '../presentation/dto/update-email-source.dto';
import {
  mapEmailSourceResponse,
  resolveSenderFields,
} from './email-source-view';
import { GmailSyncQueueService } from './gmail-sync-queue.service';

/** Mailboxes and the bank sources linked to each of them. */
@Injectable()
export class EmailSourceService {
  constructor(
    private readonly repo: EmailSourceRepository,
    private readonly users: UsersService,
    private readonly ownership: FinanceOwnershipService,
    private readonly gmailSyncQueue: GmailSyncQueueService,
  ) {}

  listEmailSources(userId: string) {
    return this.repo
      .listEmailSources(userId)
      .then((sources) =>
        sources.map((source) => mapEmailSourceResponse(source)),
      );
  }

  async listMailboxes(userId: string) {
    const rows = await this.repo.listMailboxes(userId);
    return rows.map((row) => ({
      id: row.id,
      emailAddress: row.emailAddress,
      provider: row.provider,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      sources: row.sources.map((source) => mapEmailSourceResponse(source)),
    }));
  }

  async deactivateMailbox(userId: string, id: string) {
    const updated = await this.repo.deactivateMailbox(userId, id);
    if (!updated) {
      throw new NotFoundException('Buzón no encontrado');
    }
    return { success: true };
  }

  async createEmailSource(userId: string, dto: ConnectEmailSourceDto) {
    await this.users.assertFinanceEmailSyncEnabled(userId);
    await this.ownership.assertInstitutionAcceptsBankProducts(
      userId,
      dto.institutionId,
    );

    const connection = await this.repo.findConnectionByUserEmail(
      userId,
      'gmail',
      dto.emailAddress,
    );
    if (!connection) {
      throw new NotFoundException('Conecta Gmail antes de vincular un banco');
    }
    if (!connection.refreshToken) {
      throw new BadRequestException('Conecta Gmail primero');
    }

    const sender = resolveSenderFields({
      bankSenderEmail: dto.bankSenderEmail,
      bankSenderEmails: dto.bankSenderEmails,
      bankDomain: dto.bankDomain,
    });
    return this.upsertInstitutionSource(userId, {
      connectionId: connection.id,
      institutionId: dto.institutionId,
      bankSenderEmails: sender.bankSenderEmails,
      bankDomain: sender.bankDomain,
      label: dto.label,
    });
  }

  async updateEmailSource(
    userId: string,
    id: string,
    dto: UpdateEmailSourceDto,
  ) {
    const existing = await this.repo.findEmailSource(userId, id);
    if (!existing) {
      throw new NotFoundException('Origen de correo no encontrado');
    }

    if (dto.institutionId) {
      await this.ownership.assertInstitutionAcceptsBankProducts(
        userId,
        dto.institutionId,
      );
      const linked = await this.repo.findSourceByUserAndInstitution(
        userId,
        dto.institutionId,
      );
      if (linked && linked.id !== id && linked.isActive) {
        throw new ConflictException(
          'This institution is already linked to a mailbox',
        );
      }
    }

    const patch: Record<string, unknown> = {};
    if (dto.institutionId !== undefined) {
      patch.institutionId = dto.institutionId;
    }
    if (dto.label !== undefined) {
      patch.label = dto.label;
    }
    if (
      dto.bankSenderEmail !== undefined ||
      dto.bankSenderEmails !== undefined
    ) {
      const sender = resolveSenderFields({
        bankSenderEmail: dto.bankSenderEmail,
        bankSenderEmails: dto.bankSenderEmails,
        bankDomain: dto.bankDomain ?? existing.bankDomain,
      });
      patch.bankSenderEmails = sender.bankSenderEmails;
      patch.bankDomain = sender.bankDomain;
    } else if (dto.bankDomain !== undefined) {
      patch.bankDomain = dto.bankDomain.trim();
    }

    const updated = await this.repo.updateEmailSource(userId, id, patch);
    if (!updated) {
      throw new NotFoundException('Origen de correo no encontrado');
    }
    return mapEmailSourceResponse(updated);
  }

  async deactivateEmailSource(userId: string, id: string) {
    const updated = await this.repo.updateEmailSource(userId, id, {
      isActive: false,
    });
    if (!updated) {
      throw new NotFoundException('Origen de correo no encontrado');
    }
    return { success: true };
  }

  /** Links an institution to a mailbox, creating or reactivating the source. */
  async upsertInstitutionSource(
    userId: string,
    input: {
      connectionId: string;
      institutionId: string;
      bankSenderEmails: string[];
      bankDomain: string;
      label?: string;
    },
  ) {
    const existing = await this.repo.findSourceByUserAndInstitution(
      userId,
      input.institutionId,
    );
    if (existing?.isActive && existing.connectionId !== input.connectionId) {
      throw new ConflictException(
        'This institution is already linked to a mailbox',
      );
    }
    if (existing) {
      const updated = await this.repo.updateEmailSource(userId, existing.id, {
        connectionId: input.connectionId,
        bankSenderEmails: input.bankSenderEmails,
        bankDomain: input.bankDomain,
        ...(input.label !== undefined ? { label: input.label } : {}),
        isActive: true,
      });
      const mapped = mapEmailSourceResponse(updated ?? existing);
      if (await this.users.isFinanceEmailSyncAutomatic(userId)) {
        await this.gmailSyncQueue.enqueue(userId, mapped.id);
      }
      return mapped;
    }

    const created = await this.repo.createEmailSource(userId, {
      connectionId: input.connectionId,
      institutionId: input.institutionId,
      bankSenderEmails: input.bankSenderEmails,
      bankDomain: input.bankDomain,
      label: input.label,
      isActive: true,
    });
    const mapped = mapEmailSourceResponse(created);
    if (await this.users.isFinanceEmailSyncAutomatic(userId)) {
      await this.gmailSyncQueue.enqueue(userId, mapped.id);
    }
    return mapped;
  }
}
