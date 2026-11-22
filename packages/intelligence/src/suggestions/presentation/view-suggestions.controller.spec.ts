import { TIMEOUT_MS_KEY } from '@personal-os/core';
import { ViewSuggestionsController } from './view-suggestions.controller';

function timeoutFor(method: string): number | undefined {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    ViewSuggestionsController.prototype,
    method,
  )?.value;
  return typeof handler === 'function'
    ? Reflect.getMetadata(TIMEOUT_MS_KEY, handler)
    : undefined;
}

describe('ViewSuggestionsController', () => {
  it('da tiempo a la generación cuando la caché de la vista venció', () => {
    expect(timeoutFor('resolveForView')).toBe(30_000);
  });

  it('deja el descarte en el límite global', () => {
    expect(timeoutFor('dismiss')).toBeUndefined();
  });
});
