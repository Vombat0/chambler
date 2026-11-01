/**
 * R2 — Territory Wars: kanonik harita verisi ve prosedürel bölge poligonları.
 *
 * Tek doğruluk kaynağı: `packs/territory-wars/board/board.json` + `continents.json`.
 * JSON içerikleri `packSnapshot.ts` üzerinden gömülür ve `packSnapshot.test.ts`
 * kopyanın paketle birebir olduğunu diskten doğrular (Vite fs.allow sınırı nedeniyle
 * `?raw` yerine derleme zamanı anlık görüntüsü kullanılır).
 *
 * Bölge şekilleri: anchor noktalarına hafif tohumlu titreşim eklenip tam Voronoi
 * hücreleri yarı-düzlem kırpma (Sutherland–Hodgman) ile üretilir. Hücreler
 * merkezlerine doğru hafifçe büzüştürülüp aralarında "deniz boşluğu" bırakılır.
 * Tamamen deterministiktir (aynı tohum → aynı harita).
 */

import {
  BOARD_JSON,
  CONTINENTS_JSON,
  TERRITORY_JSON,
  TR_I18N_JSON,
} from './packSnapshot';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type ContinentId = 'drakemoor' | 'koros' | 'virelai' | 'sundar' | 'emberisle';

export interface RegionDef {
  readonly id: string;
  readonly continent: ContinentId;
  readonly name: string;
  readonly anchor: readonly [number, number];
  readonly neighbors: readonly string[];
  readonly fortress: boolean;
}

export interface ContinentDef {
  readonly id: ContinentId;
  readonly name: string;
  readonly color: string;
  readonly bonus: number;
  readonly members: readonly string[];
}

export interface CardDef {
  readonly id: string;
  readonly regionId: string | null;
  readonly kind: ContinentId;
  readonly wild: boolean;
}

export interface RegionShape {
  readonly id: string;
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly centroid: readonly [number, number];
  readonly label: readonly [number, number];
}

// ---------------------------------------------------------------------------
// Ham veri çözümleme
// ---------------------------------------------------------------------------

interface RawRegion {
  id: string;
  continent: ContinentId;
  nameKey: string;
  anchor: [number, number];
  neighbors: string[];
  fortress?: boolean;
}

interface RawBoard {
  canvas: { width: number; height: number };
  regions: RawRegion[];
}

interface RawContinent {
  id: ContinentId;
  nameKey: string;
  color: string;
  bonus: number;
  members: string[];
}

interface RawCard {
  id: string;
  regionId?: string;
  continentId?: ContinentId;
  wild?: boolean;
}

const boardJson = JSON.parse(BOARD_JSON) as RawBoard;
const continentsJson = JSON.parse(CONTINENTS_JSON) as { continents: RawContinent[] };
const cardsJson = JSON.parse(TERRITORY_JSON) as { cards: RawCard[] };
const trJson = JSON.parse(TR_I18N_JSON) as Record<string, string>;

export const CANVAS = { width: boardJson.canvas.width, height: boardJson.canvas.height };

export const TR_NAME = (key: string): string => trJson[key] ?? key;

export const REGIONS: readonly RegionDef[] = boardJson.regions.map((r) => ({
  id: r.id,
  continent: r.continent,
  name: TR_NAME(r.nameKey),
  anchor: r.anchor,
  neighbors: r.neighbors,
  fortress: r.fortress === true,
}));

export const REGION_IDS: readonly string[] = REGIONS.map((r) => r.id);
export const REGION_COUNT = REGIONS.length; // 28

const regionById = new Map(REGIONS.map((r) => [r.id, r]));

export function getRegion(id: string): RegionDef {
  const r = regionById.get(id);
  if (!r) throw new Error(`Bilinmeyen bölge: ${id}`);
  return r;
}

export const NEIGHBORS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  REGIONS.map((r) => [r.id, r.neighbors]),
);

export const CONTINENTS: readonly ContinentDef[] = continentsJson.continents.map((c) => ({
  id: c.id,
  name: TR_NAME(c.nameKey),
  color: c.color,
  bonus: c.bonus,
  members: c.members,
}));

