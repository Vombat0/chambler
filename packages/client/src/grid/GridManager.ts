/**
 * GridManager (A5): cell-based snapping facade.
 * Pure logic — WebGL-free; rendering is delegated through HighlightRendererLike.
 *
 * Backing model: square or hex GridModel + multi-layer OccupancyMap +
 * Carcassonne-style TileEdges + Monopoly-style BoardSlots.
 */

import {
  GridModel,
  cellKey,
  type CellCoord,
  type GridConfig,
  type WorldPoint,
} from './GridModel.js';
import {
  checkEdges,
  rotateTileEdges,
  type EdgeValue,
  type NeighborSource,
  type PlaceRejection,
  type RotationDeg,
  type TileEdges,
} from './TileEdges.js';
import { OccupancyMap } from './Occupancy.js';
import { BoardSlots, type SnapPointDef } from './BoardSlots.js';

export const SNAP_THRESHOLD_RATIO = 0.45;
export const MAX_HIGHLIGHT_CELLS = 200;
/** Highlight window: cells whose center is within this many cell sizes of the held object. */
export const HIGHLIGHT_RADIUS_CELLS = 3;

export interface SnapResult {
  ok: boolean;
  cell?: CellCoord;
  center?: WorldPoint;
  distance: number;
  reason?: PlaceRejection;
}

export interface PlaceOptions {
  objectId: string;
  /** Object kind; used to resolve the default layer (tile/card -> tile). */
  kind?: string;
  /** Explicit layer (wins over kind default). */
  layer?: string;
  /** Explicit cell (wins over point). */
  cell?: CellCoord | null;
  /** World position to resolve into a cell. */
  point?: WorldPoint;
  rotation?: RotationDeg;
  /** Carcassonne-style edge values; presence implies the `tile` layer. */
  edges?: TileEdges | null;
}

export interface PlaceResult {
  ok: boolean;
  cell?: CellCoord;
  center?: WorldPoint;
  reason?: PlaceRejection;
}

export interface HighlightCell {
  cell: CellCoord;
  center: WorldPoint;
  valid: boolean;
  /** Why the cell is invalid (oncesi doluluk/kenar/limit). */
  reason?: PlaceRejection;
}

export interface RemoveResult {
  cell: CellCoord | null
  slotId: string | null;
  layer?: string;
}

/** Minimal renderer hookup; the real implementation uses one InstancedMesh. */
export interface HighlightRendererLike {
  render(cells: HighlightCell[], cellSize: number): void;
  clear(): void;
}

/** A tile placed on the grid keeps its edges+rotation for neighbor checks. */
export interface PlacedTile {
  cell: CellCoord;
  edges: TileEdges;
  rotation: RotationDeg;
}

const DEFAULT_PLACE_LAYERS: Record<string, string> = { tile: 'tile', card: 'tile' };

/** Normalizes arbitrary meta data into TileEdges (undefined when malformed). */
export function parseTileEdges(meta: unknown): TileEdges | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined;
  const e = meta as { edges?: { north?: EdgeValue; east?: EdgeValue; south?: EdgeValue; west?: EdgeValue } };
  const edges = e.edges;
  if (typeof edges !== 'object' || edges === null) return undefined;
  if (
    edges.north === undefined ||
    edges.east === undefined ||
    edges.south === undefined ||
    edges.west === undefined
  ) {
    return undefined;
  }
  return { north: edges.north, east: edges.east, south: edges.south, west: edges.west };
}

export class GridManager {
  grid: GridModel;
  readonly occupancy: OccupancyMap;
  readonly slots: BoardSlots;
  private readonly placedTiles = new Map<string, PlacedTile>();
  private renderer: HighlightRendererLike | null = null;

  constructor(cfg: GridConfig, opts: { snapPoints?: readonly SnapPointDef[]; multiLayer?: boolean } = {}) {
    this.grid = new GridModel(cfg);
    this.occupancy = new OccupancyMap({ multiLayer: opts.multiLayer ?? true });
    this.slots = new BoardSlots(opts.snapPoints ?? []);
  }

  createGrid(cfg: GridConfig): this {
    // Fluent-style re-init used by tests/demos; renderer wiring is kept.
    this.grid = new GridModel(cfg);
    return this;
  }

  get snapThreshold(): number {
    return SNAP_THRESHOLD_RATIO * this.grid.cellSize;
  }

  attachHighlightRenderer(renderer: HighlightRendererLike): void {
    this.renderer = renderer;
  }

  worldToCell(point: WorldPoint): CellCoord | null {
    return this.grid.worldToCell(point);
  }

  cellToWorld(cell: CellCoord): WorldPoint {
    return this.grid.cellToWorld(cell);
  }

