import { TIMEOUT_MS_KEY } from '@personal-os/core';
import { AiConversationController } from './ai-conversation.controller';

function timeoutFor(method: string): number | undefined {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    AiConversationController.prototype,
    method,
  )?.value;
  return typeof handler === 'function'
    ? Reflect.getMetadata(TIMEOUT_MS_KEY, handler)
    : undefined;
}

describe('AiConversationController', () => {
  it('da a las rutas del agente el tope que cubre varias rondas de herramientas', () => {
    expect(timeoutFor('create')).toBe(30_000);
    expect(timeoutFor('sendMessage')).toBe(30_000);
  });

  it('deja las lecturas y el borrado en el límite global', () => {
    expect(timeoutFor('list')).toBeUndefined();
    expect(timeoutFor('latest')).toBeUndefined();
    expect(timeoutFor('get')).toBeUndefined();
    expect(timeoutFor('remove')).toBeUndefined();
  });
});
