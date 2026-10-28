/**
 * D2 — Tarayıcı paket kaynağı.
 *
 * `packs/property-tycoon/manifest.json` Vite'ın `?raw` importuyla derleme
 * zamanında paketlenir (ağ isteği yok, çevrimdışı çalışır). Metin,
 * `validatePackManifest` ile zod şeması + mantıksal kontrollerden geçirilir;
 * hata varsa ayrıntılı mesajla fırlatılır.
 */

import manifestRaw from '../../../../packs/property-tycoon/manifest.json?raw';
import { validatePackManifest, type GamePackManifest } from './packValidation.js';

export const PROPERTY_TYCOON_MANIFEST_RAW: string = manifestRaw;

let cached: GamePackManifest | null = null;

export class PackLoadError extends Error {
  readonly details: readonly string[];

  constructor(message: string, details: readonly string[]) {
    super(message);
    this.name = 'PackLoadError';
    this.details = details;
  }
}

/** Manifesti doğrular ve döndürür (ilk çağrıda; sonra önbellek). */
export function propertyTycoonManifest(): GamePackManifest {
  if (cached) return cached;
  let data: unknown;
  try {
    data = JSON.parse(PROPERTY_TYCOON_MANIFEST_RAW);
  } catch (error) {
    throw new PackLoadError('Pack manifest is not valid JSON', [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  const result = validatePackManifest(data);
  if (!result.ok) {
    throw new PackLoadError(
      'Pack manifest failed validation',
      result.errors.map((error) => `${error.code}${error.field ? ` @${error.field}` : ''}: ${error.message}`),
    );
  }
  cached = result.manifest;
  return cached;
}

/** UI için async sarmalayıcı (yükleme durumu göstermek üzere). */
export async function fetchPropertyTycoonManifest(): Promise<GamePackManifest> {
  await Promise.resolve();
  return propertyTycoonManifest();
}
