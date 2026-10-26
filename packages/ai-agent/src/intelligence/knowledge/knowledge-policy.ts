export const POLICY_VERSION = 'email-knowledge-policy-v1';

/** The winning label needs at least 2/3 of the votes for its key. */
const GLOBAL_APPROVAL_MIN_NUMERATOR = 2;
const GLOBAL_APPROVAL_MIN_DENOMINATOR = 3;
const GLOBAL_MIN_CONTRIBUTORS_DEFAULT = 3;
const GLOBAL_MIN_CONTRIBUTORS_DEVELOPMENT = 1;

export function resolveMinimumContributors({
  configured,
  nodeEnv,
}: {
  configured?: number;
  nodeEnv?: string;
}): number {
  if (configured !== undefined) {
    return configured;
  }
  return nodeEnv === 'development'
    ? GLOBAL_MIN_CONTRIBUTORS_DEVELOPMENT
    : GLOBAL_MIN_CONTRIBUTORS_DEFAULT;
}

export function isGlobalPromotable({
  leaderVotes,
  totalVotes,
  contributors,
  hasConsensus,
  minimumContributors,
}: {
  leaderVotes: number;
  totalVotes: number;
  contributors: number;
  hasConsensus: boolean;
  minimumContributors: number;
}): boolean {
  if (!hasConsensus) {
    return false;
  }
  return (
    leaderVotes * GLOBAL_APPROVAL_MIN_DENOMINATOR >=
      totalVotes * GLOBAL_APPROVAL_MIN_NUMERATOR &&
    contributors >= minimumContributors
  );
}
