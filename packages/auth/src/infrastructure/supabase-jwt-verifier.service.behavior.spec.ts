import { generateKeyPairSync } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { createJwksClient } from './jwks-rsa.loader';
import { SupabaseJwtVerifierService } from './supabase-jwt-verifier.service';

jest.mock('./jwks-rsa.loader', () => ({
  createJwksClient: jest.fn(),
}));

const mockedCreateJwksClient = createJwksClient as jest.MockedFunction<
  typeof createJwksClient
>;

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const { privateKey: otherPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const issuer = 'https://project.supabase.co/auth/v1';
const audience = 'authenticated';
const config = {
  getOrThrow: jest.fn().mockReturnValue('https://project.supabase.co'),
} as never;

function createService(): SupabaseJwtVerifierService {
  return new SupabaseJwtVerifierService(config);
}

function signToken(
  payload: Record<string, unknown> = {},
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(
    {
      sub: 'user-1',
      email: 'user@example.com',
      role: 'authenticated',
      ...payload,
    },
    privateKey,
    {
      algorithm: 'RS256',
      keyid: 'kid-1',
      issuer,
      audience,
      expiresIn: '5m',
      ...options,
    },
  );
}

beforeEach(() => {
  mockedCreateJwksClient.mockReturnValue({
    getSigningKey: jest.fn((kid: string) => {
      if (kid !== 'kid-1') {
        return Promise.reject(new Error('unknown kid'));
      }
      return Promise.resolve({ getPublicKey: () => publicKey });
    }),
  });
});

describe('SupabaseJwtVerifierService behavior', () => {
  it('accepta un token RS256 válido y devuelve el contexto', async () => {
    await expect(
      createService().verifyAccessToken(signToken()),
    ).resolves.toEqual({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'authenticated',
    });
  });

  it('rechaza una firma hecha con otra clave', async () => {
    const token = jwt.sign(
      { sub: 'user-1', role: 'authenticated' },
      otherPrivateKey,
      {
        algorithm: 'RS256',
        keyid: 'kid-1',
        issuer,
        audience,
        expiresIn: '5m',
      },
    );

    await expect(
      createService().verifyAccessToken(token),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token vencido', async () => {
    await expect(
      createService().verifyAccessToken(signToken({}, { expiresIn: -60 })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un emisor distinto', async () => {
    await expect(
      createService().verifyAccessToken(
        signToken({}, { issuer: 'https://otro.supabase.co/auth/v1' }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza una audiencia distinta', async () => {
    await expect(
      createService().verifyAccessToken(signToken({}, { audience: 'otra' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token HS256 aunque traiga el mismo kid', async () => {
    const token = jwt.sign({ sub: 'user-1', role: 'authenticated' }, 'secret', {
      algorithm: 'HS256',
      keyid: 'kid-1',
      issuer,
      audience,
      expiresIn: '5m',
    });

    await expect(
      createService().verifyAccessToken(token),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un kid que no está en el JWKS', async () => {
    await expect(
      createService().verifyAccessToken(signToken({}, { keyid: 'kid-2' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un token sin sub', async () => {
    await expect(
      createService().verifyAccessToken(signToken({ sub: undefined })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
