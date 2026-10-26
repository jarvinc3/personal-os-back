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
} from '@personal-os/auth';
import { resolveNotificationsCorsOrigin } from './notifications-cors';

interface NotificationsSocketData {
  user?: AuthUserContext;
}

type SocketWithUser = Socket<NotificationsSocketData>;

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: resolveNotificationsCorsOrigin({
      corsOrigin: process.env.CORS_ORIGIN,
      previewPatterns: process.env.CORS_ORIGIN_PATTERNS,
      isProduction: process.env.NODE_ENV === 'production',
    }),
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
