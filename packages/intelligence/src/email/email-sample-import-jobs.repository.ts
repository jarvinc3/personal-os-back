import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import type { $Enums, Prisma } from '@personal-os/database';

export const SAMPLE_IMPORT_JOB_SELECT = {
  id: true,
  userId: true,
  dryRun: true,
  status: true,
  selectionMode: true,
  messageIds: true,
  sender: true,
  dateFrom: true,
  dateTo: true,
  total: true,
  processed: true,
  result: true,
  error: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} satisfies Prisma.AiEmailSampleImportSelect;

export type SampleImportJobRow = Prisma.AiEmailSampleImportGetPayload<{
  select: typeof SAMPLE_IMPORT_JOB_SELECT;
}>;

export type SampleImportStatus = $Enums.AiEmailSampleImportStatus;
export type SampleImportSelectionMode = $Enums.AiEmailSampleImportSelection;

export type NewSampleImportJob = {
  userId: string;
  dryRun: boolean;
  selectionMode: SampleImportSelectionMode;
  messageIds: readonly string[];
  sender: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
};

const OPEN_STATUS: SampleImportStatus = 'QUEUED';
const RUNNING_STATUS: SampleImportStatus = 'RUNNING';

@Injectable()
export class EmailSampleImportJobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(job: NewSampleImportJob): Promise<SampleImportJobRow> {
    return this.prisma.aiEmailSampleImport.create({
      data: {
        userId: job.userId,
        dryRun: job.dryRun,
        selectionMode: job.selectionMode,
        messageIds: [...job.messageIds],
        sender: job.sender,
        dateFrom: job.dateFrom,
        dateTo: job.dateTo,
        total: job.messageIds.length,
      },
      select: SAMPLE_IMPORT_JOB_SELECT,
    });
  }

  async findForUser(
    userId: string,
    jobId: string,
  ): Promise<SampleImportJobRow | null> {
    return this.prisma.aiEmailSampleImport.findFirst({
      where: { id: jobId, userId },
      select: SAMPLE_IMPORT_JOB_SELECT,
    });
  }

  /** Moves the row to RUNNING once, so a job never runs twice. */
  async claim(jobId: string): Promise<SampleImportJobRow | null> {
    const { count } = await this.prisma.aiEmailSampleImport.updateMany({
      where: { id: jobId, status: OPEN_STATUS },
      data: { status: RUNNING_STATUS, startedAt: new Date(), processed: 0 },
    });
    if (count === 0) {
      return null;
    }
    return this.prisma.aiEmailSampleImport.findUnique({
      where: { id: jobId },
      select: SAMPLE_IMPORT_JOB_SELECT,
    });
  }

  async updateProgress(jobId: string, processed: number): Promise<void> {
    await this.prisma.aiEmailSampleImport.updateMany({
      where: { id: jobId, status: RUNNING_STATUS },
      data: { processed },
    });
  }

  async complete(jobId: string, result: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.aiEmailSampleImport.updateMany({
      where: { id: jobId, status: RUNNING_STATUS },
      data: {
        status: 'COMPLETED',
        result,
        error: null,
        finishedAt: new Date(),
      },
    });
  }

  async fail(jobId: string, error: string): Promise<void> {
    await this.prisma.aiEmailSampleImport.updateMany({
      where: { id: jobId, status: RUNNING_STATUS },
      data: { status: 'FAILED', error, finishedAt: new Date() },
    });
  }
}
