import { describe, expect, it, vi } from 'vitest';
import { TokenStore } from './tokenStore.js';

describe('tokenStore — piyon durumu', () => {
  it('upsert oluşturur ve günceller; abone bildirimi sürüm artırır', () => {
    const store = new TokenStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.upsert('p1', { name: 'Ayşe', color: '#e63946', x: 10, y: 20, self: true });
    expect(store.get('p1')?.name).toBe('Ayşe');
    expect(store.getVersion()).toBe(1);
    store.upsert('p1', { x: 30 });
    expect(store.get('p1')).toMatchObject({ name: 'Ayşe', x: 30, y: 20 });
    expect(store.getVersion()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    store.upsert('p1', { x: 31 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('çoklu oyuncu piyonları listelenir; remove kaldırır', () => {
    const store = new TokenStore();
    store.upsert('a', { self: true });
    store.upsert('b', { self: false, color: '#2a9d8f' });
    expect(store.list().map((t) => t.playerId).sort()).toEqual(['a', 'b']);
    expect(store.remove('b')).toBe(true);
    expect(store.remove('b')).toBe(false);
    expect(store.list()).toHaveLength(1);
  });

  it('occupantsOfRect dikdörtgen içindekileri kararlı sırayla verir, kendini hariç tutar', () => {
    const store = new TokenStore();
    const rect = { x: 909, y: 909, w: 91, h: 91 }; // sağ-alt hücre
    store.upsert('zoe', { x: 950, y: 950 });
    store.upsert('amy', { x: 920, y: 915 });
    store.upsert('dış', { x: 10, y: 10 });
    store.upsert('me', { x: 955, y: 955 });
    const found = store.occupantsOfRect(rect, 'me');
    expect(found.map((t) => t.playerId)).toEqual(['amy', 'zoe']);
  });

  it('clear tüm piyonları siler ve bir bildirim yapar', () => {
    const store = new TokenStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.upsert('a', {});
    store.upsert('b', {});
    listener.mockClear();
    store.clear();
    expect(store.list()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(1);
    store.clear(); // boşken bildirim yok
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('getVersion primitif snapshot verir (useSyncExternalStore güvenli)', () => {
    const store = new TokenStore();
    const first = store.getVersion();
    store.upsert('a', {});
    expect(typeof first).toBe('number');
    expect(store.getVersion()).toBe(first + 1);
  });
});
