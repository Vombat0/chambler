/**
 * Builds the HTTP + WebSocket server without binding a port.
 *
 * `index.ts` starts it; tests boot the same object with @colyseus/testing so
 * they exercise the real express/Colyseus stack.
 */
import http from 'node:http';
import express, { type RequestHandler } from 'express';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport, type TransportOptions } from '@colyseus/ws-transport';
import { isOriginAllowed, loadConfig, type ServerConfig } from './config.js';
import { normalizeRoomCode } from './lobby/roomCode.js';
import { TABLE_ROOM_NAME, TableRoom, configureTableRoom } from './rooms/TableRoom.js';
import { toPlayerInfo } from './rooms/TableState.js';

export interface ChamblerServer {
  readonly config: ServerConfig;
  readonly app: express.Express;
  readonly httpServer: http.Server;
  readonly gameServer: Server;
  /** Binds the port (no-op when already listening) and returns the actual port. */
  start(): Promise<number>;
  /** Stops matchmaking + WebSockets and closes the HTTP server. Idempotent. */
  stop(): Promise<void>;
}

function corsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin, allowedOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

/** Rejects WebSocket handshakes from browsers on origins outside the allow-list. */
function verifyClient(
  config: ServerConfig,
): NonNullable<TransportOptions['verifyClient']> {
  return (info, done) => {
    const origin = info.origin || info.req.headers.origin;
    if (isOriginAllowed(origin, config.corsOrigins)) {
      done(true);
      return;
    }
    done(false, 403, 'origin_not_allowed');
  };
}

export function createChamblerServer(overrides: Partial<ServerConfig> = {}): ChamblerServer {
  const config: ServerConfig = { ...loadConfig(), ...overrides };
  configureTableRoom(config);

  const app = express();
  app.disable('x-powered-by');
  app.use(corsMiddleware(config.corsOrigins));

  // Kept from A1: liveness probe for deploys and the smoke test.
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'chambler-server' });
  });

  /**
   * Room-code lookup. The roomId *is* the code, so clients can also join with
   * `client.joinById(code)`; this endpoint exists to turn a mistyped code into
   * a clear 404 instead of a generic matchmaking error.
   */
  app.get('/api/rooms/:code', (req, res) => {
    const code = normalizeRoomCode(req.params.code);
    if (code === null) {
      res.status(400).json({
        error: 'ROOM_CODE_INVALID',
        message: 'Room codes are 5 characters from A-Z (except I, L, O) and 2-9.',
      });
      return;
    }
    // Local process only; multi-process deployments need a shared driver (B4).
    const room = matchMaker.getLocalRoomById(code) as TableRoom | undefined;
    if (!room || !room.state) {
      res.status(404).json({
        error: 'ROOM_NOT_FOUND',
        message: `No room with code ${code}.`,
      });
      return;
    }
    res.status(200).json({
      code,
      roomId: room.roomId,
      maxPlayers: room.state.maxPlayers,
      players: [...room.state.players.values()].map(toPlayerInfo),
    });
  });

  const httpServer = http.createServer(app);
  const transport = new WebSocketTransport({
    server: httpServer,
    maxPayload: config.maxPayloadBytes,
    verifyClient: verifyClient(config),
  });
  const gameServer = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
  });
  gameServer.define(TABLE_ROOM_NAME, TableRoom);

  let stopPromise: Promise<void> | null = null;

  return {
    config,
    app,
    httpServer,
    gameServer,
    async start(): Promise<number> {
      if (!httpServer.listening) {
        await gameServer.listen(config.port, config.host);
      }
      const address = httpServer.address();
      return typeof address === 'object' && address !== null ? address.port : config.port;
    },
    stop(): Promise<void> {
      stopPromise ??= (async () => {
        await gameServer.gracefullyShutdown(false);
        await new Promise<void>((resolve) => {
          if (!httpServer.listening) {
            resolve();
            return;
          }
          httpServer.close(() => resolve());
        });
      })();
      return stopPromise;
    },
  };
}
