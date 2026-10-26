import {
  isGlobalPromotable,
  resolveMinimumContributors,
} from './knowledge-policy';

describe('AI-4 knowledge policy', () => {
  it('resuelve el mínimo de colaboradores por entorno', () => {
    expect(resolveMinimumContributors({ nodeEnv: 'development' })).toBe(1);
    expect(resolveMinimumContributors({ nodeEnv: 'production' })).toBe(3);
    expect(resolveMinimumContributors({ nodeEnv: 'test' })).toBe(3);
    expect(
      resolveMinimumContributors({ configured: 2, nodeEnv: 'production' }),
    ).toBe(2);
  });

  it('exige dos tercios, desempate y el mínimo de colaboradores', () => {
    const base = {
      totalVotes: 3,
      contributors: 2,
      hasConsensus: true,
      minimumContributors: 2,
    };
    expect(isGlobalPromotable({ ...base, leaderVotes: 2 })).toBe(true);
    expect(isGlobalPromotable({ ...base, leaderVotes: 1 })).toBe(false);
    expect(
      isGlobalPromotable({ ...base, leaderVotes: 2, hasConsensus: false }),
    ).toBe(false);
    expect(
      isGlobalPromotable({ ...base, leaderVotes: 2, contributors: 1 }),
    ).toBe(false);
    expect(
      isGlobalPromotable({
        ...base,
        totalVotes: 6,
        leaderVotes: 4,
        contributors: 4,
      }),
    ).toBe(true);
    expect(
      isGlobalPromotable({
        ...base,
        totalVotes: 6,
        leaderVotes: 3,
        contributors: 3,
      }),
    ).toBe(false);
  });
});
