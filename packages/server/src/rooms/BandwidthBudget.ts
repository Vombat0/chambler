/**
 * Room-wide transform bandwidth budget with fair per-player trimming (B3).
 *
 * A malicious or badly written client can ask the server to rebroadcast an
 * unbounded number of transform frames. This class answers a single question:
 * "may this player spend `bytes` outbound bytes right now?".
 *
 * - The room has a hard cap (`roomBytesPerSecond`, default 64 KB/s, from
 *   `TRANSFORM_BUDGET_BYTES_PER_SEC`).
 * - Inside that cap every seated player gets an equal share
 *   (`roomBytesPerSecond / maxPlayers`), so one client cannot starve the table:
 *   its frames are trimmed, the session stays connected.
 * - Accounting is a fixed 1 s window; the window rolls over lazily on the next
 *   call, which keeps it allocation-free and injectable-clock friendly.
 */

export type BudgetRejection = 'room' | 'player';

export interface BudgetDecision {
  allowed: boolean;
  /** Present when `allowed` is false. */
  reason?: BudgetRejection;
  /** Bytes left in the current window after this decision (room level). */
  roomRemaining: number;
}

export interface BandwidthBudgetOptions {
  /** Room-wide outbound cap in bytes per second. */
  roomBytesPerSecond: number;
  /** Number of seats the room budget is divided between. */
  players: number;
  /** Window length in ms (default 1000). */
  windowMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export interface BandwidthBudgetStats {
  windowBytes: number;
  windowDroppedBytes: number;
  windowDroppedFrames: number;
  totalBytes: number;
  totalDroppedBytes: number;
  totalDroppedFrames: number;
  /** Player id -> bytes accepted in the current window. */
  perPlayer: Record<string, number>;
  /** Player id -> frames trimmed in the current window. */
  perPlayerDropped: Record<string, number>;
}

export class BandwidthBudget {
  readonly roomBytesPerSecond: number;
  readonly windowMs: number;
  private readonly now: () => number;
  private players: number;
  private windowStart: number;
  private windowBytes = 0;
  private windowDroppedBytes = 0;
  private windowDroppedFrames = 0;
  private totalBytes = 0;
  private totalDroppedBytes = 0;
  private totalDroppedFrames = 0;
  private readonly perPlayer = new Map<string, number>();
  private readonly perPlayerDropped = new Map<string, number>();

  constructor(opts: BandwidthBudgetOptions) {
    this.roomBytesPerSecond = Math.max(1, Math.floor(opts.roomBytesPerSecond));
    this.players = Math.max(1, Math.floor(opts.players));
    this.windowMs = Math.max(50, opts.windowMs ?? 1000);
    this.now = opts.now ?? (() => Date.now());
    this.windowStart = this.now();
  }

  /** Outbound bytes a single player may spend per second. */
  get perPlayerBytesPerSecond(): number {
    return Math.max(1, Math.floor(this.roomBytesPerSecond / this.players));
  }

  /** Recomputes the fair share when the seat count changes. */
  setPlayers(players: number): void {
    this.players = Math.max(1, Math.floor(players));
  }

  get playerCount(): number {
    return this.players;
  }

  /** Rolls the window when it has elapsed. */
  tick(now: number = this.now()): void {
    if (now - this.windowStart < this.windowMs) return;
    this.windowStart = now;
    this.windowBytes = 0;
    this.windowDroppedBytes = 0;
    this.windowDroppedFrames = 0;
    this.perPlayer.clear();
    this.perPlayerDropped.clear();
  }

  /** Asks permission to spend `bytes` outbound for `playerId`. */
  tryConsume(playerId: string, bytes: number, now: number = this.now()): BudgetDecision {
    this.tick(now);
    const cost = Math.max(0, Math.ceil(bytes));
    const used = this.perPlayer.get(playerId) ?? 0;
    const share = this.perPlayerBytesPerSecond;
    const roomRemaining = Math.max(0, this.roomBytesPerSecond - this.windowBytes);

    let reason: BudgetRejection | undefined;
    if (this.windowBytes + cost > this.roomBytesPerSecond) reason = 'room';
    else if (used + cost > share) reason = 'player';

    if (reason) {
      this.windowDroppedBytes += cost;
      this.windowDroppedFrames += 1;
      this.totalDroppedBytes += cost;
      this.totalDroppedFrames += 1;
      this.perPlayerDropped.set(playerId, (this.perPlayerDropped.get(playerId) ?? 0) + 1);
      return { allowed: false, reason, roomRemaining };
    }

    this.windowBytes += cost;
    this.totalBytes += cost;
    this.perPlayer.set(playerId, used + cost);
    return { allowed: true, roomRemaining: Math.max(0, this.roomBytesPerSecond - this.windowBytes) };
  }

  /** Bytes this player may still spend in the current window. */
  remainingFor(playerId: string): number {
    const used = this.perPlayer.get(playerId) ?? 0;
    return Math.max(0, this.perPlayerBytesPerSecond - used);
  }

  stats(): BandwidthBudgetStats {
    return {
      windowBytes: this.windowBytes,
      windowDroppedBytes: this.windowDroppedBytes,
      windowDroppedFrames: this.windowDroppedFrames,
      totalBytes: this.totalBytes,
      totalDroppedBytes: this.totalDroppedBytes,
      totalDroppedFrames: this.totalDroppedFrames,
      perPlayer: Object.fromEntries(this.perPlayer),
      perPlayerDropped: Object.fromEntries(this.perPlayerDropped),
    };
  }

  reset(now: number = this.now()): void {
    this.windowStart = now;
    this.windowBytes = 0;
    this.windowDroppedBytes = 0;
    this.windowDroppedFrames = 0;
    this.perPlayer.clear();
    this.perPlayerDropped.clear();
  }
}
