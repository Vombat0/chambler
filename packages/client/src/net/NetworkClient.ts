import { Client, Room } from 'colyseus.js';
import type { TableResyncMessage, TableSnapshot } from '@chambler/shared';
import { ReconnectPolicy } from './ReconnectPolicy.js';

/**
 * Connection lifecycle (B4):
 *
 *   idle → connecting → connected                    (fresh join / create)
 *   connected → reconnecting → resyncing → connected (transparent reconnect)
 *   connected → reconnecting → offline               (retries exhausted)
 *
 * `resyncing` means the socket is back but the authoritative table (the
 * `tableResync` message) has not been applied yet. `offline` means the client
 * gave up and runs locally; local changes made while offline are queued by
 * the NetBridge and reconciled (server wins) on the next resync.
 */
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'offline'
  | 'resyncing';

/** Summary of a durable save, as returned by `GET /api/saves`. */
export interface SaveSummary {
  roomCode: string;
  savedAt: number;
  bytes: number;
  objects: number;
}

/** Result of a forced save (`POST /api/rooms/:code/save`). */
export interface SaveRoomResult {
  code: string;
  savedAt: number;
  bytes: number;
  objects: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Client SDK surface used by NetworkClient (injectable for tests). */
export interface SdkLike {
  joinById(roomId: string, options?: Record<string, unknown>): Promise<Room>;
  create(roomName: string, options?: Record<string, unknown>): Promise<Room>;
  reconnect(reconnectionToken: string): Promise<Room>;
}

export interface NetworkClientOptions {
  url: string;
  maxReconnectAttempts?: number;
  /** HTTP API base; defaults to the websocket URL with http(s) scheme. */
  httpUrl?: string;
  /** Injectable colyseus.js Client (or a fake) for tests. */
  sdk?: SdkLike;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

function toHttpUrl(wsUrl: string): string {
  if (wsUrl.startsWith('ws://')) return `http://${wsUrl.slice('ws://'.length)}`;
  if (wsUrl.startsWith('wss://')) return `https://${wsUrl.slice('wss://'.length)}`;
  return wsUrl.replace(/\/+$/, '');
}



export class NetworkClient {
  private readonly client: SdkLike;
  private readonly policy: ReconnectPolicy;
  private readonly httpUrl: string;
  private readonly fetchImpl: typeof fetch;
  private room: Room | null = null;
  private status: ConnectionStatus = 'idle';
  private readonly statusListeners = new Set<(s: ConnectionStatus, attempt: number) => void>();
  private readonly resyncListeners = new Set<(m: TableResyncMessage) => void>();
  private disposed = false;
  private lastJoin: { code: string; name: string } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectionToken: string | null = null;

  constructor(opts: NetworkClientOptions | string) {
    const o: NetworkClientOptions = typeof opts === 'string' ? { url: opts } : opts;
    this.client = o.sdk ?? new Client(o.url);
    this.policy = new ReconnectPolicy({ maxAttempts: o.maxReconnectAttempts ?? 5 });
    this.httpUrl = o.httpUrl ?? toHttpUrl(o.url);
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  onStatus(cb: (s: ConnectionStatus, attempt: number) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status, this.policy.attempts);
    return () => this.statusListeners.delete(cb);
  }

  /**
   * B4: fired whenever the server sends a `tableResync` — after every join,
   * reconnect or reopen. The payload is the sanitised full-table state.
   */
  onResync(cb: (m: TableResyncMessage) => void): () => void {
    this.resyncListeners.add(cb);
    return () => this.resyncListeners.delete(cb);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getRoom(): Room | null {
    return this.room;
  }

  async join(code: string, name: string): Promise<Room> {
    this.lastJoin = { code, name };
    this.disposed = false;
    this.policy.reset();
    this.setStatus('connecting');
    try {
      const room = await this.client.joinById(code, { name });
      this.adoptRoom(room);
      this.setStatus('connected');
      return room;
    } catch (err) {
      this.setStatus('disconnected');
      throw err;
    }
  }

  async createAndJoin(name: string): Promise<Room> {
    this.lastJoin = { code: '', name };
    this.disposed = false;
    this.policy.reset();
    this.setStatus('connecting');
    try {
      const room = await this.client.create('table', { name });
      this.lastJoin = { code: room.roomId, name };
      this.adoptRoom(room);
      this.setStatus('connected');
      return room;
    } catch (err) {
      this.setStatus('disconnected');
      throw err;
    }
  }

  /* ------------------------- B4: persistence API ------------------------- */

  /** Forces a save of a live room (host only; pass your `room.sessionId`). */
  async saveRoom(code: string, sessionId: string): Promise<SaveRoomResult> {
    const url = `${this.httpUrl}/api/rooms/${encodeURIComponent(code)}/save?sessionId=${encodeURIComponent(sessionId)}`;
    const res = await this.fetchImpl(url, { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new HttpError(
        res.status,
        typeof body.error === 'string' ? body.error : 'SAVE_FAILED',
        typeof body.message === 'string' ? body.message : '',
      );
    }
    return {
      code: typeof body.code === 'string' ? body.code : code,
      savedAt: typeof body.savedAt === 'number' ? body.savedAt : Date.now(),
      bytes: typeof body.bytes === 'number' ? body.bytes : 0,
      objects: typeof body.objects === 'number' ? body.objects : 0,
    };
  }

  /** Lists durable saves, newest first. */
  async listSaves(): Promise<SaveSummary[]> {
    const res = await this.fetchImpl(`${this.httpUrl}/api/saves`);
    const body = (await res.json().catch(() => ({}))) as { saves?: unknown };
    if (!res.ok) {
      throw new HttpError(res.status, 'LIST_SAVES_FAILED', '');
    }
    return Array.isArray(body.saves) ? (body.saves as SaveSummary[]) : [];
  }

  /**
   * Returns the snapshot for a room code: the live room's current state when
   * the room is running, otherwise the durable save on disk (a restarted
   * table). Throws `HttpError` (404 missing, 400 unsupported version).
   */
  async getRoomSnapshot(code: string): Promise<TableSnapshot> {
    const res = await this.fetchImpl(`${this.httpUrl}/api/rooms/${encodeURIComponent(code)}/save`);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new HttpError(
        res.status,
        typeof body.error === 'string' ? body.error : 'SNAPSHOT_FAILED',
        typeof body.message === 'string' ? body.message : '',
      );
    }
    return body as unknown as TableSnapshot;
  }

  /**
   * Reopens a saved table by code (e.g. after a server restart) and joins it.
   * A 409 (room already live) is not an error: the table is simply joined.
   */
  async openFromSnapshot(code: string, name: string): Promise<Room> {
    const url = `${this.httpUrl}/api/rooms/${encodeURIComponent(code)}/reopen`;
    const res = await this.fetchImpl(url, { method: 'POST' });
    if (!res.ok && res.status !== 409) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new HttpError(
        res.status,
        typeof body.error === 'string' ? body.error : 'REOPEN_FAILED',
        typeof body.message === 'string' ? body.message : '',
      );
    }
    return this.join(code, name);
  }

