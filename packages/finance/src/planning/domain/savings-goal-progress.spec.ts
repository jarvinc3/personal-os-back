import { resolveSavingsGoalProgress } from './savings-goal-progress';

describe('resolveSavingsGoalProgress', () => {
  it('uses the sum of contributions as the balance', () => {
    expect(
      resolveSavingsGoalProgress({
        targetAmount: 500,
        allocations: [{ amount: 120.5, kind: 'CONTRIBUTION' }],
      }),
    ).toEqual({ currentAmount: 120.5, isCompleted: false });
  });

  it('completes the goal when the sum reaches the target', () => {
    expect(
      resolveSavingsGoalProgress({
        targetAmount: 500,
        allocations: [{ amount: 500, kind: 'CONTRIBUTION' }],
      }),
    ).toEqual({ currentAmount: 500, isCompleted: true });
  });

  it('completes a goal with a zero target and no contributions', () => {
    expect(
      resolveSavingsGoalProgress({ targetAmount: 0, allocations: [] }),
    ).toEqual({ currentAmount: 0, isCompleted: true });
  });

  it('rounds the sum to cents', () => {
    expect(
      resolveSavingsGoalProgress({
        targetAmount: 10,
        allocations: [{ amount: 0.1 + 0.2, kind: 'CONTRIBUTION' }],
      }).currentAmount,
    ).toBe(0.3);
  });

  it('subtracts a plain withdrawal', () => {
    expect(
      resolveSavingsGoalProgress({
        targetAmount: 500,
        allocations: [
          { amount: 200, kind: 'CONTRIBUTION' },
          { amount: 50, kind: 'WITHDRAWAL' },
        ],
      }).currentAmount,
    ).toBe(150);
  });

  it('subtracts a spending withdrawal when the goal lets spending reduce', () => {
    expect(
      resolveSavingsGoalProgress({
        targetAmount: 500,
        allocations: [
          { amount: 200, kind: 'CONTRIBUTION' },
          { amount: 50, kind: 'WITHDRAWAL', transactionId: 'tx-1' },
        ],
        spendReducesProgress: true,
      }).currentAmount,
    ).toBe(150);
  });

  it('keeps a spending withdrawal when the goal opts out of spending', () => {
    expect(
      resolveSavingsGoalProgress({
        targetAmount: 500,
        allocations: [
          { amount: 200, kind: 'CONTRIBUTION' },
          { amount: 50, kind: 'WITHDRAWAL', transactionId: 'tx-1' },
        ],
        spendReducesProgress: false,
      }).currentAmount,
    ).toBe(200);
  });

  it('still subtracts a plain withdrawal when spending does not reduce', () => {
    expect(
      resolveSavingsGoalProgress({
        targetAmount: 500,
        allocations: [
          { amount: 200, kind: 'CONTRIBUTION' },
          { amount: 50, kind: 'WITHDRAWAL' },
        ],
        spendReducesProgress: false,
      }).currentAmount,
    ).toBe(150);
  });
});
