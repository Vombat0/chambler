/**
 * D2 — Optimistik spawn defteri (saf).
 *
 * Çevrimiçi modda paletten eklenen nesne, sunucu onayı gelene kadar
 * "beklemede" görünür. Onay = sunucunun aynı id ile `objectSpawn`
 * yayınına karşılaştırılır; ret = spawn'la ilgili `error` mesajı; hiçbir
 * ikisi gelmezse `timeoutMs` sonra zaman aşımı. Ret/zaman aşımı → nesne
 * yerel masadan kaldırılır (`pendingRollbacks`) + toast kodu döner.
 */

export type OptimisticStatus = 'pending' | 'confirmed' | 'rejected' | 'timedOut';

export interface OptimisticEntry {
  readonly id: string;
  /** Eklenen zaman (`now` enjeksiyonu ile test edilebilir). */
  readonly createdAt: number;
  status: OptimisticStatus;
}

/** Sunucu `error` kodları: bu kodlar spawn reddi sayılır. */
export const SPAWN_REJECT_CODES: readonly string[] = [
  'OBJECT_INVALID',
  'OBJECT_EXISTS',
  'OBJECT_META_TOO_LARGE',
];

export const DEFAULT_OPTIMISTIC_TIMEOUT_MS = 5000;

export interface RollbackNotice {
  readonly id: string;
  /** i18n kodu: `err.OBJECT_INVALID` / `err.OBJECT_SPAWN_TIMEOUT`. */
  readonly reasonKey: string;
}

export class OptimisticSpawns {
  private readonly entries = new Map<string, OptimisticEntry>();
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_OPTIMISTIC_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /** Yerel nesne kaydı (spawn yapıldığı an). */
  track(id: string, now: number): OptimisticEntry {
    const entry: OptimisticEntry = { id, createdAt: now, status: 'pending' };
    this.entries.set(id, entry);
    return entry;
  }

  get(id: string): OptimisticStatus | null {
    return this.entries.get(id)?.status ?? null;
  }

  /** Sunucu yayını geldi: aynı id bekleyen kayıt onaylanır. */
  confirm(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== 'pending') return false;
    entry.status = 'confirmed';
    this.entries.delete(id); // onaylandı: artık takip gerekmez
    return true;
  }

  /**
   * Spawn hatalı payload reddi: en eski bekleyen kaydın geri alınması.
   * Sunucunun `error` mesajı yalnızca kod döndürür (id taşımaz), bu
   * yüzden rampa sıradaki en eski bekleyen nesne kabul edilir.
   */
  rejectOldest(now: number): RollbackNotice | null {
    const pending = [...this.entries.values()]
      .filter((e) => e.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt);
    const oldest = pending[0];
    if (!oldest) return null;
    return this.reject(oldest.id, now);
  }

  /** Belirli nesnenin reddi (yerel revert testlerinde kullanılır). */
  reject(id: string, now: number): RollbackNotice | null {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== 'pending') return null;
    entry.status = 'rejected';
    this.entries.delete(id);
    void now;
    return { id, reasonKey: 'err.OBJECT_INVALID' };
  }

  /** Zaman aşımı süresi dolan bekleyenleri toplar. */
  sweepTimeout(now: number): RollbackNotice[] {
    const expired: RollbackNotice[] = [];
    for (const entry of [...this.entries.values()]) {
      if (entry.status !== 'pending') continue;
      if (now - entry.createdAt < this.timeoutMs) continue;
      entry.status = 'timedOut';
      this.entries.delete(entry.id);
      expired.push({ id: entry.id, reasonKey: 'err.OBJECT_SPAWN_TIMEOUT' });
    }
    return expired;
  }

  /** Hâlâ bekleyen liste: UI "beklemede" rozeti bunlardan beslenir. */
  pendingIds(): string[] {
    return [...this.entries.values()].filter((e) => e.status === 'pending').map((e) => e.id);
  }

  reset(): void {
    this.entries.clear();
  }
}
