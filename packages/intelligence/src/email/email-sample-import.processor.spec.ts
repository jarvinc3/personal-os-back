import { EmailSampleImportProcessor } from './email-sample-import.processor';

function setup() {
  const sampleImport = { process: jest.fn().mockResolvedValue(undefined) };
  const processor = new EmailSampleImportProcessor(sampleImport as never);
  return { sampleImport, processor };
}

const job = { data: { userId: 'user-1', sampleImportId: 'job-1' } } as never;

describe('EmailSampleImportProcessor', () => {
  it('processes the sample import referenced by the job', async () => {
    const { sampleImport, processor } = setup();

    await processor.process(job);

    expect(sampleImport.process).toHaveBeenCalledWith('job-1');
  });
});
