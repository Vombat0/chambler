import { Client, Room } from 'colyseus.js';
import { ReconnectPolicy } from './ReconnectPolicy.js';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface NetworkClientOptions {
  url: string;
  maxReconnectAttempts?: number;
}

export class NetworkClient {
  private readonly client: Client;
  private readonly policy: ReconnectPolicy;
  private room: Room | null = null;
  private status: ConnectionStatus = 'idle';
  private readonly statusListeners = new Set<(s: ConnectionStatus, attempt: number) => void>();
  private disposed = false;
  private lastJoin: { code: string; name: string } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: NetworkClientOptions | string) {
    const url = typeof opts === 'string' ? opts : opts.url;
    const max = typeof opts === 'string' ? 5 : (opts.maxReconnectAttempts ?? 5);
    this.client = new Client(url);
    this.policy = new ReconnectPolicy({ maxAttempts: max });
  }

  onStatus(cb: (s: ConnectionStatus, attempt: number) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status, this.policy.attempts);
    return () => this.statusListeners.delete(cb);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getRoom(): Room | null {
    return this.room;
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    for (const cb of this.statusListeners) cb(s, this.policy.attempts);
  }

  async join(code: string, name: string): Promise<Room> {
    this.lastJoin = { code, name };
    this.disposed = false;
    this.policy.reset();
    this.setStatus('connecting');
    try {
      const room = await this.client.joinById(code, { name });
      this.room = room;
      this.setStatus('connected');
      this.wireRoom(room);
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
      this.room = room;
      this.lastJoin = { code: room.roomId, name };
      this.setStatus('connected');
      this.wireRoom(room);
      return room;
    } catch (err) {
      this.setStatus('disconnected');
      throw err;
    }
  }

  private wireRoom(room: Room): void {
    room.onLeave(() => {
      if (this.disposed) return;
      this.room = null;
      this.scheduleReconnect();
    });
    room.onError(() => {
      if (this.disposed) return;
      // let onLeave handle reconnect
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (!this.policy.canRetry()) {
      this.setStatus('disconnected');
      return;
    }
    this.setStatus('reconnecting');
    const delay = this.policy.nextDelayMs();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      void this.tryReconnect();
    }, delay);
  }

  private async tryReconnect(): Promise<void> {
    if (this.disposed || !this.lastJoin) return;
    this.setStatus('connecting');
    try {
      const room = await this.client.joinById(this.lastJoin.code, { name: this.lastJoin.name });
      this.room = room;
      this.policy.reset();
      this.setStatus('connected');
      this.wireRoom(room);
    } catch {
      this.scheduleReconnect();
    }
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
    this.setStatus('idle');
  }
}