  /* --------------------------- reconnection (B4) -------------------------- */

  private adoptRoom(room: Room): void {
    this.room = room;
    this.reconnectionToken = room.reconnectionToken || null;
    room.onLeave(() => {
      if (this.disposed || this.room !== room) return;
      // Keep the reconnection token: tryReconnect needs it after the drop.
      this.room = null;
      this.scheduleReconnect();
    });
    room.onError(() => {
      if (this.disposed) return;
      // onLeave drives the reconnection flow.
    });
    room.onMessage('tableResync', (message: unknown) => {
      this.handleResync(message);
    });
  }

  private handleResync(message: unknown): void {
    const m = message as Partial<TableResyncMessage> | null;
    if (!m || typeof m !== 'object' || !Array.isArray(m.objects)) return;
    const resync = m as TableResyncMessage;
    for (const cb of this.resyncListeners) {
      try {
        cb(resync);
      } catch {
        // listener errors must not break the status machine
      }
    }
    if (this.status === 'resyncing') this.setStatus('connected');
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    for (const cb of this.statusListeners) cb(s, this.policy.attempts);
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (!this.policy.canRetry()) {
      // B4: out of attempts — local mode. The offline queue in NetBridge
      // holds local changes; the next successful resync reconciles them.
      this.setStatus('offline');
      return;
    }
    this.setStatus('reconnecting');
    const delay = this.policy.nextDelayMs();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.tryReconnect();
    }, delay);
  }

  private async tryReconnect(): Promise<void> {
    if (this.disposed) return;
    const code = this.lastJoin?.code ?? '';
    const name = this.lastJoin?.name ?? '';

    // 1. Same-process reconnect: keeps session, seat, color and ownership
    //    (the server holds them for the reconnection window).
    if (this.reconnectionToken) {
      try {
        const room = await this.client.reconnect(this.reconnectionToken);
        this.onReconnected(room);
        return;
      } catch {
        this.reconnectionToken = null;
      }
    }

    if (!code) {
      this.scheduleReconnect();
      return;
    }

    // 2. Room still live (e.g. token expired but process survived): rejoin.
    try {
      const room = await this.client.joinById(code, { name });
      this.onReconnected(room);
      return;
    } catch {
      // room gone — maybe the server restarted
    }

    // 3. Server restarted: reopen the table from its durable save.
    try {
      const reopened = await this.fetchImpl(
        `${this.httpUrl}/api/rooms/${encodeURIComponent(code)}/reopen`,
        { method: 'POST' },
      );
      if (reopened.ok || reopened.status === 409) {
        const room = await this.client.joinById(code, { name });
        this.onReconnected(room);
        return;
      }
    } catch {
      // server unreachable; retry later
    }

    this.scheduleReconnect();
  }

  private onReconnected(room: Room): void {
    this.room = room;
    this.policy.reset();
    this.adoptRoom(room);
    // Waiting for the authoritative tableResync; handleResync flips to
    // 'connected'. If the server is older and never sends one, leave() is
    // the escape hatch — this state is still a working socket.
    this.setStatus('resyncing');
  }

  async leave(): Promise<void> {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.room) {
      await this.room.leave();
      this.room = null;
    }
    this.reconnectionToken = null;
    this.setStatus('idle');
  }
}
