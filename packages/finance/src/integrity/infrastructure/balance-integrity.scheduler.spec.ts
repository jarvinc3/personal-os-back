import { BalanceIntegrityScheduler } from './balance-integrity.scheduler';

function build() {
  const repo = {
    listUserIdsWithProducts: jest.fn().mockResolvedValue(['user-1', 'user-2']),
  };
  const integrity = { runForUser: jest.fn().mockResolvedValue(0) };
  const scheduler = new BalanceIntegrityScheduler(
    repo as never,
    integrity as never,
  );
  return { scheduler, integrity };
}

describe('BalanceIntegrityScheduler', () => {
  it('checks every user that has products', async () => {
    const { scheduler, integrity } = build();
    await scheduler.handleCron();

    expect(integrity.runForUser).toHaveBeenCalledTimes(2);
    expect(integrity.runForUser).toHaveBeenNthCalledWith(1, 'user-1');
    expect(integrity.runForUser).toHaveBeenNthCalledWith(2, 'user-2');
  });

  it('continues with the next user after a failure', async () => {
    const { scheduler, integrity } = build();
    integrity.runForUser.mockRejectedValueOnce(new Error('db down'));

    await scheduler.handleCron();

    expect(integrity.runForUser).toHaveBeenCalledTimes(2);
  });
});
