import {
  isSafeGlobalTemplateKey,
  knowledgeKeys,
  NORMALIZER_VERSION,
} from './knowledge-normalizer';
import {
  SANITIZER_VERSION,
  sanitizeGlobalLabel,
  parseUserEmailPayload,
  type EmailLabel,
} from './knowledge-payload';
import { POLICY_VERSION, isGlobalPromotable } from './knowledge-policy';

export const PROJECTOR_VERSION = 'email-knowledge-projector-v1';

export type ProjectionMessage = {
  id: string;
  userId: string;
  fromAddress: string;
  subject: string;
  partition: 'TRAIN' | 'VALIDATION' | 'HOLDOUT';
};

export type ProjectionVerification = {
  sequence: bigint;
  userId: string | null;
  targetId: string | null;
  verdict: 'CONFIRMED' | 'CORRECTED' | 'REJECTED';
  verifierRole: 'USER' | 'CONTRIBUTOR' | 'ADMIN';
  correctedPayload: unknown;
  isGroundTruth: boolean;
  createdAt: Date;
  contributorTombstone?: string | null;
  tombstoneEligible?: boolean;
  normalizerVersion?: string | null;
  structuralKeys?: unknown;
  structuralPayload?: unknown;
};

export type ProjectedKnowledge = {
  scope: 'USER' | 'GLOBAL';
  userId: string | null;
  knowledgeType: 'EMAIL_SENDER' | 'EMAIL_DOMAIN' | 'EMAIL_TEMPLATE';
  knowledgeKey: string;
  state: 'OBSERVED' | 'STABLE' | 'REVIEW_REQUIRED' | 'BLOCKED';
  payload: { label: EmailLabel };
  messagesSeen: number;
  rejectedMessages: number;
  distinctUsers: number;
  humanVerifiedCount: number;
  promotedBy: 'AUTO' | 'CONTRIBUTOR' | 'ADMIN' | null;
  projectorVersion: string;
  policyVersion: string;
  sanitizerVersion: string;
  normalizerVersion: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

export type ProjectionInput = {
  messages: ProjectionMessage[];
  verifications: ProjectionVerification[];
  observations?: Array<{
    sequence: bigint;
    userId: string | null;
    sourceId: string | null;
    knowledgeType: string;
    knowledgeKey: string;
    payload: unknown;
    derivedFromKnowledgeIds: string[];
    createdAt: Date;
  }>;
  consentByUser: ReadonlyMap<string, boolean>;
  observationSequence?: bigint;
  verificationSequence: bigint;
  minimumContributors: number;
  adminDecisions?: Array<{
    knowledgeType: 'EMAIL_DOMAIN' | 'EMAIL_TEMPLATE';
    knowledgeKey: string;
    sequence: bigint;
    verdict: 'CONFIRMED' | 'REJECTED';
  }>;
};

type Vote = {
  type: ProjectedKnowledge['knowledgeType'];
  key: string;
  userId: string | null;
  contributor: string;
  label: EmailLabel;
  verifierRole: ProjectionVerification['verifierRole'];
  sequence: bigint;
  createdAt: Date;
};

function labelId(label: EmailLabel): string {
  const structural = sanitizeGlobalLabel(label).label;
  return JSON.stringify(structural);
}

export type KnowledgeAdminDecision = NonNullable<
  ProjectionInput['adminDecisions']
>[number];

/** Latest ADMIN decision per key before the cut; a rejection wins over a promotion. */
export function latestAdminDecisions(
  decisions: readonly KnowledgeAdminDecision[],
  verificationSequence: bigint,
): Map<string, KnowledgeAdminDecision['verdict']> {
  const latest = new Map<string, KnowledgeAdminDecision>();
  for (const decision of decisions) {
    if (decision.sequence > verificationSequence) {
      continue;
    }
    const key = `${decision.knowledgeType}|${decision.knowledgeKey}`;
    const previous = latest.get(key);
    if (!previous || previous.sequence < decision.sequence) {
      latest.set(key, decision);
    }
  }
  return new Map(
    [...latest.entries()].map(([key, decision]) => [key, decision.verdict]),
  );
}

function row(vote: Vote, scope: 'USER' | 'GLOBAL'): ProjectedKnowledge {
  return {
    scope,
    userId: scope === 'USER' ? vote.userId : null,
    knowledgeType: vote.type,
    knowledgeKey: vote.key,
    state: 'STABLE',
    payload: { label: vote.label },
    messagesSeen: 1,
    rejectedMessages: 0,
    distinctUsers: scope === 'USER' ? 0 : 1,
    humanVerifiedCount: 1,
    promotedBy: scope === 'GLOBAL' ? 'AUTO' : null,
    projectorVersion: PROJECTOR_VERSION,
    policyVersion: POLICY_VERSION,
    sanitizerVersion: SANITIZER_VERSION,
    normalizerVersion: NORMALIZER_VERSION,
    firstSeenAt: vote.createdAt,
    lastSeenAt: vote.createdAt,
  };
}

/** Pure projection over a fixed evidence cut. Database ordering cannot change it. */
export function projectKnowledge(input: ProjectionInput): ProjectedKnowledge[] {
  const messages = new Map(
    input.messages.map((message) => [message.id, message]),
  );
  const latestByMessage = new Map<string, ProjectionVerification>();
  const tombstones: ProjectionVerification[] = [];
  for (const verification of input.verifications) {
    if (
      verification.sequence > input.verificationSequence ||
      verification.isGroundTruth
    ) {
      continue;
    }
    if (verification.targetId && verification.userId) {
      const previous = latestByMessage.get(verification.targetId);
      if (!previous || previous.sequence < verification.sequence) {
        latestByMessage.set(verification.targetId, verification);
      }
    } else if (
      verification.tombstoneEligible &&
      verification.contributorTombstone
    ) {
      tombstones.push(verification);
    }
  }

  const userVotes = new Map<string, Vote[]>();
  const globalVotes = new Map<string, Vote[]>();
  const rejectedByKey = new Map<string, number>();
  const rejectedGlobalByKey = new Map<string, number>();
  const add = (map: Map<string, Vote[]>, key: string, vote: Vote) => {
    const list = map.get(key) ?? [];
    list.push(vote);
    map.set(key, list);
  };

  for (const [messageId, verification] of latestByMessage) {
    const message = messages.get(messageId);
    if (
      !message ||
      message.partition === 'HOLDOUT' ||
      message.userId !== verification.userId
    ) {
      continue;
    }
    const keys = knowledgeKeys(message.fromAddress, message.subject);
    for (const { knowledgeType: type, knowledgeKey: key } of keys) {
      const index = `${message.userId}|${type}|${key}`;
      if (verification.verdict === 'REJECTED') {
        rejectedByKey.set(index, (rejectedByKey.get(index) ?? 0) + 1);
        if (
          type !== 'EMAIL_SENDER' &&
          (type !== 'EMAIL_TEMPLATE' || isSafeGlobalTemplateKey(key)) &&
          input.consentByUser.get(message.userId) === true
        ) {
          const globalIndex = `${type}|${key}`;
          rejectedGlobalByKey.set(
            globalIndex,
            (rejectedGlobalByKey.get(globalIndex) ?? 0) + 1,
          );
        }
        continue;
      }
      if (!verification.correctedPayload) {
        continue;
      }
      const label = parseUserEmailPayload({
        label: verification.correctedPayload,
      }).label;
      const vote: Vote = {
        type,
        key,
        userId: message.userId,
        contributor: message.userId,
        label,
        verifierRole: verification.verifierRole,
        sequence: verification.sequence,
        createdAt: verification.createdAt,
      };
      add(userVotes, index, vote);
      if (
        type !== 'EMAIL_SENDER' &&
        (type !== 'EMAIL_TEMPLATE' || isSafeGlobalTemplateKey(key)) &&
        input.consentByUser.get(message.userId) === true
      ) {
        add(globalVotes, `${type}|${key}`, vote);
      }
    }
  }

  const observedByKey = new Map<string, Vote[]>();
  for (const observation of input.observations ?? []) {
    if (
      observation.sequence > (input.observationSequence ?? 0n) ||
      !observation.userId ||
      !observation.sourceId ||
      observation.derivedFromKnowledgeIds.length > 0
    ) {
      continue;
    }
    const message = messages.get(observation.sourceId);
    if (
      !message ||
      message.userId !== observation.userId ||
      message.partition === 'HOLDOUT' ||
      latestByMessage.get(message.id)?.verdict === 'REJECTED'
    ) {
      continue;
    }
    const validKey = knowledgeKeys(message.fromAddress, message.subject).find(
      (key) =>
        key.knowledgeType === observation.knowledgeType &&
        key.knowledgeKey === observation.knowledgeKey,
    );
    if (!validKey) {
      continue;
    }
    try {
      const label = parseUserEmailPayload(observation.payload).label;
      const vote: Vote = {
        type: validKey.knowledgeType,
        key: validKey.knowledgeKey,
        userId: message.userId,
        contributor: message.userId,
        label,
        verifierRole: 'USER',
        sequence: observation.sequence,
        createdAt: observation.createdAt,
      };
      add(observedByKey, `${message.userId}|${vote.type}|${vote.key}`, vote);
    } catch {
      // Unvalidated model output cannot become durable knowledge.
    }
  }

  for (const verification of tombstones) {
    if (
      verification.normalizerVersion !== NORMALIZER_VERSION ||
      !Array.isArray(verification.structuralKeys) ||
      !verification.structuralPayload
    ) {
      continue;
    }
    if (verification.verdict === 'REJECTED') {
      continue;
    }
    const label = sanitizeGlobalLabel(verification.structuralPayload).label;
    for (const candidate of verification.structuralKeys) {
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }
      const key = candidate as {
        knowledgeType?: string;
        knowledgeKey?: string;
      };
      if (
        (key.knowledgeType !== 'EMAIL_DOMAIN' &&
          key.knowledgeType !== 'EMAIL_TEMPLATE') ||
        typeof key.knowledgeKey !== 'string' ||
        (key.knowledgeType === 'EMAIL_TEMPLATE' &&
          !isSafeGlobalTemplateKey(key.knowledgeKey))
      ) {
        continue;
      }
      const vote: Vote = {
        type: key.knowledgeType,
        key: key.knowledgeKey,
        userId: null,
        contributor: verification.contributorTombstone!,
        label,
        verifierRole: verification.verifierRole,
        sequence: verification.sequence,
        createdAt: verification.createdAt,
      };
      add(globalVotes, `${vote.type}|${vote.key}`, vote);
    }
  }

  const projected: ProjectedKnowledge[] = [];
  for (const [index, votes] of [...userVotes].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const winner = votes.reduce((a, b) => (a.sequence > b.sequence ? a : b));
    const result = row(winner, 'USER');
    result.messagesSeen = votes.length;
    result.rejectedMessages = rejectedByKey.get(index) ?? 0;
    result.humanVerifiedCount = votes.length;
    result.firstSeenAt = new Date(
      Math.min(...votes.map((vote) => vote.createdAt.getTime())),
    );
    result.lastSeenAt = new Date(
      Math.max(...votes.map((vote) => vote.createdAt.getTime())),
    );
    projected.push(result);
  }

  for (const [index, votes] of [...observedByKey].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (userVotes.has(index)) {
      continue;
    }
    const winner = votes.reduce((a, b) => (a.sequence > b.sequence ? a : b));
    const result = row(winner, 'USER');
    result.state = 'OBSERVED';
    result.messagesSeen = votes.length;
    result.humanVerifiedCount = 0;
    result.rejectedMessages = rejectedByKey.get(index) ?? 0;
    projected.push(result);
  }

  for (const [globalIndex, votes] of [...globalVotes].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const groups = new Map<string, Vote[]>();
    for (const vote of votes) {
      const id = labelId(vote.label);
      groups.set(id, [...(groups.get(id) ?? []), vote]);
    }
    const ranked = [...groups.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
    const leaders = ranked[0]?.[1];
    if (!leaders) {
      continue;
    }
    const contributors = new Set(leaders.map((vote) => vote.contributor));
    const hasConsensus =
      ranked.length === 1 || leaders.length > ranked[1][1].length;
    const winner = leaders.reduce((a, b) => (a.sequence > b.sequence ? a : b));
    const passes = isGlobalPromotable({
      leaderVotes: leaders.length,
      totalVotes: votes.length,
      contributors: contributors.size,
      hasConsensus,
      minimumContributors: input.minimumContributors,
      semanticType: winner.label.semanticType,
    });
    const result = row(winner, 'GLOBAL');
    result.payload = sanitizeGlobalLabel(winner.label);
    result.messagesSeen = votes.length;
    result.distinctUsers = new Set(votes.map((vote) => vote.contributor)).size;
    result.humanVerifiedCount = votes.length;
    result.rejectedMessages = rejectedGlobalByKey.get(globalIndex) ?? 0;
    result.state = passes ? 'STABLE' : 'REVIEW_REQUIRED';
    result.promotedBy = passes ? 'AUTO' : null;
    result.firstSeenAt = new Date(
      Math.min(...votes.map((vote) => vote.createdAt.getTime())),
    );
    result.lastSeenAt = new Date(
      Math.max(...votes.map((vote) => vote.createdAt.getTime())),
    );
    projected.push(result);
  }
  const decisions = latestAdminDecisions(
    input.adminDecisions ?? [],
    input.verificationSequence,
  );
  for (const item of projected) {
    if (item.scope !== 'GLOBAL') {
      continue;
    }
    const decision = decisions.get(
      `${item.knowledgeType}|${item.knowledgeKey}`,
    );
    if (decision === 'REJECTED') {
      item.state = 'BLOCKED';
      item.promotedBy = null;
    } else if (decision === 'CONFIRMED') {
      item.state = 'STABLE';
      item.promotedBy = 'ADMIN';
    }
  }
  return projected;
}
