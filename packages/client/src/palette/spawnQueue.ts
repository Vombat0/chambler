/**
 * D2 — Kare bütçeli spawn kuyruğu (saf; sürücü enjekte edilir).
 *
 * Paletten çok sayıda nesne eklendiğinde UI donmasın: kare başına en fazla
 * `maxPerFrame` (varsayılan 10) spawn uygulanır; kalanlar sonraki karelere
 * yayılır. `run` gerçek uygulamayı yapar (ObjectManager.spawn gibi); bileşen
 * her animasyon karesinde `drainFrame()` çağırır.
 */

/** T: spawn iletilen nesne tipi (genelde `ObjectDef`). */
export interface SpawnQueue<T> {
  /** Kuyruğa nesne(ler) ekler (FIFO sıra korunur). */
  push(defs: readonly T[]): void;
  /** Kuyrukta bekleyen sayısı. */
  pending(): number;
  /** Bir kare turu; uygulanan sayıyı döndürür. */
  drainFrame(): number;
  /** Kuyruğu diğer karelere yaymadan bitirir (test/yardımcı); toplam uygulanan sayı. */
  drainAll(): number;
  /** Kuyruğu uygulanmadan temizler. */
  clear(): void;
}

/** Kare başına varsayılan spawn bütçesi. */
export const SPAWN_MAX_PER_FRAME = 10;

export function createSpawnQueue<T>(
  run: (def: T) => void,
  maxPerFrame: number = SPAWN_MAX_PER_FRAME,
): SpawnQueue<T> {
  const effective = Math.max(1, Math.floor(maxPerFrame));
  const queue: T[] = [];

  return {
    push(defs: readonly T[]) {
      for (const def of defs) queue.push(def);
    },
    pending() {
      return queue.length;
    },
    drainFrame() {
      let applied = 0;
      while (applied < effective && queue.length > 0) {
        run(queue.shift()!);
        applied++;
      }
      return applied;
    },
    drainAll() {
      let total = 0;
      while (queue.length > 0) {
        total += this.drainFrame();
      }
      return total;
    },
    clear() {
      queue.length = 0;
    },
  };
}
