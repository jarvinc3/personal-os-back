import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  SupabaseJwtVerifierService,
  type AuthUserContext,
} from '../../auth';

interface NotificationsSocketData {
  user?: AuthUserContext;
}

type SocketWithUser = Socket<NotificationsSocketData>;

function resolveNotificationsCorsOrigin():
  | string
  | string[]
  | boolean
  | ((
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => void) {
  const corsOrigin = process.env.CORS_ORIGIN ?? '';
  const corsOrigins = corsOrigin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    if (corsOrigins.length === 0) {
      return false;
    }
    return corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins;
  }

  return (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (corsOrigins.includes(origin) || corsOrigins.includes('*')) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} not allowed by CORS`), false);
  };
}

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: resolveNotificationsCorsOrigin(),
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwtVerifier: SupabaseJwtVerifierService) {}

  async handleConnection(client: SocketWithUser): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const user = await this.jwtVerifier.verifyAccessToken(token);
      client.data.user = user;
      await client.join(`user:${user.sub}`);
    } catch {
      client.disconnect(true);
    }
  }

  emitToUser(userId: string, event: string, payload: Record<string, unknown>) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  @SubscribeMessage('ping')
  ping(
    @ConnectedSocket() client: SocketWithUser,
    @MessageBody() payload: unknown,
  ) {
    return {
      ok: true,
      userId: client.data.user?.sub ?? null,
      payload,
      ts: new Date().toISOString(),
    };
  }

  private extractToken(client: SocketWithUser): string | undefined {
    const authHeader = client.handshake.headers.authorization;
    if (typeof authHeader === 'string') {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer' && token) {
        return token;
      }
    }

    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }

    return undefined;
  }
}
