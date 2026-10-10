import { resolveSavingsGoalProgress } from './savings-goal-progress';

describe('resolveSavingsGoalProgress', () => {
  it('uses the sum of contributions as the balance', () => {
    expect(
      resolveSavingsGoalProgress({
        targetAmount: 500,
        contributedAmount: 120.5,
      }),
    ).toEqual({ currentAmount: 120.5, isCompleted: false });
  });

  it('completes the goal when the sum reaches the target', () => {
    expect(
      resolveSavingsGoalProgress({ targetAmount: 500, contributedAmount: 500 }),
    ).toEqual({ currentAmount: 500, isCompleted: true });
  });

  it('completes a goal with a zero target and no contributions', () => {
    expect(
      resolveSavingsGoalProgress({ targetAmount: 0, contributedAmount: 0 }),
    ).toEqual({ currentAmount: 0, isCompleted: true });
  });

  it('rounds the sum to cents', () => {
    expect(
      resolveSavingsGoalProgress({
        targetAmount: 10,
        contributedAmount: 0.1 + 0.2,
      }).currentAmount,
    ).toBe(0.3);
  });
});
