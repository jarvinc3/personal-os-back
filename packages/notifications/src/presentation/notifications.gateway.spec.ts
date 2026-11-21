import { NotificationsGateway } from './notifications.gateway';

type GatewaySocket = {
  handshake: {
    headers: { authorization?: string };
    auth: { token?: string };
  };
  data: { user?: unknown };
  disconnect: jest.Mock;
  join: jest.Mock;
};

function createSocket(
  authorization?: string,
  authToken?: string,
): GatewaySocket {
  return {
    handshake: {
      headers: authorization ? { authorization } : {},
      auth: authToken ? { token: authToken } : {},
    },
    data: {},
    disconnect: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
  };
}

function createGateway(verifyAccessToken: jest.Mock) {
  return new NotificationsGateway({ verifyAccessToken } as never);
}

describe('NotificationsGateway', () => {
  it('conecta un token válido y entra al room del usuario', async () => {
    const verifyAccessToken = jest.fn().mockResolvedValue({
      sub: 'user-1',
      email: null,
      role: 'authenticated',
    });
    const socket = createSocket('Bearer token-1');

    await createGateway(verifyAccessToken).handleConnection(socket as never);

    expect(verifyAccessToken).toHaveBeenCalledWith('token-1');
    expect(socket.data.user).toMatchObject({ sub: 'user-1' });
    expect(socket.join).toHaveBeenCalledWith('user:user-1');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('acepta el token del handshake auth', async () => {
    const verifyAccessToken = jest.fn().mockResolvedValue({
      sub: 'user-2',
      email: null,
      role: 'authenticated',
    });
    const socket = createSocket(undefined, 'token-2');

    await createGateway(verifyAccessToken).handleConnection(socket as never);

    expect(verifyAccessToken).toHaveBeenCalledWith('token-2');
    expect(socket.join).toHaveBeenCalledWith('user:user-2');
  });

  it('desconecta cuando no hay token', async () => {
    const verifyAccessToken = jest.fn();
    const socket = createSocket();

    await createGateway(verifyAccessToken).handleConnection(socket as never);

    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('desconecta cuando el verificador rechaza el token', async () => {
    const verifyAccessToken = jest.fn().mockRejectedValue(new Error('invalid'));
    const socket = createSocket('Bearer invalid');

    await createGateway(verifyAccessToken).handleConnection(socket as never);

    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
