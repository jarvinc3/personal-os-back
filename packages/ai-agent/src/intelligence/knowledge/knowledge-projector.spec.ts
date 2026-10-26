import { projectKnowledge, type ProjectionInput } from './knowledge-projector';
import {
  knowledgeKeys,
  normalizeSubject,
  registrableDomain,
  NORMALIZER_VERSION,
} from './knowledge-normalizer';
import { sanitizeGlobalLabel } from './knowledge-payload';

const date = new Date('2026-10-25T12:00:00Z');
const label = {
  semanticType: 'FIN_TRANSACTION',
  routes: ['FINANCE'],
  transaction: {
    kind: 'TRANSACTION',
    amount: 1250,
    currency: 'DOP',
    last4: '4821',
    merchant: 'Comercio Particular',
    bankReference: 'private-ref',
  },
};

function fixture(): ProjectionInput {
  return {
    messages: [
      {
        id: 'm1',
        userId: 'u1',
        fromAddress: 'Alertas <alerts+one@alerts.bank.com>',
        subject: 'RE: Consumo RD$1,250 en tienda',
        partition: 'TRAIN',
      },
      {
        id: 'm2',
        userId: 'u2',
        fromAddress: 'alerts@bank.com',
        subject: 'Consumo RD$2,500 en tienda',
        partition: 'VALIDATION',
      },
    ],
    verifications: [
      {
        sequence: 1n,
        userId: 'u1',
        targetId: 'm1',
        verdict: 'CORRECTED',
        verifierRole: 'USER',
        correctedPayload: label,
        isGroundTruth: false,
        createdAt: date,
      },
      {
        sequence: 2n,
        userId: 'u2',
        targetId: 'm2',
        verdict: 'CONFIRMED',
        verifierRole: 'USER',
        correctedPayload: label,
        isGroundTruth: false,
        createdAt: date,
      },
    ],
    consentByUser: new Map([
      ['u1', true],
      ['u2', true],
    ]),
    verificationSequence: 2n,
    minimumContributors: 2,
  };
}

