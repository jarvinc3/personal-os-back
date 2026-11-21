import { Prisma } from '@personal-os/database';
import { AiDataDeletionService } from './ai-data-deletion.service';

async function collectExport<T>(
  service: AiDataDeletionService,
  userId: string,
): Promise<T> {
  const chunks: string[] = [];
  await service.streamExportForUser(userId, (chunk) => {
    chunks.push(chunk);
  });
  return JSON.parse(chunks.join('')) as T;
}

describe('AiDataDeletionService', () => {
  const message = {
    id: 'm1',
    fromAddress: 'Alertas <alerts+qa@alerts.bank.com>',
    subject: 'Consumo RD$1,250',
  };
  const verification = {
    sequence: 7n,
    userId: 'u1',
    targetType: 'EMAIL_MESSAGE',
    targetId: 'm1',
    verdict: 'CORRECTED',
    verifierRole: 'USER',
    isGroundTruth: false,
    correctedPayload: {
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: { kind: 'TRANSACTION', amount: 1250, last4: '4821' },
    },
  };

  function fixture(consent: boolean) {
    let consentEnabled = consent;
    const tx = {
      aiEmailMessage: {
        findMany: jest.fn().mockResolvedValue([message]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      aiHumanVerification: {
        findMany: jest.fn().mockResolvedValue([verification]),
        update: jest.fn().mockResolvedValue({}),
      },
      aiKnowledgeObservation: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      userAiSettings: {
        findUnique: jest.fn(() =>
          Promise.resolve({ contributeToGlobalKnowledge: consentEnabled }),
        ),
        upsert: jest.fn(() => Promise.resolve({})),
      },
      aiConsentEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
      },
      aiAnalysisRun: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      aiKnowledge: {
        deleteMany: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
      },
      aiDatasetItem: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ sourceId: 'm1', partition: 'TRAIN' }]),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
      aiInference: { deleteMany: jest.fn().mockResolvedValue({}) },
      aiEmailConnection: {
        updateMany: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (arg: typeof tx) => unknown) =>
        callback(tx),
      ),
      aiConversation: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aiAction: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
      aiViewSuggestion: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 's1', label: 'Revisá', prompt: '¿Cómo va el presupuesto?' },
          ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
      aiEmailSampleImport: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sample-1' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 5 }),
      },
      aiEmailConnection: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      aiEmailMessage: { findMany: jest.fn().mockResolvedValue([]) },
      aiDatasetItem: { findMany: jest.fn().mockResolvedValue([]) },
      aiAnalysisRun: { findMany: jest.fn().mockResolvedValue([]) },
      aiKnowledgeObservation: { findMany: jest.fn().mockResolvedValue([]) },
      aiHumanVerification: { findMany: jest.fn().mockResolvedValue([]) },
      aiKnowledge: { findMany: jest.fn().mockResolvedValue([]) },
      aiConsentEvent: { findMany: jest.fn().mockResolvedValue([]) },
      aiInference: { findMany: jest.fn().mockResolvedValue([]) },
      userAiSettings: {
        findUnique: jest.fn(() =>
          Promise.resolve({ contributeToGlobalKnowledge: consentEnabled }),
        ),
        upsert: jest.fn(() => {
          consentEnabled = false;
        }),
      },
    };
    const knowledge = { rebuild: jest.fn().mockResolvedValue({}) };
    const service = new AiDataDeletionService(
      prisma as never,
      knowledge as never,
    );
    return { tx, prisma, knowledge, service };
  }

  it('retira datos personales y conserva solo estructura elegible al borrar', async () => {
    const { tx, knowledge, service } = fixture(true);
    expect(await service.removeEmailData({ userId: 'u1' })).toMatchObject({
      deletedMessages: 1,
    });
    const update = tx.aiHumanVerification.update.mock.calls[0][0].data;
    expect(update).toMatchObject({
      userId: null,
      targetId: null,
      notes: null,
      tombstoneEligible: true,
      structuralKeys: [
        { knowledgeType: 'EMAIL_DOMAIN', knowledgeKey: 'bank.com' },
        {
          knowledgeType: 'EMAIL_TEMPLATE',
          knowledgeKey: 'bank.com|consumo <monto>',
        },
      ],
      structuralPayload: {
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction: { kind: 'TRANSACTION' },
      },
    });
    expect(update.notes).toBeNull();
    expect(update.correctedPayload).toBe(Prisma.DbNull);
    expect(JSON.stringify(update.structuralKeys)).not.toContain('4821');
    expect(JSON.stringify(update.structuralPayload)).not.toContain('4821');
    expect(JSON.stringify(update.structuralPayload)).not.toContain('1250');
    expect(knowledge.rebuild).toHaveBeenCalledWith('u1');
    expect(tx.aiKnowledge.updateMany).toHaveBeenCalledWith({
      where: { scope: 'GLOBAL' },
      data: { state: 'REVIEW_REQUIRED', promotedBy: null },
    });
  });

  it('no deja evidencia GLOBAL elegible tras revocación', async () => {
    const { tx, service } = fixture(false);
    await service.removeEmailData({ userId: 'u1' });
    const update = tx.aiHumanVerification.update.mock.calls[0][0].data;
    expect(update.tombstoneEligible).toBe(false);
    expect(update.structuralPayload).not.toEqual(
      expect.objectContaining({ semanticType: 'FIN_TRANSACTION' }),
    );
  });

  it('no conserva un asunto personal en una lápida de plantilla', async () => {
    const { tx, service } = fixture(true);
    tx.aiEmailMessage.findMany.mockResolvedValue([
      { ...message, subject: 'Consumo de Ana Gómez RD$1,250' },
    ]);
    await service.removeEmailData({ userId: 'u1' });
    const update = tx.aiHumanVerification.update.mock.calls[0][0].data;
    expect(update.structuralKeys).toEqual([
      { knowledgeType: 'EMAIL_DOMAIN', knowledgeKey: 'bank.com' },
    ]);
    expect(JSON.stringify(update)).not.toContain('Ana');
  });

  it('redacta claves de observación que no coinciden con el correo de origen', async () => {
    const { tx, service } = fixture(true);
    tx.aiKnowledgeObservation.findMany.mockResolvedValue([
      {
        sequence: 8n,
        userId: 'u1',
        sourceId: 'm1',
        sourceType: 'EMAIL_MESSAGE',
        knowledgeType: 'EMAIL_TEMPLATE',
        knowledgeKey: 'bank.com|nombre ana gomez',
        derivedFromKnowledgeIds: [],
      },
    ]);
    tx.aiKnowledgeObservation.update.mockResolvedValue({});
    await service.removeEmailData({ userId: 'u1' });
    expect(tx.aiKnowledgeObservation.update).toHaveBeenCalledWith({
      where: { sequence: 8n },
      data: expect.objectContaining({
        userId: null,
        sourceId: null,
        knowledgeKey: 'REDACTED',
        tombstoneEligible: false,
      }),
    });
  });

  it('no conserva observaciones HOLDOUT para GLOBAL', async () => {
    const { tx, service } = fixture(true);
    tx.aiDatasetItem.findMany.mockResolvedValue([
      { sourceId: 'm1', partition: 'HOLDOUT' },
    ]);
    tx.aiKnowledgeObservation.findMany.mockResolvedValue([
      {
        sequence: 9n,
        sourceId: 'm1',
        sourceType: 'EMAIL_MESSAGE',
        knowledgeType: 'EMAIL_DOMAIN',
        knowledgeKey: 'bank.com',
        derivedFromKnowledgeIds: [],
      },
    ]);
    tx.aiKnowledgeObservation.update.mockResolvedValue({});
    await service.removeEmailData({ userId: 'u1' });
    expect(
      tx.aiKnowledgeObservation.update.mock.calls[0][0].data,
    ).toMatchObject({
      tombstoneEligible: false,
      knowledgeKey: 'REDACTED',
    });
  });

  it('deja lápidas elegibles si el consentimiento estaba vigente al borrar', async () => {
    const { tx, prisma, service } = fixture(true);
    const result = await service.deleteMyData('u1');
    expect(result).toMatchObject({
      deletedConversations: 2,
      deletedActions: 3,
      deletedViewSuggestions: 4,
      deletedSampleImports: 5,
    });
    expect(prisma.aiAction.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
    expect(prisma.aiViewSuggestion.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
    expect(prisma.aiEmailSampleImport.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
    expect(
      tx.aiHumanVerification.update.mock.calls[0][0].data.tombstoneEligible,
    ).toBe(true);
    expect(tx.aiConsentEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        contributeToGlobalKnowledge: false,
        reason: 'USER_DELETED_AI_DATA',
      },
    });
  });

  it('incluye las sugerencias del agente en la exportación de datos de IA', async () => {
    const { service } = fixture(true);

    const exported = await collectExport<{ viewSuggestions: unknown }>(
      service,
      'u1',
    );

    expect(exported.viewSuggestions).toEqual([
      { id: 's1', label: 'Revisá', prompt: '¿Cómo va el presupuesto?' },
    ]);
  });

  it('incluye los trabajos de muestra en la exportación de datos de IA', async () => {
    const { service } = fixture(true);

    const exported = await collectExport<{ sampleImports: unknown }>(
      service,
      'u1',
    );

    expect(exported.sampleImports).toEqual([{ id: 'sample-1' }]);
  });

  it('marca INCOMPLETE solo los runs que cubrían la evidencia borrada', async () => {
    const { tx, service } = fixture(true);
    tx.aiKnowledgeObservation.findMany.mockResolvedValue([
      {
        sequence: 8n,
        userId: 'u1',
        sourceId: 'm1',
        sourceType: 'EMAIL_MESSAGE',
        knowledgeType: 'EMAIL_DOMAIN',
        knowledgeKey: 'bank.com',
        derivedFromKnowledgeIds: [],
      },
    ]);
    tx.aiKnowledgeObservation.update.mockResolvedValue({});
    tx.aiAnalysisRun.findMany.mockResolvedValue([
      {
        id: 'run-affected',
        observationSequence: 10n,
        verificationSequence: 10n,
        missingEvidence: {},
      },
      {
        id: 'run-before',
        observationSequence: 1n,
        verificationSequence: 1n,
        missingEvidence: {},
      },
    ]);
    await service.removeEmailData({ userId: 'u1' });
    expect(tx.aiAnalysisRun.update).toHaveBeenCalledTimes(1);
    expect(tx.aiAnalysisRun.update).toHaveBeenCalledWith({
      where: { id: 'run-affected' },
      data: {
        reproductionStatus: 'INCOMPLETE',
        missingEvidence: { humanVerifications: 1, observations: 1 },
      },
    });
  });
});
