/**
 * Cell occupancy map (A5). Pure TS. Cell -> (layer -> objectId).
 * Layers allow tiles and tokens to share one cell (multiLayer=true); with
 * multiLayer=false any occupied layer blocks the cell.
 */

import { cellKey, type CellCoord } from './GridModel.js';
import type { PlaceRejection } from './TileEdges.js';

export const DEFAULT_LAYERS = ['tile', 'token'] as const;
export type GridLayer = string;

export interface OccupancyOptions {
  layers?: readonly GridLayer[];
  multiLayer?: boolean;
}

export interface OccupancyResult {
  ok: boolean;
  reason?: PlaceRejection;
}

export class OccupancyMap {
  readonly layers: readonly GridLayer[];
  readonly multiLayer: boolean;
  private readonly byCell = new Map<string, Map<GridLayer, string>>();
  private readonly byObject = new Map<string, CellCoord>();

  constructor(opts: OccupancyOptions = {}) {
    this.layers = opts.layers ?? DEFAULT_LAYERS;
    this.multiLayer = opts.multiLayer ?? true;
  }

  /** First object in the cell across all layers (tile layer wins). */
  occupant(cell: CellCoord): string | undefined {
    const layers = this.byCell.get(cellKey(cell));
    if (!layers) return undefined;
    for (const layer of this.layers) {
      const id = layers.get(layer);
      if (id !== undefined) return id;
    }
    return undefined;
  }

  layerAt(cell: CellCoord, layer: GridLayer): string | undefined {
    return this.byCell.get(cellKey(cell))?.get(layer);
  }

  cellOf(objectId: string): CellCoord | undefined {
    return this.byObject.get(objectId);
  }

  isOccupied(cell: CellCoord): boolean {
    return this.layerAt(cell, this.layers[0]!) !== undefined;
  }

  canPlace(cell: CellCoord, layer: GridLayer): OccupancyResult {
    if (!this.layers.includes(layer)) {
      return { ok: false, reason: 'LAYER_UNKNOWN' };
    }
    if (this.layerAt(cell, layer) !== undefined) {
      return { ok: false, reason: 'CELL_OCCUPIED' };
    }
    if (!this.multiLayer && this.occupant(cell) !== undefined) {
      return { ok: false, reason: 'CELL_OCCUPIED' };
    }
    return { ok: true };
  }

  /** Claims (cell, layer). Single occupant per object id: invalidates the previous cell. */
  place(cell: CellCoord, objectId: string, layer: GridLayer): OccupancyResult {
    this.remove(objectId);
    const key = cellKey(cell);
    let layers = this.byCell.get(key);
    if (!layers) {
      layers = new Map();
      this.byCell.set(key, layers);
    }
    layers.set(layer, objectId);
    this.byObject.set(objectId, { col: cell.col, row: cell.row });
    return { ok: true };
  }

  /** Removes the object wherever it is; returns its previous cell (or null). */
  remove(objectId: string): CellCoord | null {
    const cell = this.byObject.get(objectId);
    if (!cell) return null;
    const key = cellKey(cell);
    const layers = this.byCell.get(key);
    if (layers) {
      for (const layer of layers.keys()) {
        if (layers.get(layer) === objectId) layers.delete(layer);
      }
      if (layers.size === 0) this.byCell.delete(key);
    }
    this.byObject.delete(objectId);
    return cell;
  }

  entries(): IterableIterator<[CellCoord, Map<GridLayer, string>]> {
    const out = new Map<string, [CellCoord, Map<GridLayer, string>]>();
    for (const [key, layers] of this.byCell) {
      const [col, row] = key.split(',').map(Number);
      out.set(key, [{ col: col!, row: row! }, layers]);
    }
    return out.values();
  }
}
