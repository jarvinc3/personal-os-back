import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QueueNames, type StatementImportJob } from '@personal-os/core';
import { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import { CreateTransactionUseCase } from '../../ledger/application/create-transaction.use-case';
import { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import { roundMoney } from '../../shared/domain/money';
import { STATEMENT_IMPORT_ERROR } from '../domain/statement-import-errors';
import {
  readParsedStatement,
  type StatementImportParsed,
} from '../domain/statement-import-view';
import { CardStatementsRepository } from '../infrastructure/card-statements.repository';
import {
  StatementImportsRepository,
  type StatementImportContext,
} from '../infrastructure/statement-imports.repository';
import {
  STATEMENT_UPLOAD_STORE,
  type StatementUploadStore,
} from '../infrastructure/temp-file-statement-upload.store';
import {
  STATEMENT_PDF_TEXT,
  StatementPasswordError,
  type StatementPdfTextPort,
} from './ports/statement-pdf.port';
import { ProcessStatementImportUseCase } from './process-statement-import.use-case';
import {
  mapStatementImport,
  type StatementImportView,
} from './statement-import-mappers';
import {
  STATEMENT_IMPORT_JOB_NAME,
  STATEMENT_IMPORT_JOB_OPTIONS,
} from './statement-import.constants';

export type StatementUploadFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

const FILE_REQUIRED_MESSAGE = 'Archivo obligatorio';
const NOT_FOUND_MESSAGE = 'Statement import not found';
const NOT_READY_MESSAGE = 'Statement import is not ready';

@Injectable()
export class StatementImportsService {
  constructor(
    private readonly repo: StatementImportsRepository,
    private readonly ownership: FinanceOwnershipService,
    private readonly processImport: ProcessStatementImportUseCase,
    private readonly createTransaction: CreateTransactionUseCase,
    private readonly adjustBalance: AdjustBalanceUseCase,
    private readonly cardStatements: CardStatementsRepository,
    @Inject(STATEMENT_PDF_TEXT)
    private readonly pdfText: StatementPdfTextPort,
    @Inject(STATEMENT_UPLOAD_STORE)
    private readonly uploads: StatementUploadStore,
    @Optional()
    @InjectQueue(QueueNames.STATEMENT_IMPORT)
    private readonly queue?: Queue<StatementImportJob>,
  ) {}

  async createFromUpload(input: {
    userId: string;
    cardId: string | null;
    accountId: string | null;
    file: StatementUploadFile | undefined;
    password?: string;
  }): Promise<{ importId: string }> {
    if (!input.file || input.file.buffer.length === 0) {
      throw new BadRequestException(FILE_REQUIRED_MESSAGE);
    }
    if (input.cardId) {
      await this.ownership.assertCardOwned(input.userId, input.cardId);
    } else if (input.accountId) {
      await this.ownership.assertAccountOwned(input.userId, input.accountId);
    } else {
      throw new BadRequestException('A statement import needs a target');
    }

    const bytes = new Uint8Array(input.file.buffer);
    await this.assertPasswordAccepted(bytes, input.password);

    const row = await this.repo.createImport({
      userId: input.userId,
      cardId: input.cardId,
      accountId: input.accountId,
    });
    if (this.queue) {
      const filePath = await this.uploads.save({ importId: row.id, bytes });
      await this.queue.add(
        STATEMENT_IMPORT_JOB_NAME,
        {
          userId: input.userId,
          importId: row.id,
          filePath,
          ...(input.password ? { password: input.password } : {}),
        },
        STATEMENT_IMPORT_JOB_OPTIONS,
      );
      return { importId: row.id };
    }

    await this.processImport.execute({
      userId: input.userId,
      importId: row.id,
      bytes,
      password: input.password,
    });
    return { importId: row.id };
  }

  async getImport(
    userId: string,
    importId: string,
  ): Promise<StatementImportView> {
    const context = await this.loadContext(userId, importId);
    return this.toView(context);
  }

  async updateLine(input: {
    userId: string;
    importId: string;
    lineId: string;
    decision: 'MATCH' | 'CREATE' | 'IGNORE';
    transactionId?: string | null;
  }): Promise<StatementImportView> {
    const context = await this.loadContext(input.userId, input.importId);
    if (context.status !== 'READY') {
      throw new ConflictException({
        message: NOT_READY_MESSAGE,
        code: STATEMENT_IMPORT_ERROR.ALREADY_APPLIED,
      });
    }
    const line = context.lines.find((entry) => entry.id === input.lineId);
    if (!line) {
      throw new NotFoundException('Statement line not found');
    }
    const transactionId =
      input.decision === 'MATCH'
        ? (input.transactionId ?? line.transactionId)
        : null;
    if (input.decision === 'MATCH' && !transactionId) {
      throw new BadRequestException('A match requires a transaction');
    }
    const updated = await this.repo.updateLine({
      importId: input.importId,
      lineId: input.lineId,
      decision: input.decision,
      transactionId,
    });
    if (updated === 0) {
      throw new NotFoundException('Statement line not found');
    }
    return this.getImport(input.userId, input.importId);
  }

  async apply(input: {
    userId: string;
    importId: string;
    adjust: boolean;
  }): Promise<StatementImportView> {
    const context = await this.loadContext(input.userId, input.importId);
    if (context.status === 'DISCARDED') {
      throw new ConflictException({
        message: 'Statement import was discarded',
        code: STATEMENT_IMPORT_ERROR.DISCARDED,
      });
    }
    if (context.status === 'PARSING' || context.status === 'FAILED') {
      throw new ConflictException({
        message: NOT_READY_MESSAGE,
        code: STATEMENT_IMPORT_ERROR.PARSE_FAILED,
      });
    }

    if (context.status !== 'APPLIED') {
      await this.createMissingTransactions(context);
      const parsed = readParsedStatement(context.parsed);
      if (input.adjust) {
        await this.applyAdjustment(context, parsed);
      }
      const statementId = await this.syncCardStatement(context, parsed);
      await this.repo.markApplied({ importId: context.id, statementId });
    }
    return this.getImport(input.userId, input.importId);
  }

  async discard(userId: string, importId: string): Promise<void> {
    const context = await this.loadContext(userId, importId);
    if (context.status === 'APPLIED') {
      throw new ConflictException({
        message: 'Statement import is already applied',
        code: STATEMENT_IMPORT_ERROR.ALREADY_APPLIED,
      });
    }
    await this.repo.updateResult({
      importId,
      status: 'DISCARDED',
      error: null,
    });
  }

  private async assertPasswordAccepted(
    bytes: Uint8Array,
    password: string | undefined,
  ): Promise<void> {
    try {
      await this.pdfText.assertReadable({ bytes, password });
    } catch (error) {
      if (error instanceof StatementPasswordError) {
        throw new BadRequestException({
          message: 'The statement PDF needs its password',
          code: STATEMENT_IMPORT_ERROR.PASSWORD_REQUIRED,
        });
      }
      throw error;
    }
  }

  private async loadContext(
    userId: string,
    importId: string,
  ): Promise<StatementImportContext> {
    const context = await this.repo.findImportContext(userId, importId);
    if (!context) {
      throw new NotFoundException(NOT_FOUND_MESSAGE);
    }
    return context;
  }

  private async toView(
    context: StatementImportContext,
  ): Promise<StatementImportView> {
    const parsed = readParsedStatement(context.parsed);
    const categories = await this.repo.listCategories(context.userId);
    const difference = await this.computeDifference(context, parsed);
    return mapStatementImport({ context, parsed, difference, categories });
  }

  private async computeDifference(
    context: StatementImportContext,
    parsed: StatementImportParsed,
  ): Promise<number | null> {
    const closing = parsed.header.closingBalance;
    if (closing === null) {
      return null;
    }
    const target = await this.repo.findTargetBalance({
      userId: context.userId,
      cardId: context.cardId,
      accountId: context.accountId,
      currency: parsed.header.currency,
    });
    if (!target) {
      return null;
    }
    const current =
      target.creditLimit === null
        ? target.currentBalance
        : target.creditLimit - target.currentBalance;
    return roundMoney(closing - current);
  }

  private async createMissingTransactions(
    context: StatementImportContext,
  ): Promise<void> {
    for (const line of context.lines) {
      if (line.decision !== 'CREATE' || line.transactionId) {
        continue;
      }
      const created = await this.createTransaction.execute(
        context.userId,
        {
          ...(context.cardId
            ? { cardId: context.cardId }
            : { accountId: context.accountId ?? undefined }),
          type: line.type,
          amount: Number(line.amount),
          currency: line.currency,
          transactionDate: line.date.toISOString(),
          merchant: line.description,
          description: line.description,
          ...(line.categoryId ? { categoryId: line.categoryId } : {}),
          status: 'CONFIRMED',
        },
        'MANUAL',
      );
      await this.repo.linkLineTransaction(line.id, created.id);
    }
  }

  private async applyAdjustment(
    context: StatementImportContext,
    parsed: StatementImportParsed,
  ): Promise<void> {
    const closing = parsed.header.closingBalance;
    if (closing === null) {
      return;
    }
    if (context.accountId) {
      await this.adjustBalance.execute(context.userId, {
        accountId: context.accountId,
        balance: closing,
      });
      return;
    }
    if (!context.cardId) {
      return;
    }
    const target = await this.repo.findTargetBalance({
      userId: context.userId,
      cardId: context.cardId,
      accountId: null,
      currency: parsed.header.currency,
    });
    if (!target || target.creditLimit === null) {
      return;
    }
    await this.adjustBalance.execute(context.userId, {
      cardId: context.cardId,
      currency: parsed.header.currency,
      balance: roundMoney(target.creditLimit - closing),
    });
  }

  private async syncCardStatement(
    context: StatementImportContext,
    parsed: StatementImportParsed,
  ): Promise<string | null> {
    if (!context.cardId || !parsed.period) {
      return null;
    }
    return this.cardStatements.upsertStatement({
      cardId: context.cardId,
      currency: parsed.header.currency,
      cycleStart: new Date(parsed.period.from),
      cycleEnd: new Date(parsed.period.to),
      dueDate: parsed.header.dueDate ? new Date(parsed.header.dueDate) : null,
      closingBalance: parsed.header.closingBalance ?? 0,
      minimumPayment: parsed.header.minimumPayment ?? 0,
      minimumSource: parsed.header.minimumPayment === null ? null : 'IMPORTED',
      status: 'CLOSED',
    });
  }
}
