import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DICTIONARIES,
  dictionaryKeysEqual,
  makeLookup,
} from './i18n.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('i18n (D1)', () => {
  it(' tr ve en sözlüklerinin anahtar kümeleri eşit', () => {
    expect(dictionaryKeysEqual()).toBe(true);
    expect(Object.keys(DICTIONARIES.tr).length).toBeGreaterThan(50);
  });

  it(' iki dil de aynı anahtarda farklı değer döndürür', () => {
    const tTr = makeLookup('tr');
    const tEn = makeLookup('en');
    expect(tTr('home.create')).toBe('Oda oluştur');
    expect(tEn('home.create')).toBe('Create room');
  });

  it(' eksik anahtar önce tr yedeğine düşmez — iki sözlükte de yoksa anahtarın kendisi gelir', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = makeLookup('en');
    expect(t('nope.not.there')).toBe('nope.not.there');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it(' eksik anahtar için uyarı yalnızca bir kez yazılır', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = makeLookup('tr');
    t('missing.repeated');
    t('missing.repeated');
    t('missing.repeated');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it(' bilinmeyen dil tr yedeğine düşer', () => {
    const t = makeLookup('fr' as never);
    expect(t('app.name')).toBe('Chambler');
  });

  it(' hata kodları her iki dilde çevrilidir', () => {
    for (const dict of [DICTIONARIES.tr, DICTIONARIES.en]) {
      for (const code of ['SEAT_TAKEN', 'COLOR_TAKEN', 'ROOM_FULL', 'OBJECT_CLAIMED']) {
        expect(dict[`err.${code}`]).toBeTruthy();
      }
    }
  });
});
