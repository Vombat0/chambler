/**
 * D1 — Kalıcı kullanıcı ayarları (localStorage, sürüm anahtarıyla).
 *
 * Depolama enjektördür: testler bellek-içi/bozuk bir storage verir.
 * Bozuk JSON, eksik alan veya yanlış tip asla fırlatmaz; alan alan
 *varsayılana döner (bireysel alan düzeyinde dayanıklılık).
 */

export const SETTINGS_STORAGE_KEY = 'chambler.settings.v1';

export type Language = 'tr' | 'en';
export type ShadowQuality = 'low' | 'medium' | 'high';

export interface Settings {
  /** Takma ad; home ekranına başlangıç değeri olarak döner. */
  readonly name: string;
  readonly language: Language;
  /** Kamera dönüş hassasiyeti (1 = varsayılan). */
  readonly cameraSensitivity: number;
  readonly shadowQuality: ShadowQuality;
  /** Ses henüz yok; ayar ileriye dönük kaydedilir. */
  readonly sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  language: 'tr',
  cameraSensitivity: 1,
  shadowQuality: 'high',
  sound: true,
};

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Geçerli dil mi? */
function asLanguage(value: unknown): Language | null {
  return value === 'tr' || value === 'en' ? value : null;
}

function asShadowQuality(value: unknown): ShadowQuality | null {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

function asName(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asSensitivity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(2, Math.max(0.2, value));
}

function asSound(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Depodan ayarları yükler. Anahtar yok, JSON bozuk veya alan geçersizse
 * o alanın (veya tümünün) varsayılanı kullanılır. Asla fırlatmaz.
 */
export function loadSettings(storage: SettingsStorage, key = SETTINGS_STORAGE_KEY): Settings {
  let parsed: Record<string, unknown> = {};
  try {
    const raw = storage.getItem(key);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    }
  } catch {
    // Bozuk veri: tümüyle varsayılana dön.
    return { ...DEFAULT_SETTINGS };
  }
  return {
    name: asName(parsed.name) ?? DEFAULT_SETTINGS.name,
    language: asLanguage(parsed.language) ?? DEFAULT_SETTINGS.language,
    cameraSensitivity: asSensitivity(parsed.cameraSensitivity) ?? DEFAULT_SETTINGS.cameraSensitivity,
    shadowQuality: asShadowQuality(parsed.shadowQuality) ?? DEFAULT_SETTINGS.shadowQuality,
    sound: asSound(parsed.sound) ?? DEFAULT_SETTINGS.sound,
  };
}

/** Ayarları sürüm anahtarı altında kaydeder. */
export function saveSettings(
  storage: SettingsStorage,
  settings: Settings,
  key = SETTINGS_STORAGE_KEY,
): void {
  storage.setItem(key, JSON.stringify(settings));
}

/** Tarayıcı storage'ı; test dışı kullanım. */
export const browserStorage: SettingsStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => {
    window.localStorage.setItem(key, value);
  },
};
