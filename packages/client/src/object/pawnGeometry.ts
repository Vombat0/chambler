/**
 * V2 — Klasik masa oyunu piyonu geometrisi.
 *
 * Torna profili (`THREE.LatheGeometry`): geniş taban → boğumlu gövde →
 * yaka halkası → küre baş. Piyon fiziksel olarak küre gövdeyle temsil
 * edilir (`ObjectSpec.pawn`), görsel mesh ise bu profildir; taban
 * y = -h/2'de olacak şekilde ötelenir, böylece zeminle temas eder.
 */

import * as THREE from 'three';

/** [yarıçap, yükseklik] çiftleri (taban → baş). */
const PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.0, 0.0],
  [0.152, 0.0],
  [0.158, 0.012],
  [0.15, 0.03],
  [0.104, 0.062],
  [0.062, 0.1],
  [0.043, 0.16],
  [0.041, 0.215],
  [0.064, 0.248],
  [0.072, 0.272],
  [0.054, 0.3],
  [0.043, 0.355],
  [0.052, 0.398],
  [0.078, 0.432],
  [0.098, 0.468],
  [0.107, 0.51],
  [0.09, 0.558],
  [0.052, 0.591],
  [0.0, 0.6],
];

const geometryCache = new Map<string, THREE.LatheGeometry>();

/** Piyon profili yüksekliği (ObjectSpec.pawn.size.y ile aynı). */
export const PAWN_HEIGHT = 0.6;

/** Taban y = 0'da olacak şekilde profili üretir (mesh konumu taban). */
export function pawnProfilePoints(height = PAWN_HEIGHT): THREE.Vector2[] {
  const scale = height / PAWN_HEIGHT;
  return PROFILE.map(([x, y]) => new THREE.Vector2(x * scale, y * scale));
}

/**
 * Merkezi orijinde (y = ±h/2), 32 dilimli piyon geometrisi.
 * Aynı yükseklik için geometri paylaşılır.
 */
export function pawnGeometry(height = PAWN_HEIGHT): THREE.LatheGeometry {
  const key = `pawn-${height}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const geometry = new THREE.LatheGeometry(pawnProfilePoints(height), 32);
  geometry.translate(0, -height / 2, 0);
  geometry.computeVertexNormals();
  geometryCache.set(key, geometry);
  return geometry;
}
