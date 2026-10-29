/**
 * 2D-1 — Saf tahta geometrisi (Board2DView).
 *
 * Mülk Tycoon'un 40 hücresi 11×11'lik bir ızgarada çevre boyunca dizilir.
 * Hücre dikdörtgenleri paketin `board/board.json` verisindeki `side`/`slot`
 * alanlarından, sanat üretim betiğiyle (`scripts/generate-art.ts` →
 * `cellRect`) BİREBİR aynı formülle hesaplanır; böylece SVG üstündeki
 * yuvalar görselle hiç kaymaz.
 *
 * Tüm koordinatlar "tahta birimi"dır: 0..1000, sol üst orijinli, y aşağı.
 * Ağ tarafında dünya koordinatına `boardToWorld` ile çevrilir (÷100).
 */

export const BOARD_UNITS = 1000;
export const GRID_COLS = 11;
export const GRID_ROWS = 11;
export const CELL_UNITS = BOARD_UNITS / GRID_COLS;

export type BoardSide = 'bottom' | 'left' | 'top' | 'right';

export interface CellInput {
  readonly index: number;
  readonly id?: string;
  readonly slug?: string;
  readonly type: string;
  readonly side: BoardSide;
  readonly slot: number;
  readonly groupId?: string;
  readonly price?: number;
}

export interface CellGeom extends CellInput {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cx: number;
  readonly cy: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/** `generate-art.ts::cellRect` ile birebir eşleşen hücre dikdörtgeni. */
export function cellRect(side: BoardSide, slot: number): { x: number; y: number } {
  switch (side) {
    case 'bottom':
      return { x: (GRID_COLS - slot - 1) * CELL_UNITS, y: (GRID_ROWS - 1) * CELL_UNITS };
    case 'left':
      return { x: 0, y: (GRID_ROWS - slot - 1) * CELL_UNITS };
    case 'top':
      return { x: slot * CELL_UNITS, y: 0 };
    case 'right':
      return { x: (GRID_COLS - 1) * CELL_UNITS, y: slot * CELL_UNITS };
  }
}

/** Ham hücre listesini merkezi/dikdörtgeni hazır geometriye çevirir. */
export function buildCellGeometry(cells: readonly CellInput[]): CellGeom[] {
  return [...cells]
    .sort((a, b) => a.index - b.index)
    .map((cell) => {
      const { x, y } = cellRect(cell.side, cell.slot);
      return { ...cell, x, y, w: CELL_UNITS, h: CELL_UNITS, cx: x + CELL_UNITS / 2, cy: y + CELL_UNITS / 2 };
    });
}

export function cellAt(geoms: readonly CellGeom[], index: number): CellGeom | null {
  return geoms.find((geom) => geom.index === index) ?? null;
}

/** Nokta hangi hücrenin dikdörtgeninin içinde? (yoksa null) */
export function cellContaining(geoms: readonly CellGeom[], p: Point2D): CellGeom | null {
  for (const geom of geoms) {
    if (p.x >= geom.x && p.x <= geom.x + geom.w && p.y >= geom.y && p.y <= geom.y + geom.h) return geom;
  }
  return null;
}

/**
 * Snap hedefi: noktanın içine düştüğü hücre önceliklidir; değilse merkezi
 * en yakın hücre seçilir (çevre dışına, yani orta alana bırakılırsa en yakın
 * çevre hücresine "tık" diye oturur). Hücre yoksa null.
 */
export function nearestCell(geoms: readonly CellGeom[], p: Point2D): CellGeom | null {
  const inside = cellContaining(geoms, p);
  if (inside) return inside;
  let best: CellGeom | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const geom of geoms) {
    const d = Math.hypot(p.x - geom.cx, p.y - geom.cy);
    if (d < bestDist) {
      bestDist = d;
      best = geom;
    }
  }
  return best;
}

/**
 * Aynı hücredeki çoklu piyonlar için yelpaze ofsetleri (tahta birimi).
 * İlk piyon merkeze oturur; sonrakiler yarıçapı hücrenin ~%34'ü olan bir
 * çemberde eşit aralıklı dizilir, böylece hepsi görünür kalır.
 */
export function stackOffset(occupantCount: number, slotIndex: number): Point2D {
  if (occupantCount <= 1) return { x: 0, y: 0 };
  const radius = CELL_UNITS * 0.34;
  const angle = -Math.PI / 2 + (slotIndex * 2 * Math.PI) / occupantCount;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * Bırakma anı snap'i: hücre merkezi + o hücredeki mevcut piyon sayısına göre
 * yelpaze ofseti. `existingOccupants` bu piyon HARİÇ hücredeki diğerleri.
 */
export function snapToCell(
  geoms: readonly CellGeom[],
  p: Point2D,
  existingOccupants: number,
): { cell: CellGeom; x: number; y: number } | null {
  const cell = nearestCell(geoms, p);
  if (!cell) return null;
  const offset = stackOffset(existingOccupants + 1, existingOccupants);
  return { cell, x: cell.cx + offset.x, y: cell.cy + offset.y };
}

/** Tahta birimi → dünya (ağ) koordinatı: 1000 birim = 10 m. */
export function boardToWorld(x: number, y: number): { x: number; y: number; z: number } {
  return { x: x / 100, y: 0, z: y / 100 };
}

/** Dünya (ağ) koordinatı → tahta birimi. */
export function worldToBoard(world: { x: number; z: number }): Point2D {
  return { x: world.x * 100, y: world.z * 100 };
}

/** Nokta tahta sınırları içinde mi? (0..1000, taşmalar kırpılır) */
export function clampToBoard(p: Point2D): Point2D {
  return {
    x: Math.min(BOARD_UNITS, Math.max(0, p.x)),
    y: Math.min(BOARD_UNITS, Math.max(0, p.y)),
  };
}