describe('AI-4 knowledge', () => {
  it('normaliza remitente, dominio y asunto sin montos ni fechas', () => {
    expect(registrableDomain('Alertas <alerts+foo@alerts.bank.com>')).toBe(
      'bank.com',
    );
    expect(
      knowledgeKeys(
        'Alertas <alerts+foo@alerts.bank.com>',
        'RE: Consumo RD$1,250',
      )[0],
    ).toEqual({
      knowledgeType: 'EMAIL_SENDER',
      knowledgeKey: 'alerts@alerts.bank.com',
    });
    expect(normalizeSubject('Fwd: Ré: Cobro RD$1,250 el 25/10/2026')).toBe(
      'cobro <monto> el <fecha>',
    );
  });

  it('sanea GLOBAL por lista permitida y no deja datos privados', () => {
    const serialized = JSON.stringify(sanitizeGlobalLabel(label));
    for (const privateValue of [
      '1250',
      '4821',
      'Comercio Particular',
      'private-ref',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(() =>
      sanitizeGlobalLabel({ ...label, unknown: 'secret' }),
    ).toThrow();
  });

  it('reconstruye la misma proyección y aísla remitentes de USER', () => {
    const input = fixture();
    expect(projectKnowledge(input)).toEqual(
      projectKnowledge({
        ...input,
        messages: [...input.messages].reverse(),
        verifications: [...input.verifications].reverse(),
      }),
    );
    const projected = projectKnowledge(input);
    expect(
      projected
        .filter((item) => item.scope === 'GLOBAL')
        .every((item) => item.knowledgeType !== 'EMAIL_SENDER'),
    ).toBe(true);
    expect(
      projected.some(
        (item) =>
          item.scope === 'GLOBAL' &&
          item.state === 'STABLE' &&
          item.distinctUsers === 2,
      ),
    ).toBe(true);
  });

  it('excluye HOLDOUT y consentimiento revocado', () => {
    const input = fixture();
    input.messages[1].partition = 'HOLDOUT';
    expect(
      projectKnowledge(input).some(
        (item) => item.scope === 'GLOBAL' && item.state === 'STABLE',
      ),
    ).toBe(false);
    input.messages[1].partition = 'TRAIN';
    input.consentByUser = new Map([
      ['u1', true],
      ['u2', false],
    ]);
    expect(
      projectKnowledge(input).some(
        (item) => item.scope === 'GLOBAL' && item.state === 'STABLE',
      ),
    ).toBe(false);
  });

  it('bloquea GLOBAL EMAIL_TEMPLATE si el asunto puede contener un nombre o referencia', () => {
    const input = fixture();
    input.messages[0].subject = 'Consumo de Ana Gómez por RD$1,250';
    input.messages[1].subject = 'Consumo de Ana Gómez por RD$2,500';
    const projected = projectKnowledge(input);
    expect(
      projected.some(
        (item) =>
          item.scope === 'GLOBAL' && item.knowledgeType === 'EMAIL_DOMAIN',
      ),
    ).toBe(true);
    expect(
      projected.some(
        (item) =>
          item.scope === 'GLOBAL' && item.knowledgeType === 'EMAIL_TEMPLATE',
      ),
    ).toBe(false);
    expect(
      projected.some(
        (item) =>
          item.scope === 'USER' && item.knowledgeType === 'EMAIL_TEMPLATE',
      ),
    ).toBe(true);
  });

  it('USER usa la última corrección y GLOBAL exige dos tercios sin empate', () => {
    const input = fixture();
    input.verifications.push({
      sequence: 3n,
      userId: 'u1',
      targetId: 'm1',
      verdict: 'CORRECTED',
      verifierRole: 'USER',
      correctedPayload: {
        semanticType: 'SECURITY_ALERT',
        routes: ['SECURITY'],
      },
      isGroundTruth: false,
      createdAt: date,
    });
    input.verificationSequence = 3n;
    const projected = projectKnowledge(input);
    expect(
      projected.find((item) => item.scope === 'USER' && item.userId === 'u1')
        ?.payload.label.semanticType,
    ).toBe('SECURITY_ALERT');
    expect(
      projected
        .filter((item) => item.scope === 'GLOBAL')
        .every((item) => item.state === 'REVIEW_REQUIRED'),
    ).toBe(true);
  });

  it('deja GLOBAL pendiente hasta alcanzar el mínimo de colaboradores y bloquea la reversión ADMIN', () => {
    const input = fixture();
    input.minimumContributors = 3;
    expect(
      projectKnowledge(input)
        .filter((item) => item.scope === 'GLOBAL')
        .every((item) => item.state === 'REVIEW_REQUIRED'),
    ).toBe(true);
    input.minimumContributors = 2;
    input.adminReversions = [
      {
        knowledgeType: 'EMAIL_DOMAIN',
        knowledgeKey: 'bank.com',
        sequence: 3n,
        verdict: 'REJECTED',
      },
    ];
    input.verificationSequence = 3n;
    expect(
      projectKnowledge(input).find(
        (item) =>
          item.scope === 'GLOBAL' && item.knowledgeType === 'EMAIL_DOMAIN',
      ),
    ).toMatchObject({ state: 'BLOCKED', promotedBy: null });
  });

  it('REJECTED no crea conocimiento', () => {
    const input = fixture();
    input.verifications[0].verdict = 'REJECTED';
    expect(
      projectKnowledge(input).some(
        (item) => item.scope === 'USER' && item.userId === 'u1',
      ),
    ).toBe(false);
  });

  it('ignora observaciones derivadas de conocimiento y nunca promueve solo por modelo', () => {
    const input = fixture();
    input.verifications = [];
    input.observationSequence = 2n;
    input.observations = [
      {
        sequence: 1n,
        userId: 'u1',
        sourceId: 'm1',
        knowledgeType: 'EMAIL_DOMAIN',
        knowledgeKey: 'bank.com',
        payload: { label },
        derivedFromKnowledgeIds: [],
        createdAt: date,
      },
      {
        sequence: 2n,
        userId: 'u2',
        sourceId: 'm2',
        knowledgeType: 'EMAIL_DOMAIN',
        knowledgeKey: 'bank.com',
        payload: { label },
        derivedFromKnowledgeIds: ['knowledge-1'],
        createdAt: date,
      },
    ];
    const projected = projectKnowledge(input);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ scope: 'USER', state: 'OBSERVED' });
  });

  it('descarta lápidas de otra versión del normalizador', () => {
    const input: ProjectionInput = {
      messages: [],
      verifications: [
        {
          sequence: 1n,
          userId: null,
          targetId: null,
          verdict: 'CORRECTED',
          verifierRole: 'USER',
          correctedPayload: null,
          isGroundTruth: false,
          createdAt: date,
          contributorTombstone: 'tombstone-1',
          tombstoneEligible: true,
          normalizerVersion: 'email-knowledge-normalizer-v0',
          structuralKeys: [
            { knowledgeType: 'EMAIL_DOMAIN', knowledgeKey: 'bank.com' },
          ],
          structuralPayload: { semanticType: 'FIN_TRANSACTION' },
        },
      ],
      consentByUser: new Map(),
      verificationSequence: 1n,
      minimumContributors: 1,
    };
    expect(projectKnowledge(input)).toHaveLength(0);

    input.verifications[0].normalizerVersion = NORMALIZER_VERSION;
    expect(projectKnowledge(input)).toEqual([
      expect.objectContaining({
        scope: 'GLOBAL',
        knowledgeType: 'EMAIL_DOMAIN',
        knowledgeKey: 'bank.com',
        state: 'STABLE',
      }),
    ]);
  });
});
