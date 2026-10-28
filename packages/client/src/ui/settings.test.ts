import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type Settings,
  type SettingsStorage,
  loadSettings,
  saveSettings,
} from './settings.js';

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('settings persistence (D1)', () => {
  it(' round-trip: kaydet ve yükle', () => {
    const storage = memoryStorage();
    const settings: Settings = {
      name: 'Kaptan',
      language: 'en',
      cameraSensitivity: 1.4,
      shadowQuality: 'low',
      sound: false,
    };
    saveSettings(storage, settings);
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toContain('Kaptan');
    expect(loadSettings(storage)).toEqual(settings);
  });

  it(' depo boşsa varsayılanlar döner', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it(' bozuk JSON tümüyle varsayılana döner (fırlatmaz)', () => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: '{ not-json' });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it(' JSON düz dizi ise de varsayılanlara döner', () => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: '[1,2,3]' });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it(' geçersiz alan yerine varsayılan kullanılır; aralık dışı değer kırpılır', () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({
        name: 'Ay',
        language: 'xx',
        cameraSensitivity: 99,
        shadowQuality: 'ultra',
        sound: 'evet',
      }),
    });
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, name: 'Ay', cameraSensitivity: 2 });
  });

  it(' kısmen bozuk kayıtta iyi alanlar korunur', () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ name: 42, shadowQuality: 'medium' }),
    });
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_SETTINGS, shadowQuality: 'medium' });
  });

  it(' kamera hassasiyeti 0.2–2 aralığına kırpılır', () => {
    const low = memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ cameraSensitivity: 0.01 }) });
    const high = memoryStorage({ [SETTINGS_STORAGE_KEY]: JSON.stringify({ cameraSensitivity: 12 }) });
    expect(loadSettings(low).cameraSensitivity).toBe(0.2);
    expect(loadSettings(high).cameraSensitivity).toBe(2);
  });

  it(' NaN ve sonsuz duyarlılık yerine varsayılan gelir', () => {
    const storage = memoryStorage({
      [SETTINGS_STORAGE_KEY]: JSON.stringify({ cameraSensitivity: Number.NaN, name: 'Bo' }),
    });
    const settings = loadSettings(storage);
    expect(settings.cameraSensitivity).toBe(DEFAULT_SETTINGS.cameraSensitivity);
  });
});
