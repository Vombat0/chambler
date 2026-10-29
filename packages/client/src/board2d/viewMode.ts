/**
 * 2D-1 — Görünüm modu (2D Tahta / 3D Masa) tercih kalıcılığı.
 *
 * Kullanıcının stratejik kararı: varsayılan görünüm 2D Tahta'dır (Board Game
 * Arena tarzı). Tercih localStorage'da tutulur; bozuk değer 2D'ye düşer.
 */

export const VIEW_MODE_STORAGE_KEY = 'chambler.viewMode';
export type ViewMode = '2d' | '3d';

export function loadViewMode(storage: Pick<Storage, 'getItem'> | null): ViewMode {
  try {
    return storage?.getItem(VIEW_MODE_STORAGE_KEY) === '3d' ? '3d' : '2d';
  } catch {
    return '2d';
  }
}

export function saveViewMode(storage: Pick<Storage, 'setItem'> | null, mode: ViewMode): void {
  try {
    storage?.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    /* özel mod / kota: sessizce yoksay */
  }
}

/** localStorage sarmalayıcısı (SSR/test ortamda null güvenli). */
export function viewStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
}
