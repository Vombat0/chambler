/**
 * 2D-1 — Zar durumu (saf durum makinesi, DOM yok).
 *
 * `idle → rolling → settled`. Rolling sırasında `facesAt(now)` animasyon için
 * dönen yüzleri üretir; süre dolunca gerçek sonuç (`rollPair`) kilitlenir ve
 * ağa gönderilmek üzere `value = a + b` hazır olur (çift zar → 2..12).
 *
 * Sunucu tarafı doğrulama `dieResult.ts` içinde yapılır: rapor eden oyuncu
 * zarin sahibi olmalı ve değer `1..faces` aralığında tam sayı olmalı. 2D
 * görünümde tek bir "zar nesnesi" `faces: 12` meta'sı ile spawn edilir.
 */

export type DicePhase = 'idle' | 'rolling' | 'settled';

export interface DiceFaces {
  a: number;
  b: number;
}

export interface DiceSnapshot extends DiceFaces {
  phase: DicePhase;
  startedAt: number;
  durationMs: number;
  rollId: number;
  /** Son settled sonucunun özeti (banner için). */
  lastSum: number | null;
  lastPlayerId: string | null;
}

const D6 = [1, 2, 3, 4, 5, 6] as const;

/** d6 yüzü döndürür; `rng` test için enjekte edilebilir (0..1). */
export function rollDie(rng: () => number = Math.random): number {
  const value = 1 + Math.floor(rng() * 6);
  return Math.min(6, Math.max(1, value));
}

/** İki zar; geçerli bir toplam döndürür (2..12). */
export function rollPair(rng: () => number = Math.random): DiceFaces {
  return { a: rollDie(rng), b: rollDie(rng) };
}

/**
 * Toplaman geçerli iki d6 yüzüne olası bir ayrımı (uzak sonuçları animasyon
 * için gösterirken kullanılır). Geçersizse null.
 */
export function splitSum(sum: number): DiceFaces | null {
  if (!Number.isInteger(sum) || sum < 2 || sum > 12) return null;
  const a = Math.max(1, Math.min(6, sum - 1));
  const b = sum - a;
  if (b < 1 || b > 6) return null;
  return { a, b };
}

/**
 * Ağanın `dieResult` mesajını doğrular: {objectId, value, faces}.
 * Değer 1..faces tam sayı olmalı; değilse null.
 */
export function parseDieResult(raw: unknown): { objectId: string; value: number; faces: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const message = raw as { objectId?: unknown; id?: unknown; value?: unknown; faces?: unknown };
  const objectId = typeof message.objectId === 'string' ? message.objectId : typeof message.id === 'string' ? message.id : '';
  const value = message.value;
  if (!objectId || typeof value !== 'number' || !Number.isInteger(value)) return null;
  const faces = typeof message.faces === 'number' && Number.isInteger(message.faces) && message.faces >= 2 ? message.faces : 6;
  if (value < 1 || value > faces) return null;
  return { objectId, value, faces };
}

export interface DiceModelOptions {
  readonly durationMs?: number;
  readonly rng?: () => number;
  /** Yüz değişimi animasyonu saati (varsayılan 90 ms). */
  readonly tickMs?: number;
}

export class DiceModel {
  readonly durationMs: number;
  private readonly rng: () => number;
  readonly tickMs: number;

  private phase: DicePhase = 'idle';
  private result: DiceFaces = { a: 1, b: 1 };
  private pending: DiceFaces = { a: 1, b: 1 };
  private startedAt = 0;
  private rollId = 0;
  private lastSum: number | null = null;
  private lastPlayerId: string | null = null;

  constructor(options: DiceModelOptions = {}) {
    this.durationMs = options.durationMs ?? 900;
    this.rng = options.rng ?? Math.random;
    this.tickMs = options.tickMs ?? 90;
  }

  get state(): DiceSnapshot {
    return {
      phase: this.phase,
      a: this.result.a,
      b: this.result.b,
      startedAt: this.startedAt,
      durationMs: this.durationMs,
      rollId: this.rollId,
      lastSum: this.lastSum,
      lastPlayerId: this.lastPlayerId,
    };
  }

  /** Yeni atış başlatır; zaten dönüyorsa false. */
  roll(now: number, playerId: string | null = null): boolean {
    if (this.phase === 'rolling') return false;
    this.pending = rollPair(this.rng);
    this.result = this.pending;
    this.phase = 'rolling';
    this.startedAt = now;
    this.rollId += 1;
    this.lastPlayerId = playerId;
    return true;
  }

  /**
   * Uzak oyuncunun kesin sonucu için: kısa bir animasyon sonra aynı değerde
   * durur (toplam sabittir; yüzler animasyonda değişebilir).
   */
  rollFixed(now: number, sum: number, playerId: string | null): boolean {
    const split = splitSum(sum);
    if (!split || this.phase === 'rolling') return false;
    this.pending = split;
    this.result = split;
    this.phase = 'rolling';
    this.startedAt = now;
    this.rollId += 1;
    this.lastPlayerId = playerId;
    return true;
  }

  /**
   * Zamanı ilerletir; rolling→settled geçişinde true döner (tek seferlik —
   * çağıran ağ mesajını burada gönderir).
   */
  tick(now: number): boolean {
    if (this.phase !== 'rolling') return false;
    if (now - this.startedAt < this.durationMs) return false;
    this.result = { ...this.pending };
    this.phase = 'settled';
    this.lastSum = this.result.a + this.result.b;
    return true;
  }

  /** Animasyon sırası: dönüyken dönen yüzler, değilse gerçek yüzler. */
  facesAt(now: number): DiceFaces {
    if (this.phase !== 'rolling') return { ...this.result };
    const step = Math.floor((now - this.startedAt) / this.tickMs);
    const spinA = D6[(step * 2 + this.result.a) % 6] ?? 1;
    const spinB = D6[(step * 3 + this.result.b) % 6] ?? 2;
    return { a: spinA, b: spinB };
  }

  get rolling(): boolean {
    return this.phase === 'rolling';
  }

  get currentSum(): number {
    return this.result.a + this.result.b;
  }
}
