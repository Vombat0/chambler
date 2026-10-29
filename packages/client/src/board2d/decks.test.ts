import { describe, expect, it } from 'vitest';
import { DeckOrder } from './decks.js';
import { loadViewMode, saveViewMode, VIEW_MODE_STORAGE_KEY } from './viewMode.js';

describe('decks — deste sırası', () => {
  it('kartları karıştırılmış ama tekilleştirilmiş sırayla verir', () => {
    let seed = 0.42;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const deck = new DeckOrder(16, rng);
    const drawn = Array.from({ length: 16 }, () => deck.next());
    expect(new Set(drawn).size).toBe(16);
    expect(Math.min(...drawn)).toBe(0);
    expect(Math.max(...drawn)).toBe(15);
  });

  it('deste bitince otomatik yeniden karılır ve sayı düşer', () => {
    const deck = new DeckOrder(3, () => 0.5);
    expect(deck.remaining).toBe(3);
    deck.next();
    deck.next();
    expect(deck.remaining).toBe(1);
    deck.next();
    expect(deck.remaining).toBeLessThanOrEqual(3);
    expect(deck.next()).toBeGreaterThanOrEqual(0);
  });
});

describe('viewMode — 2D/3D tercih kalıcılığı', () => {
  const fakeStorage = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    };
  };

  it('kayıt yoksa varsayılan 2D tahtadır', () => {
    expect(loadViewMode(fakeStorage())).toBe('2d');
    expect(loadViewMode(null)).toBe('2d');
  });

  it('kayıtlı tercih okunur ve bozuk değer 2Dye düşer', () => {
    expect(loadViewMode(fakeStorage({ [VIEW_MODE_STORAGE_KEY]: '3d' }))).toBe('3d');
    expect(loadViewMode(fakeStorage({ [VIEW_MODE_STORAGE_KEY]: 'vr' }))).toBe('2d');
  });

  it('saveViewMode yazar, sonra okunur', () => {
    const storage = fakeStorage();
    saveViewMode(storage, '3d');
    expect(loadViewMode(storage)).toBe('3d');
    saveViewMode(storage, '2d');
    expect(loadViewMode(storage)).toBe('2d');
  });

  it('storage hatası fırlatmaz', () => {
    expect(() =>
      saveViewMode(
        {
          setItem: () => {
            throw new Error('quota');
          },
        },
        '2d',
      ),
    ).not.toThrow();
  });
});
