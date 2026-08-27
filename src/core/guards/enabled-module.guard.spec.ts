import { ForbiddenException } from '@nestjs/common';
import { EnabledModuleGuard } from './enabled-module.guard';

describe('EnabledModuleGuard', () => {
  const getAllAndOverride = jest.fn();
  const findFirst = jest.fn();
  const guard = new EnabledModuleGuard(
    { getAllAndOverride } as never,
    { userModule: { findFirst } } as never,
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
  });

  it('skips @Public() routes without looking up modules', async () => {
    getAllAndOverride.mockReturnValueOnce(true);

    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('skips routes without @RequiresEnabledModule', async () => {
    getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    await expect(guard.canActivate(context({ sub: 'user-1' }))).resolves.toBe(
      true,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('denies when JWT user is missing after auth', async () => {
    getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('finance');

    await expect(guard.canActivate(context())).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('throws 403 when the module row is missing or disabled', async () => {
    getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('finance');
    findFirst.mockResolvedValue(null);

    await expect(guard.canActivate(context({ sub: 'user-1' }))).rejects.toThrow(
      ForbiddenException,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        isEnabled: true,
        module: { slug: 'finance' },
      },
      select: { id: true },
    });
  });

  it('allows when an enabled UserModule row exists', async () => {
    getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce('finance');
    findFirst.mockResolvedValue({ id: 'um-1' });

    await expect(guard.canActivate(context({ sub: 'user-1' }))).resolves.toBe(
      true,
    );
  });
});
