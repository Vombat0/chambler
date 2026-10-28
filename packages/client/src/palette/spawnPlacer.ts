/**
 * D2 — Spawn yerleştirici (saf).
 *
 * Paletten eklenen her nesne, masada mevcut nesnelerle çakışmayan bir noktaya
 * konur: merkezden başlayıp halka halka (spiral) aday noktalar denenir; AABB
 * çakışma kontrolü ayak izleriyle yapılır; masa sınırına sığmayan adaylar
 * reddedilir. Boş yer kalmadıysa `null` döner.
 */

/** Dünya uzayında kutu ayak izi: `x` genişlik, `z` derinlik, `y` yükseklik. */
export interface Footprint {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

export interface PlacerBounds {
  /** Masa yarı genişliği / yarı derinliği. */
  readonly halfX: number;
  readonly halfZ: number;
  /** Kenar payı (metre). */
  margin?: number;
}

/** Mevcut nesne: zemin merkezi + ayak izi. */
export interface Occupied {
  readonly x: number;
  readonly z: number;
  readonly foot: Footprint;
}

export interface PlaceOptions {
  /** Izgara adımı (metre); küçük nesneler en az kendi boyu kadar atlanır. */
  readonly step?: number;
  /** Denenecek halka sayısı üst sınırı. */
  readonly maxRings?: number;
}

/**
 * Halkalar arası adım (metre). Sabit tutulur: aday nokta aralığı da bu
 * değerdir, böylece geniş bir nesnenin (deste) halkası tahtanın yanındaki
 * dar şeride denk gelebilir. Nesne boyuna bağlanınca dar şerit atlanıyordu.
 */
export const DEFAULT_PLACER_STEP = 0.5;
export const DEFAULT_MAX_RINGS = 24;
/** Nesneler arası minimum boşluk (metre). */
const OVERLAP_GAP = 0.06;

/** AABB çakışma testi: merkez + yarım genişlik, XZ düzleminde. */
export function boxOverlap(a: { x: number; z: number; foot: Footprint }, b: Occupied): boolean {
  const aHalfX = a.foot.x / 2 + OVERLAP_GAP;
  const aHalfZ = a.foot.z / 2 + OVERLAP_GAP;
  const bHalfX = b.foot.x / 2 + OVERLAP_GAP;
  const bHalfZ = b.foot.z / 2 + OVERLAP_GAP;
  return (
    a.x - aHalfX < b.x + bHalfX && a.x + aHalfX > b.x - bHalfX &&
    a.z - aHalfZ < b.z + bHalfZ && a.z + aHalfZ > b.z - bHalfZ
  );
}

/** Aday nokta masanın içinde kalıyor mu? */
export function fitsBounds(p: { x: number; z: number; foot: Footprint }, bounds: PlacerBounds): boolean {
  const margin = bounds.margin ?? 0.35;
  return (
    p.x - p.foot.x / 2 >= -bounds.halfX + margin &&
    p.x + p.foot.x / 2 <= bounds.halfX - margin &&
    p.z - p.foot.z / 2 >= -bounds.halfZ + margin &&
    p.z + p.foot.z / 2 <= bounds.halfZ - margin
  );
}

export interface Placement {
  readonly x: number;
  readonly z: number;
  /** Kabul öncesi denenen aday sayısı (teşhis için). */
  readonly attempts: number;
}

/**
 * Boş nokta bulur: merkez (0,0)'dan spiral halkalarla dener.
 * Ring 0 merkez tek nokta; ring r üzerinde dört kenar boyunca `r * 8` aday
 * adımda (izgara adımı genişliğinde) denenir.
 */
export function findFreeSpot(
  instance: Footprint,
  existing: readonly Occupied[],
  bounds: PlacerBounds,
  options: PlaceOptions = {},
): Placement | null {
  // Ring yarıçapı ve aday aralığı aynı `step`tir; nesne boyu yalnızca
  // çakışma testine girer (bkz. DEFAULT_PLACER_STEP notu).
  const step = options.step ?? DEFAULT_PLACER_STEP;
  const maxRings = options.maxRings ?? DEFAULT_MAX_RINGS;
  let attempts = 0;

  for (let ring = 0; ring <= maxRings; ring++) {
    const ringPoints = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < ringPoints; i++) {
      const candidate = ring === 0 ? { x: 0, z: 0 } : ringPoint(ring, i, ringPoints, step);
      attempts++;
      const point = { x: candidate.x, z: candidate.z, foot: instance };
      if (!fitsBounds(point, bounds)) continue;
      let clear = true;
      for (const occupied of existing) {
        if (boxOverlap(point, occupied)) {
          clear = false;
          break;
        }
      }
      if (clear) return { x: point.x, z: point.z, attempts };
    }
  }
  return null;
}

/** Bir halkadaki nokta: 2r uzunluklu dört kenar, perSide segment. */
function ringPoint(ring: number, i: number, count: number, step: number): { x: number; z: number } {
  const r = ring * step;
  const perSide = count / 4;
  const side = Math.floor(i / perSide);
  const t = (i % perSide) / perSide;
  switch (side) {
    case 0: return { x: -r + 2 * r * t, z: -r };   // üst kenar
    case 1: return { x: r, z: -r + 2 * r * t };    // sağ kenar
    case 2: return { x: r - 2 * r * t, z: r };     // alt kenar
    default: return { x: -r, z: r - 2 * r * t };   // sol kenar
  }
}
