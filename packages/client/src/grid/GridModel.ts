/** Cell-based grid model (A5). Pure math — no WebGL, no runtime deps. */

export type GridShape = 'square' | 'hex';
export type HexOrientation = 'pointy' | 'flat';

/** Col/row pair. Square: col maps world X, row maps world Z. Hex: axial (col = q, row = r). */
export interface CellCoord {
  col: number;
  row: number;
}

export interface SquareBounds {
  cols: number;
  rows: number;
}

/** Hex bounds: cube distance max(|q|, |r|, |s|) <= radius. */
export interface HexBounds {
  radius: number;
}

export interface GridConfig {
  shape: GridShape;
  /** World position of cell (0,0)'s lower-left (square) / axial center (hex) corner origin. */
  originX: number;
  originZ: number;
  /**
   * cellSize in world units: square = cell edge length, hex = hex size
   * (circumradius, i.e. center to corner).
   */
  cellSize: number;
  hexOrientation?: HexOrientation;
  bounds?: SquareBounds | HexBounds;
}

export interface WorldPoint {
  x: number;
  z: number;
}

const SQRT3 = Math.sqrt(3);

/** Tiny epsilon so exact boundary values snap to a side deterministically. */
const EPS = 1e-9;

export function cellKey(cell: CellCoord): string {
  return `${cell.col},${cell.row}`;
}

export class GridModel {
  readonly shape: GridShape;
  readonly originX: number;
  readonly originZ: number;
  readonly cellSize: number;
  readonly hexOrientation: HexOrientation;
  private readonly bounds: SquareBounds | HexBounds | undefined;

  constructor(cfg: GridConfig) {
    if (!Number.isFinite(cfg.cellSize) || cfg.cellSize <= 0) {
      throw new Error('cellSize must be a positive finite number');
    }
    if (cfg.shape !== 'square' && cfg.shape !== 'hex') {
      throw new Error('shape must be "square" or "hex"');
    }
    this.shape = cfg.shape;
    this.originX = cfg.originX;
    this.originZ = cfg.originZ;
    this.cellSize = cfg.cellSize;
    this.hexOrientation = cfg.hexOrientation ?? 'pointy';
    this.bounds = cfg.bounds;
    this.validateBounds(this.bounds);
  }

  private validateBounds(b: SquareBounds | HexBounds | undefined): void {
    if (!b) return;
    if ('cols' in b && 'rows' in b) {
      if (!Number.isInteger(b.cols) || b.cols < 0 || !Number.isInteger(b.rows) || b.rows < 0) {
        throw new Error('square bounds cols/rows must be non-negative integers');
      }
    } else if ('radius' in b) {
      if (!Number.isInteger(b.radius) || b.radius < 0) {
        throw new Error('hex bounds radius must be a non-negative integer');
      }
    }
  }

  /** True when the cell exists inside the configured bounds (undefined bounds = unbounded). */
  inBounds(cell: CellCoord): boolean {
    const b = this.bounds;
    if (!b) return true;
    if (this.shape === 'square') {
      const sq = b as SquareBounds;
      return cell.col >= 0 && cell.row >= 0 && cell.col < sq.cols && cell.row < sq.rows;
    }
    const hex = b as HexBounds;
    const s = -cell.col - cell.row;
    const cube = Math.max(Math.abs(cell.col), Math.abs(cell.row), Math.abs(s));
    return cube <= hex.radius;
  }

  /** World-space center of a cell. Dual of `worldToCell` (roundtrip-safe within FP error). */
  cellToWorld(cell: CellCoord): WorldPoint {
    if (this.shape === 'square') {
      return {
        x: this.originX + (cell.col + 0.5) * this.cellSize,
        z: this.originZ + (cell.row + 0.5) * this.cellSize,
      };
    }
    if (this.hexOrientation === 'pointy') {
      return {
        x: this.originX + this.cellSize * SQRT3 * (cell.col + cell.row / 2),
        z: this.originZ + this.cellSize * 1.5 * cell.row,
      };
    }
    // flat-top
    return {
      x: this.originX + this.cellSize * 1.5 * cell.col,
      z: this.originZ + this.cellSize * SQRT3 * (cell.row + cell.col / 2),
    };
  }

  /** Nearest cell containing the world point, or null when outside bounds. */
  worldToCell(point: WorldPoint): CellCoord | null {
    const cell =
      this.shape === 'square' ? this.squareCell(point) : this.hexCell(point);
    if (!this.inBounds(cell)) return null;
    return cell;
  }

  /** Boundary convention: floor((p - origin)/size) -> the cell on the +axis side. */
  private squareCell(point: WorldPoint): CellCoord {
    return {
      col: Math.floor((point.x - this.originX) / this.cellSize + EPS),
      row: Math.floor((point.z - this.originZ) / this.cellSize + EPS),
    };
  }

  private hexCell(point: WorldPoint): CellCoord {
    const px = (point.x - this.originX) / this.cellSize;
    const pz = (point.z - this.originZ) / this.cellSize;
    let fq: number;
    let fr: number;
    if (this.hexOrientation === 'pointy') {
      fq = (SQRT3 / 3) * px - (1 / 3) * pz;
      fr = (2 / 3) * pz;
    } else {
      // flat-top inverse (Red Blob): q = 2/3 px, r = -1/3 px + sqrt(3)/3 pz
      fq = (2 / 3) * px;
      fr = -(1 / 3) * px + (SQRT3 / 3) * pz;
    }
    return cubeRound(fq, fr);
  }

  /** Iterates every in-bounds cell; unbounded grids iterate a bounded default window. */
  forEachCell(fn: (cell: CellCoord) => void): void {
    if (this.shape === 'square') {
      const b = (this.bounds ?? { cols: 64, rows: 64 }) as SquareBounds;
      for (let row = 0; row < b.rows; row++) {
        for (let col = 0; col < b.cols; col++) fn({ col, row });
      }
      return;
    }
    const radius = (this.bounds as HexBounds | undefined)?.radius ?? 8;
    for (let col = -radius; col <= radius; col++) {
      for (let row = Math.max(-radius, -col - radius); row <= Math.min(radius, -col + radius); row++) {
        fn({ col, row });
      }
    }
  }

  /** Number of in-bounds cells (0 when unbounded would be uncountable -> default window). */
  cellCount(): number {
    if (this.shape === 'square') {
      const b = (this.bounds ?? { cols: 64, rows: 64 }) as SquareBounds;
      return b.cols * b.rows;
    }
    let n = 0;
     
    this.forEachCell((_c) => {
      n += 1;
    });
    return n;
  }

  /**
   * In-bounds cells whose center lies within `radius` world units of `point`,
   * nearest first, capped at `maxCount` (A5 requirement: highlight up to 200).
   */
  cellsNear(point: WorldPoint, radius: number, maxCount: number): CellCoord[] {
    const out: Array<{ cell: CellCoord; d: number }> = [];
    this.forEachCell((cell) => {
      const c = this.cellToWorld(cell);
      const d = Math.hypot(point.x - c.x, point.z - c.z);
      if (d <= radius) out.push({ cell, d });
    });
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, maxCount).map((e) => e.cell);
  }
}

function cubeRound(fq: number, fr: number): CellCoord {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) {
    q = -r - s;
  } else if (dr > ds) {
    r = -q - s;
  }
  // normalize -0 -> 0 so deep-equality roundtrips hold
  return { col: q === 0 ? 0 : q, row: r === 0 ? 0 : r };
}
