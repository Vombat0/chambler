/**
 * Builds the HTTP + WebSocket server without binding a port.
 *
 * `index.ts` starts it; tests boot the same object with @colyseus/testing so
 * they exercise the real express/Colyseus stack.
 */
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type RequestHandler } from 'express';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport, type TransportOptions } from '@colyseus/ws-transport';
import { SNAPSHOT_VERSION_UNSUPPORTED } from '@chambler/shared';
import { isOriginAllowed, loadConfig, type ServerConfig } from './config.js';
import { normalizeRoomCode } from './lobby/roomCode.js';
import { TABLE_ROOM_NAME, TableRoom, configureTableRoom } from './rooms/TableRoom.js';
import { toPlayerInfo } from './rooms/TableState.js';
import { SnapshotStore, configureSnapshotStore, getSnapshotStore } from './persist/SnapshotStore.js';

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

/**
 * Tek servis dağıtımında frontend ve API aynı host'tan gelir. Bu durumda
 * `Origin` başlığı isteğin kendi `Host`'u ile eşleşir ve allow-list'e
 * ihtiyaç duymadan kabul edilir (Render.com: sıfır CORS yapılandırması).
 */
function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function corsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (isOriginAllowed(origin, allowedOrigins) || isSameOrigin(origin, req.headers.host))) {
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
    if (isOriginAllowed(origin, config.corsOrigins) || isSameOrigin(origin, info.req.headers.host)) {
      done(true);
      return;
    }
    done(false, 403, 'origin_not_allowed');
  };
}

export function createChamblerServer(overrides: Partial<ServerConfig> = {}): ChamblerServer {
  const config: ServerConfig = { ...loadConfig(), ...overrides };
  configureTableRoom(config);
  configureSnapshotStore(
    new SnapshotStore({
      dir: config.snapshotDir,
      maxSaves: config.maxSaves,
      maxBytes: config.snapshotMaxBytes,
    }),
  );

  const app = express();
  app.disable('x-powered-by');
  app.use(corsMiddleware(config.corsOrigins));
  app.use(express.json({ limit: '1mb' }));

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

  // ----------------------- B4: persistence API -----------------------

  /**
   * Saves a live room now. Host only: the caller proves it by passing its
   * `sessionId` (query parameter or JSON body); it must match the room host.
   */
  app.post('/api/rooms/:code/save', (req, res) => {
    const code = normalizeRoomCode(req.params.code);
    if (code === null) {
      res.status(400).json({
        error: 'ROOM_CODE_INVALID',
        message: 'Room codes are 5 characters from A-Z (except I, L, O) and 2-9.',
      });
      return;
    }
    const room = matchMaker.getLocalRoomById(code) as TableRoom | undefined;
    if (!room || !room.state) {
      res.status(404).json({ error: 'ROOM_NOT_FOUND', message: `No live room with code ${code}.` });
      return;
    }
    const body = (req.body ?? {}) as { sessionId?: unknown };
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : body.sessionId;
    if (typeof sessionId !== 'string' || sessionId !== room.state.hostId) {
      res.status(403).json({ error: 'NOT_HOST', message: 'Only the host can force a save.' });
      return;
    }
    const result = room.persistNow();
    if (!result.ok) {
      res.status(result.code === 'TOO_LARGE' ? 413 : 400).json({
        error: result.code,
        message: result.message,
      });
      return;
    }
    res.status(200).json({
      code,
      savedAt: result.savedAt,
      bytes: result.bytes,
      objects: room.state.objects.size,
      players: [...room.state.players.values()].map(toPlayerInfo),
    });
  });

  /**
   * Returns the room's snapshot. A live room answers with its current state;
   * otherwise the durable save on disk is returned (a restarted table).
   */
  app.get('/api/rooms/:code/save', (req, res) => {
    const code = normalizeRoomCode(req.params.code);
    if (code === null) {
      res.status(400).json({
        error: 'ROOM_CODE_INVALID',
        message: 'Room codes are 5 characters from A-Z (except I, L, O) and 2-9.',
      });
      return;
    }
    const room = matchMaker.getLocalRoomById(code) as TableRoom | undefined;
    if (room && room.state) {
      res.status(200).json(room.buildSnapshot());
      return;
    }
    const load = getSnapshotStore().load(code);
    if (load.status === 'ok') {
      res.status(200).json(load.snapshot);
      return;
    }
    if (load.status === 'unsupported') {
      res.status(400).json({
        error: SNAPSHOT_VERSION_UNSUPPORTED,
        message: `Save for ${code} uses schema version ${load.foundVersion}; this server understands a different one.`,
      });
      return;
    }
    res.status(404).json({
      error: 'SNAPSHOT_NOT_FOUND',
      message: load.status === 'corrupt' ? `Save for ${code} was corrupt and has been quarantined.` : `No save for code ${code}.`,
    });
  });

  /** Lists saved tables, newest first. */
  app.get('/api/saves', (_req, res) => {
    res.status(200).json({ saves: getSnapshotStore().list() });
  });

  /**
   * Reopens a saved table by code: creates a live room restored from the
   * snapshot. 409 when the room is already live (just join it), 404 when no
   * save exists, 400 when the save's schema version is not supported.
   */
  app.post('/api/rooms/:code/reopen', async (req, res) => {
    const code = normalizeRoomCode(req.params.code);
    if (code === null) {
      res.status(400).json({
        error: 'ROOM_CODE_INVALID',
        message: 'Room codes are 5 characters from A-Z (except I, L, O) and 2-9.',
      });
      return;
    }
    if (matchMaker.getLocalRoomById(code)) {
      res.status(409).json({
        error: 'ROOM_ALREADY_LIVE',
        message: `Room ${code} is live; join it instead of reopening it.`,
      });
      return;
    }
    const load = getSnapshotStore().load(code);
    if (load.status === 'missing' || load.status === 'corrupt') {
      res.status(404).json({
        error: 'SNAPSHOT_NOT_FOUND',
        message: load.status === 'corrupt' ? `Save for ${code} was corrupt and has been quarantined.` : `No save for code ${code}.`,
      });
      return;
    }
    if (load.status === 'unsupported') {
      res.status(400).json({
        error: SNAPSHOT_VERSION_UNSUPPORTED,
        message: `Save for ${code} uses schema version ${load.foundVersion}; this server understands a different one.`,
      });
      return;
    }
    try {
      const cache = await matchMaker.createRoom(TABLE_ROOM_NAME, { restoreCode: code });
      res.status(200).json({
        code,
        roomId: cache.roomId,
        restored: true,
        createdAt: load.snapshot.createdAt,
        objects: load.snapshot.objects.length,
        players: load.snapshot.players.length,
      });
    } catch (error) {
      res.status(500).json({
        error: 'REOPEN_FAILED',
        message: `Could not reopen ${code}: ${String(error)}`,
      });
    }
  });

  /**
   * R0 — tek servis dağıtımı: `packages/client/dist` varsa frontend'i aynı
   * origin'den sunar. API olmayan GET istekleri SPA için index.html'e düşer,
   * böylece Render.com'da tek URL ve sıfır CORS ile çalışır.
   */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = [
    path.resolve(process.cwd(), 'packages/client/dist'),
    path.resolve(here, '../../client/dist'),
  ].find((candidate) => existsSync(path.join(candidate, 'index.html')));

  if (clientDist) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET') {
        next();
        return;
      }
      if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
        next();
        return;
      }
      // Uzantılı istekler (eksik JS/CSS/görsel) SPA'ya değil 404'e gider.
      if (path.extname(req.path) !== '') {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

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
