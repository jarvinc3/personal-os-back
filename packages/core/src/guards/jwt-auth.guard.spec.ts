import { UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

function createGuard(): JwtAuthGuard {
  const reflector = { getAllAndOverride: jest.fn() };
  return new JwtAuthGuard(reflector as unknown as Reflector);
}

describe('JwtAuthGuard.handleRequest', () => {
  it('returns the authenticated user', () => {
    const user = { sub: 'user-1' };

    expect(createGuard().handleRequest(null, user)).toBe(user);
  });

  it('rethrows the error passport rejected with', () => {
    const failure = new Error('jwks unreachable');

    expect(() => createGuard().handleRequest(failure, false)).toThrow(failure);
  });

  it('rejects a request without a user', () => {
    expect(() => createGuard().handleRequest(null, false)).toThrow(
      UnauthorizedException,
    );
  });
});
