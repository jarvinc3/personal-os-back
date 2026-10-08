import { ResolveUserBaseCurrencyUseCase } from './resolve-user-base-currency';

describe('ResolveUserBaseCurrencyUseCase', () => {
  const findUserModuleBySlug = jest.fn();
  const configGet = jest.fn().mockReturnValue('DOP');
  const useCase = new ResolveUserBaseCurrencyUseCase(
    { findUserModuleBySlug } as never,
    { get: configGet } as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configGet.mockReturnValue('DOP');
  });

  it('normalizes the module config base currency', async () => {
    findUserModuleBySlug.mockResolvedValue({
      config: { baseCurrency: 'usd' },
    });

    await expect(useCase.execute('user-1')).resolves.toBe('USD');
    expect(findUserModuleBySlug).toHaveBeenCalledWith('user-1', 'finance');
  });

  it('falls back to env when the module row is missing', async () => {
    findUserModuleBySlug.mockResolvedValue(null);

    await expect(useCase.execute('user-1')).resolves.toBe('DOP');
  });

  it('falls back to env when the configured code is invalid', async () => {
    findUserModuleBySlug.mockResolvedValue({
      config: { baseCurrency: 'xx' },
    });

    await expect(useCase.execute('user-1')).resolves.toBe('DOP');
  });
});
