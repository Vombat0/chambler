/**
 * 2D-1 — Pyon deposu (saf; React abonesi `useSyncExternalStore` ile okur).
 *
 * Konumlar tahta birimi cinsindendir (0..1000). Piyon ya sürükleniyordur
 * (serbest yüzme, `dragging: true`) ya da bir hücreye oturmuştur (snap'li).
 * Uzak oyuncu piyonları `TransformInterpolator` örnekleriyle buraya yazılır.
 */

export interface BoardToken {
  readonly playerId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  dragging: boolean;
  readonly self: boolean;
  /** Son snap'lenen hücrenin index'i (henüz snap yoksa null). */
  cellIndex: number | null;
  /** Son bilinen sürükleme hızı (tahta birimi/s) — ağ velocity alanı için. */
  vx: number;
  vy: number;
}

type Listener = () => void;

export class TokenStore {
  private readonly tokens = new Map<string, BoardToken>();
  private version = 0;
  private readonly listeners = new Set<Listener>();
  private snapshot: BoardToken[] = [];

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** useSyncExternalStore snapshot'ı: sürüm numarası (stabil primitif). */
  getVersion(): number {
    return this.version;
  }

  list(): readonly BoardToken[] {
    return this.snapshot;
  }

  get(playerId: string): BoardToken | undefined {
    return this.tokens.get(playerId);
  }

  private notify(): void {
    this.version += 1;
    this.snapshot = Array.from(this.tokens.values());
    for (const listener of this.listeners) listener();
  }

  /** Yoksa oluşturur; alanları birleştirir. Değişim yoksa bildirim yapmaz. */
  upsert(playerId: string, patch: Partial<Omit<BoardToken, 'playerId'>> & { self?: boolean }): BoardToken {
    const current = this.tokens.get(playerId);
    const next: BoardToken = current
      ? { ...current, ...patch, playerId }
      : {
          playerId,
          name: patch.name ?? playerId,
          color: patch.color ?? '#888888',
          x: patch.x ?? 0,
          y: patch.y ?? 0,
          dragging: patch.dragging ?? false,
          self: patch.self ?? false,
          cellIndex: patch.cellIndex ?? null,
          vx: patch.vx ?? 0,
          vy: patch.vy ?? 0,
        };
    this.tokens.set(playerId, next);
    this.notify();
    return next;
  }

  remove(playerId: string): boolean {
    const had = this.tokens.delete(playerId);
    if (had) this.notify();
    return had;
  }

  /** Piyonları temizler (oda değişimi / yeniden bağlanma). */
  clear(): void {
    if (this.tokens.size === 0) return;
    this.tokens.clear();
    this.notify();
  }

  /**
   * Verilen hücre dikdörtgeninin içindeki (merkezi kalan) piyonlar; id
   * sırasıyla kararlı. `excludePlayerId` genelde sürükleyen oyuncu.
   */
  occupantsOfRect(
    rect: { x: number; y: number; w: number; h: number },
    excludePlayerId?: string,
  ): BoardToken[] {
    const found: BoardToken[] = [];
    for (const token of this.tokens.values()) {
      if (token.playerId === excludePlayerId) continue;
      if (token.x >= rect.x && token.x <= rect.x + rect.w && token.y >= rect.y && token.y <= rect.y + rect.h) {
        found.push(token);
      }
    }
    return found.sort((a, b) => (a.playerId < b.playerId ? -1 : 1));
  }
}
