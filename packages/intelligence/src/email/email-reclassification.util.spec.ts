import {
  currentClassificationLabel,
  dominantClassification,
  knowledgeProvenanceForRow,
  mergedCandidateLabel,
  sharedKnowledgeProvenance,
  structuralLabel,
  verificationLabel,
} from './email-reclassification.util';

const transaction = {
  kind: 'TRANSACTION',
  amount: 1250,
  currency: 'DOP',
  transactionDate: '2026-11-01T00:00:00.000Z',
  direction: 'DEBIT',
  merchant: 'Tienda',
  bankReference: 'ref-1',
  last4: '4821',
  movementClass: 'PURCHASE',
  bankStatusNormalized: 'COMPLETED',
  currencyEvidence: 'El texto indica DOP; el modelo propuso USD.',
};

describe('Email reclassification labels', () => {
  it('keeps only the verified structure and never copies money between messages', () => {
    expect(
      structuralLabel({
        relevance: true,
        semanticType: 'FIN_TRANSACTION',
        routes: ['FINANCE'],
        transaction,
        notes: 'ignorada',
      }),
    ).toEqual({
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: { kind: 'TRANSACTION' },
    });
  });

  it('keeps the amount, currency and instrument of each message', () => {
    expect(
      mergedCandidateLabel({
        structural: {
          relevance: true,
          semanticType: 'FIN_TRANSACTION',
          routes: ['FINANCE'],
          transaction: { kind: 'TRANSACTION' },
        },
        current: {
          relevance: true,
          semanticType: 'FIN_TRANSACTION',
          routes: ['FINANCE'],
          transaction,
          confidence: 0.4,
        },
      }),
    ).toMatchObject({
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      confidence: 0.98,
      transaction: {
        kind: 'TRANSACTION',
        amount: 1250,
        currency: 'DOP',
        last4: '4821',
        movementClass: 'PURCHASE',
        currencyEvidence: 'El texto indica DOP; el modelo propuso USD.',
      },
    });
  });

  it('keeps the import hints of each message when a verified template is applied', () => {
    expect(
      mergedCandidateLabel({
        structural: {
          relevance: true,
          semanticType: 'FIN_TRANSACTION',
          routes: ['FINANCE'],
          transaction: { kind: 'TRANSACTION' },
        },
        current: {
          relevance: true,
          semanticType: 'FIN_TRANSACTION',
          routes: ['FINANCE'],
          transaction: {
            ...transaction,
            accountNumberLast4: '9012',
            suggestedTransactionDate: '2026-11-08T00:00:00.000Z',
            suggestedTransactionDateSource: 'EMAIL_HEADER',
            reverseOfEmailMessageId: 'original-1',
          },
          confidence: 0.4,
        },
      }),
    ).toMatchObject({
      transaction: {
        accountNumberLast4: '9012',
        suggestedTransactionDate: '2026-11-08T00:00:00.000Z',
        suggestedTransactionDateSource: 'EMAIL_HEADER',
        reverseOfEmailMessageId: 'original-1',
      },
    });
  });

  it('does not invent a movement when the message has no money of its own', () => {
    expect(
      mergedCandidateLabel({
        structural: {
          relevance: true,
          semanticType: 'FIN_TRANSACTION',
          routes: ['FINANCE'],
          transaction: { kind: 'TRANSACTION' },
        },
        current: null,
      }),
    ).toMatchObject({ transaction: { kind: 'TRANSACTION' } });
    expect(
      mergedCandidateLabel({
        structural: { relevance: true },
        current: null,
      }),
    ).toBeNull();
  });

  it('drops the message money when the verified label is not financial', () => {
    expect(
      mergedCandidateLabel({
        structural: {
          relevance: false,
          semanticType: 'MARKETING',
          routes: [],
        },
        current: {
          relevance: true,
          semanticType: 'FIN_TRANSACTION',
          routes: ['FINANCE'],
          transaction,
          confidence: 0.4,
        },
      }),
    ).toEqual({
      relevance: false,
      semanticType: 'MARKETING',
      routes: [],
      confidence: 0.98,
    });
  });

  it('turns a rejection into an irrelevant verified label', () => {
    expect(
      verificationLabel({ verdict: 'REJECTED', correctedPayload: null }),
    ).toEqual({ relevance: false, semanticType: 'OTHER', routes: [] });
    expect(
      verificationLabel({
        verdict: 'CORRECTED',
        correctedPayload: { relevance: true },
      }),
    ).toEqual({ relevance: true });
  });

  it('confirms a group with its most repeated classification', () => {
    const finance = currentClassificationLabel({
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: { kind: 'TRANSACTION', amount: 10, currency: 'DOP' },
      confidence: 0.4,
    })!;
    const marketing = currentClassificationLabel({
      relevance: false,
      semanticType: 'MARKETING',
      routes: [],
      confidence: 0.4,
    })!;
    expect(
      dominantClassification([
        { classification: marketing, receivedAt: new Date('2026-11-03') },
        { classification: finance, receivedAt: new Date('2026-11-01') },
        { classification: finance, receivedAt: new Date('2026-11-02') },
      ]),
    ).toEqual(finance);
  });

  it('records only the knowledge keys the verification shares with the message', () => {
    const shared = sharedKnowledgeProvenance({
      verified: {
        fromAddress: 'Alertas <alertas@banco.com>',
        subject: 'Consumo RD$1,250 en tienda',
      },
      candidate: {
        fromAddress: 'alertas@banco.com',
        subject: 'Pago recibido',
      },
    });
    expect(shared).toEqual([
      {
        knowledgeType: 'EMAIL_SENDER',
        knowledgeKey: 'alertas@banco.com',
        scope: 'USER',
      },
      {
        knowledgeType: 'EMAIL_DOMAIN',
        knowledgeKey: 'banco.com',
        scope: 'USER',
      },
    ]);
    expect(
      sharedKnowledgeProvenance({
        verified: {
          fromAddress: 'alertas@banco.com',
          subject: 'Consumo RD$1,250 en tienda',
        },
        candidate: {
          fromAddress: 'alertas@banco.com',
          subject: 'Consumo RD$3,400 en tienda',
        },
      }),
    ).toContainEqual({
      knowledgeType: 'EMAIL_TEMPLATE',
      knowledgeKey: 'banco.com|consumo <monto> en tienda',
      scope: 'USER',
    });
  });

  it('marks promoted global knowledge with its own scope', () => {
    expect(
      knowledgeProvenanceForRow({
        knowledgeType: 'EMAIL_DOMAIN',
        knowledgeKey: 'banco.com',
        scope: 'GLOBAL',
      }),
    ).toEqual([
      {
        knowledgeType: 'EMAIL_DOMAIN',
        knowledgeKey: 'banco.com',
        scope: 'GLOBAL',
      },
    ]);
  });
});
