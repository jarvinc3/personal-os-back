import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QueueNames, type AiEmailSampleImportJob } from '@personal-os/core';
import { EmailSampleImportService } from './email-sample-import.service';

@Injectable()
@Processor(QueueNames.AI_EMAIL_SAMPLE_IMPORT)
export class EmailSampleImportProcessor extends WorkerHost {
  constructor(private readonly sampleImport: EmailSampleImportService) {
    super();
  }

  async process(job: Job<AiEmailSampleImportJob>): Promise<void> {
    await this.sampleImport.process(job.data.sampleImportId);
  }
}
