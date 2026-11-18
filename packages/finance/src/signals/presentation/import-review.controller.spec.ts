import { TIMEOUT_MS_KEY } from '@personal-os/core';
import { ImportReviewController } from './import-review.controller';
import { ResolveImportReviewDto } from './dto/resolve-import-review.dto';

function timeoutFor(method: string): number | undefined {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    ImportReviewController.prototype,
    method,
  )?.value;
  return typeof handler === 'function'
    ? Reflect.getMetadata(TIMEOUT_MS_KEY, handler)
    : undefined;
}

describe('ImportReviewController', () => {
  it('da al endpoint de resolución el margen de la transacción', () => {
    expect(timeoutFor('resolve')).toBe(30_000);
    expect(timeoutFor('list')).toBeUndefined();
  });

  it('pasa usuario, import y decisión al servicio', async () => {
    const resolutions = {
      listForUser: jest.fn(),
      resolve: jest.fn().mockResolvedValue({ id: 'import-1' }),
    };
    const controller = new ImportReviewController(resolutions as never);
    const input = Object.assign(new ResolveImportReviewDto(), {
      action: 'SET_DATE' as const,
      transactionDate: '2026-10-30T12:00:00Z',
    });

    await expect(
      controller.resolve('user-1', 'import-1', input),
    ).resolves.toEqual({ id: 'import-1' });
    expect(resolutions.resolve).toHaveBeenCalledWith({
      userId: 'user-1',
      importId: 'import-1',
      input,
    });
  });
});
