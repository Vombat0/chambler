/**
 * 2D-1 — Deste sırası (saf). Kartlar tıklandıkça üstten açılır; deste
 * bitince kendi içinde yeniden karılır. Deterministik test için rng enjekte
 * edilebilir.
 */

export class DeckOrder {
  private order: number[] = [];
  private cursor = 0;
  private readonly rng: () => number;

  constructor(readonly cardCount: number, rng: () => number = Math.random) {
    this.rng = rng;
    this.reshape();
  }

  /** Fisher–Yates ile baştan karıştırır. */
  reshape(): void {
    this.order = Array.from({ length: this.cardCount }, (_, i) => i);
    for (let i = this.order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng() * (i + 1));
      const head = this.order[i]!;
      this.order[i] = this.order[j]!;
      this.order[j] = head;
    }
    this.cursor = 0;
  }

  /** Sıradaki kartın index'i; deste bittiyse yeniden karır. */
  next(): number {
    if (this.cardCount === 0) return -1;
    if (this.cursor >= this.order.length) this.reshape();
    return this.order[this.cursor++] ?? 0;
  }

  get remaining(): number {
    return Math.max(0, this.order.length - this.cursor);
  }
}
