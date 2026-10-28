import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIMISTIC_TIMEOUT_MS, OptimisticSpawns, SPAWN_REJECT_CODES } from './optimistic.js';

describe('optimistic spawn ledger (D2)', () => {
  it('takip edilen nesne pending olur', () => {
    const ledger = new OptimisticSpawns();
    ledger.track('a', 100);
    expect(ledger.get('a')).toBe('pending');
    expect(ledger.pendingIds()).toEqual(['a']);
  });

  it('sunucu onayı kaydı kapatır', () => {
    const ledger = new OptimisticSpawns();
    ledger.track('a', 100);
    expect(ledger.confirm('a')).toBe(true);
    expect(ledger.get('a')).toBeNull();
    expect(ledger.pendingIds()).toEqual([]);
  });

  it('bilinmeyen ya da onaylanmış id ikinci kez onaylanmaz', () => {
    const ledger = new OptimisticSpawns();
    expect(ledger.confirm('yok')).toBe(false);
    ledger.track('a', 1);
    ledger.confirm('a');
    expect(ledger.confirm('a')).toBe(false);
  });

  it('red işlemi geri alma bildirimi üretir ve kaydı siler', () => {
    const ledger = new OptimisticSpawns();
    ledger.track('a', 100);
    const notice = ledger.reject('a', 120);
    expect(notice).toEqual({ id: 'a', reasonKey: 'err.OBJECT_INVALID' });
    expect(ledger.get('a')).toBeNull();
  });

  it('rejectOldest en eski bekleyeni geri alır', () => {
    const ledger = new OptimisticSpawns();
    ledger.track('late', 200);
    ledger.track('early', 100);
    expect(ledger.rejectOldest(300)?.id).toBe('early');
    expect(ledger.pendingIds()).toEqual(['late']);
  });

  it('bekleyen yoksa rejectOldest null döner', () => {
    const ledger = new OptimisticSpawns(100);
    expect(ledger.rejectOldest(0)).toBeNull();
    ledger.track('a', 0);
    ledger.confirm('a');
    expect(ledger.rejectOldest(50)).toBeNull();
  });

  it('zaman aşımı yalnızca süresi dolanları toplar', () => {
    const ledger = new OptimisticSpawns(1000);
    ledger.track('old', 0);
    ledger.track('new', 900);
    const expired = ledger.sweepTimeout(1000);
    expect(expired.map((notice) => notice.id)).toEqual(['old']);
    expect(expired[0]?.reasonKey).toBe('err.OBJECT_SPAWN_TIMEOUT');
    expect(ledger.pendingIds()).toEqual(['new']);
  });

  it('zaman aşımı sınırında (eşit) dâhil eder', () => {
    const ledger = new OptimisticSpawns(500);
    ledger.track('a', 100);
    expect(ledger.sweepTimeout(600)).toHaveLength(1);
  });

  it('reset tüm kayıtları temizler', () => {
    const ledger = new OptimisticSpawns();
    ledger.track('a', 1);
    ledger.track('b', 2);
    ledger.reset();
    expect(ledger.pendingIds()).toEqual([]);
  });

  it('red kodu listesi sunucu sözleşmesiyle uyumludur', () => {
    expect(SPAWN_REJECT_CODES).toContain('OBJECT_INVALID');
    expect(SPAWN_REJECT_CODES).toContain('OBJECT_EXISTS');
    expect(SPAWN_REJECT_CODES).toContain('OBJECT_META_TOO_LARGE');
    expect(DEFAULT_OPTIMISTIC_TIMEOUT_MS).toBe(5000);
  });

  it('onaylanmış/bilinmeyen kaydı reddetmek null döner', () => {
    const ledger = new OptimisticSpawns();
    ledger.track('a', 0);
    ledger.confirm('a');
    expect(ledger.reject('a', 1)).toBeNull();
    expect(ledger.reject('nope', 1)).toBeNull();
  });
});
