/**
 * A6 — InspectCache: aynı nesne için tekrar açılışta dokuyu yeniden üretmeyen
 * küçük LRU cache (hedef: 8 kayıt). Saf TS.
 */
export class InspectCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly limit = 8) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    // LRU dokunuşu
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** get-ve-gerekirse-üre; factory yalnızca ilk kez çalışır. */
  obtain(key: string, factory: () => V): V {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = factory();
    this.set(key, value);
    return value;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