  cellKeyOf(cell: CellCoord): string {
    return cellKey(cell);
  }

  /** Distance-based snap decision at release time. */
  snapCheck(point: WorldPoint): SnapResult {
    const cell = this.grid.worldToCell(point);
    if (!cell) return { ok: false, distance: Infinity, reason: 'CELL_OUT_OF_BOUNDS' };
    const center = this.grid.cellToWorld(cell);
    const distance = Math.hypot(point.x - center.x, point.z - center.z);
    if (distance <= this.snapThreshold) {
      return { ok: true, cell, center, distance };
    }
    return { ok: false, distance, reason: 'SNAP_TOO_FAR' };
  }

  placedTileAt(cell: CellCoord): PlacedTile | undefined {
    const id = this.occupancy.layerAt(cell, 'tile');
    return id ? this.placedTiles.get(id) : undefined;
  }

  private tileNeighborSource: NeighborSource = {
    effectiveEdgesAt: (cell) => {
      const t = this.placedTileAt(cell);
      return t ? rotateTileEdges(t.edges, t.rotation) : undefined;
    },
  };

  /** Occupancy + (for tiles) neighbor edge check, without committing. */
  canPlace(
    cell: CellCoord,
    layer: string,
    edges?: TileEdges | null,
    rotation: RotationDeg = 0,
  ): { ok: boolean; reason?: PlaceRejection } {
    if (!this.grid.inBounds(cell)) return { ok: false, reason: 'CELL_OUT_OF_BOUNDS' };
    const occupancy = this.occupancy.canPlace(cell, layer);
    if (!occupancy.ok) return occupancy;
    if (edges && this.grid.shape === 'hex') {
      return { ok: false, reason: 'HEX_EDGES_UNSUPPORTED' };
    }
    if (edges) {
      const result = checkEdges(cell, rotateTileEdges(edges, rotation), this.tileNeighborSource);
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  /** Placement commit. Returns the cell center the object must sit on. */
  place(opts: PlaceOptions): PlaceResult {
    let cell: CellCoord | null = opts.cell ?? null;
    if (!cell && opts.point) cell = this.grid.worldToCell(opts.point);
    if (!cell) return { ok: false, reason: 'CELL_OUT_OF_BOUNDS' };
    const layer =
      opts.layer ??
      (opts.edges ? 'tile' : DEFAULT_PLACE_LAYERS[opts.kind ?? ''] ?? 'token');
    const rotation: RotationDeg = (opts.rotation ?? 0) as RotationDeg;
    const check = this.canPlace(cell, layer, opts.edges, rotation);
    if (!check.ok) return { ok: false, reason: check.reason };
    this.occupancy.place(cell, opts.objectId, layer);
    if (opts.edges) {
      this.placedTiles.set(opts.objectId, { cell: { ...cell }, edges: opts.edges, rotation });
    }
    return { ok: true, cell: { ...cell }, center: this.grid.cellToWorld(cell) };
  }

  remove(objectId: string): RemoveResult {
    const cell = this.occupancy.remove(objectId);
    const slotId = this.slots.release(objectId);
    this.placedTiles.delete(objectId);
    return { cell, slotId };
  }

  placedTileOf(objectId: string): PlacedTile | undefined {
    return this.placedTiles.get(objectId);
  }

  /** Places into a named board slot (Monopoly-style named points). */
  placeInSlot(slotId: string, objectId: string): { ok: boolean; center?: WorldPoint; reason?: PlaceRejection } {
    const result = this.slots.occupy(slotId, objectId);
    if (!result.ok) return result;
    return { ok: true, center: { x: result.slot.position[0]!, z: result.slot.position[2]! } };
  }

  /**
   * Drag-time preview: cells around `point` (window of HIGHLIGHT_RADIUS_CELLS,
   * capped at MAX_HIGHLIGHT_CELLS) labeled valid/invalid. Renders and returns them.
   */
  highlight(point: WorldPoint, layer = 'token', edges?: TileEdges): HighlightCell[] {
    const radius = HIGHLIGHT_RADIUS_CELLS * (this.grid.shape === 'hex' ? this.grid.cellSize * 1.75 : this.grid.cellSize);
    const cells = this.grid.cellsNear(point, radius, MAX_HIGHLIGHT_CELLS);
    if (cells.length === 0) {
      this.clearHighlight();
      return [];
    }
    const out: HighlightCell[] = cells.map((cell) => {
      const check = this.canPlace(cell, layer, edges ?? undefined);
      return {
        cell,
        center: this.grid.cellToWorld(cell),
        valid: check.ok,
        reason: check.reason,
      };
    });
    this.renderer?.render(out, this.grid.cellSize);
    return out;
  }

  clearHighlight(): void {
    this.renderer?.clear();
  }
}
