import { BUDGET_ROLLOVER, carriedOverFrom } from './budget-rollover';

describe('carriedOverFrom', () => {
  it('carries nothing when rollover is NONE', () => {
    expect(
      carriedOverFrom({
        rollover: BUDGET_ROLLOVER.NONE,
        previousLimit: 1000,
        previousCarriedOver: 100,
        previousSpent: 200,
      }),
    ).toBe(0);
  });

  it('carries the surplus, including the previous carry', () => {
    expect(
      carriedOverFrom({
        rollover: BUDGET_ROLLOVER.SURPLUS,
        previousLimit: 1000,
        previousCarriedOver: 100,
        previousSpent: 200,
      }),
    ).toBe(900);
  });

  it('floors a deficit at zero for SURPLUS', () => {
    expect(
      carriedOverFrom({
        rollover: BUDGET_ROLLOVER.SURPLUS,
        previousLimit: 1000,
        previousCarriedOver: 0,
        previousSpent: 1200,
      }),
    ).toBe(0);
  });

  it('carries a deficit forward for SURPLUS_AND_DEFICIT', () => {
    expect(
      carriedOverFrom({
        rollover: BUDGET_ROLLOVER.SURPLUS_AND_DEFICIT,
        previousLimit: 1000,
        previousCarriedOver: 0,
        previousSpent: 1200,
      }),
    ).toBe(-200);
  });
});
