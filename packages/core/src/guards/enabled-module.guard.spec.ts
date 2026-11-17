import { ForbiddenException } from '@nestjs/common';
import { EnabledModuleGuard } from './enabled-module.guard';

describe('EnabledModuleGuard', () => {
  const getAllAndOverride = jest.fn();
  const has = jest.fn();
  const read = jest.fn();
  const guard = new EnabledModuleGuard(
    { getAllAndOverride } as never,
    { has, read } as never,
  );

  const context = (user?: { sub?: string }) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    has.mockReturnValue(true);
  });

  it('skips @Public() routes without looking up modules', async () => {
    getAllAndOverride.mockReturnValueOnce(true);

    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it('skips routes without @RequiresEnabledModule', async () => {
    getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    await expect(guard.canActivate(context({ sub: 'user-1' }))).resolves.toBe(
      true,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('denies when JWT user is missing after auth', async () => {
    getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('finance');

    await expect(guard.canActivate(context())).resolves.toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('throws 403 when no descriptor owns the module slug', async () => {
    getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('retired');
    has.mockReturnValue(false);

    await expect(guard.canActivate(context({ sub: 'user-1' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(read).not.toHaveBeenCalled();
  });

  it('throws 403 when the module is missing or disabled', async () => {
    getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('finance');
    read.mockResolvedValue({ enabled: false, version: 2, config: {} });

    await expect(guard.canActivate(context({ sub: 'user-1' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(read).toHaveBeenCalledWith('user-1', 'finance');
  });

  it('allows when the module is enabled for the user', async () => {
    getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('finance');
    read.mockResolvedValue({ enabled: true, version: 2, config: {} });

    await expect(guard.canActivate(context({ sub: 'user-1' }))).resolves.toBe(
      true,
    );
  });
});