export const CONTINENT_BY_ID: Readonly<Record<ContinentId, ContinentDef>> = Object.fromEntries(
  CONTINENTS.map((c) => [c.id, c]),
) as Record<ContinentId, ContinentDef>;

export const CONTINENT_OF: Readonly<Record<string, ContinentId>> = Object.fromEntries(
  REGIONS.map((r) => [r.id, r.continent]),
);

/** Bölge kartları (takas türü = kıta; joker her tür sayılır). */
export const CARD_DECK: readonly CardDef[] = cardsJson.cards.map((c) => {
  const wild = c.wild === true;
  const regionId = c.regionId ?? null;
  const kind: ContinentId =
    c.continentId ?? (regionId ? CONTINENT_OF[regionId]! : 'drakemoor');
  return { id: c.id, regionId, kind, wild };
});

// ---------------------------------------------------------------------------
// Deterministik RNG
// ---------------------------------------------------------------------------

/** Küçük, hızlı, tohumlu PRNG (mulberry32). Test edilebilirlik için dışa açık. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates; rng'yi tüketir, yeni dizi döner. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prosedürel harita geometrisi (Voronoi)
// ---------------------------------------------------------------------------

type Vec = [number, number];

/** Çokgeni `a` noktasına `b`den yakın kalan yarı-düzleme kırpar. */
function clipHalfPlane(poly: Vec[], a: Vec, b: Vec): Vec[] {
  const side = (p: Vec): number =>
    (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2 - ((p[0] - b[0]) ** 2 + (p[1] - b[1]) ** 2);

  const out: Vec[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const nxt = poly[(i + 1) % poly.length]!;
    const dc = side(cur);
    const dn = side(nxt);
    if (dc <= 0) out.push(cur);
    if ((dc < 0 && dn > 0) || (dc > 0 && dn < 0)) {
      const t = dc / (dc - dn);
      out.push([cur[0] + t * (nxt[0] - cur[0]), cur[1] + t * (nxt[1] - cur[1])]);
    }
  }
  return out;
}

function polygonCentroid(poly: Vec[]): Vec {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(area) < 1e-9) return poly[0] ?? [0, 0];
  return [cx / (3 * area), cy / (3 * area)];
}

/**
 * 28 bölgenin Voronoi şekillerini üretir.
 * @param seed   Anchor titreşimi tohumu (deterministik).
 * @param gapRatio Merkeze büzüşme oranı (1 = boşluksuz).
 */
export function buildShapes(seed = 20261101, gapRatio = 0.945): Record<string, RegionShape> {
  const rng = mulberry32(seed);
  const sites: Vec[] = REGIONS.map((r) => [
    r.anchor[0] + (rng() - 0.5) * 46,
    r.anchor[1] + (rng() - 0.5) * 46,
  ]);
  const m = 6;
  const bounds: Vec[] = [
    [m, m],
    [CANVAS.width - m, m],
    [CANVAS.width - m, CANVAS.height - m],
    [m, CANVAS.height - m],
  ];

  const shapes: Record<string, RegionShape> = {};
  for (let i = 0; i < REGIONS.length; i++) {
    let cell = bounds.map((p) => [...p] as Vec);
    for (let j = 0; j < REGIONS.length; j++) {
      if (i === j) continue;
      cell = clipHalfPlane(cell, sites[i]!, sites[j]!);
      if (cell.length < 3) break;
    }
    if (cell.length < 3) cell = bounds.map((p) => [...p] as Vec);
    const c = polygonCentroid(cell);
    const shrunk: Vec[] = cell.map(
      (p) => [c[0] + (p[0] - c[0]) * gapRatio, c[1] + (p[1] - c[1]) * gapRatio] as Vec,
    );
    const region = REGIONS[i]!;
    shapes[region.id] = {
      id: region.id,
      points: shrunk,
      centroid: c,
      label: [region.anchor[0], region.anchor[1]],
    };
  }
  return shapes;
}

/** "1,2 3,4 …" SVG points özelliği. */
export function toSvgPoints(points: ReadonlyArray<readonly [number, number]>): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}
