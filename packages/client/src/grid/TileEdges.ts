/**
 * Tile edge model (A5, Carcassonne-style). Pure TS, no rendering.
 * A tile carries four edge values (N/E/S/W); two tiles may be adjacent when
 * the facing edges hold equal values. Rotations 0/90/180/270 rotate the edges.
 */

export type EdgeValue = string | number;
export type EdgeDirection = 'north' | 'east' | 'south' | 'west';

export interface TileEdges {
  north: EdgeValue;
  east: EdgeValue;
  south: EdgeValue;
  west: EdgeValue;
}

export type RotationDeg = 0 | 90 | 180 | 270;

export const EDGE_DIRECTIONS: readonly EdgeDirection[] = ['north', 'east', 'south', 'west'];

/** World-offset of each direction on a square grid (north = -Z, east = +X). */
export function edgeOffset(dir: EdgeDirection): { col: number; row: number } {
  switch (dir) {
    case 'north':
      return { col: 0, row: -1 };
    case 'east':
      return { col: 1, row: 0 };
    case 'south':
      return { col: 0, row: 1 };
    case 'west':
      return { col: -1, row: 0 };
  }
}

/** Opposite direction (the one a neighbor's facing edge must match). */
export function oppositeEdge(dir: EdgeDirection): EdgeDirection {
  switch (dir) {
    case 'north':
      return 'south';
    case 'east':
      return 'west';
    case 'south':
      return 'north';
    case 'west':
      return 'east';
  }
}

/**
 * Clockwise rotation of the tile as seen from above. After rotating 90° the
 * tile's north-facing edge is its original west edge, etc.
 */
export function rotateTileEdges(edges: TileEdges, rotation: RotationDeg): TileEdges {
  const seq: EdgeValue[] = [edges.north, edges.east, edges.south, edges.west];
  const shift = ((rotation / 90) % 4 + 4) % 4;
  const rotated = seq.map((_, i) => seq[(i - shift + 4) % 4]!);
  return { north: rotated[0]!, east: rotated[1]!, south: rotated[2]!, west: rotated[3]! };
}

export function tileEdge(edges: TileEdges, dir: EdgeDirection): EdgeValue {
  switch (dir) {
    case 'north':
      return edges.north;
    case 'east':
      return edges.east;
    case 'south':
      return edges.south;
    case 'west':
      return edges.west;
  }
}

export type PlaceRejection =
  | 'CELL_OUT_OF_BOUNDS'
  | 'CELL_OCCUPIED'
  | 'LAYER_UNKNOWN'
  | 'EDGE_MISMATCH'
  | 'HEX_EDGES_UNSUPPORTED'
  | 'SLOT_UNKNOWN'
  | 'SLOT_OCCUPIED'
  | 'SNAP_TOO_FAR';

export interface EdgeCheckResult {
  ok: boolean;
  reason?: PlaceRejection;
  /** Direction of the first mismatch, when reason is EDGE_MISMATCH. */
  direction?: EdgeDirection;
  expected?: EdgeValue;
  found?: EdgeValue;
}

export interface NeighborSource {
  /** Effective (already-rotated) N/E/S/W edges of the tile in that cell, if any. */
  effectiveEdgesAt(cell: { col: number; row: number }): TileEdges | undefined;
}

/**
 * Checks a tile placement against the four neighbors of a square cell.
 * Empty / out-of-bounds neighbors impose no constraint.
 */
export function checkEdges(
  cell: { col: number; row: number },
  effectiveEdges: TileEdges,
  neighbors: NeighborSource,
): EdgeCheckResult {
  for (const dir of EDGE_DIRECTIONS) {
    const off = edgeOffset(dir);
    const nCell = { col: cell.col + off.col, row: cell.row + off.row };
    const neighborEdges = neighbors.effectiveEdgesAt(nCell);
    if (!neighborEdges) continue;
    const mine = tileEdge(effectiveEdges, dir);
    const theirs = tileEdge(neighborEdges, oppositeEdge(dir));
    if (mine !== theirs) {
      return { ok: false, reason: 'EDGE_MISMATCH', direction: dir, expected: theirs, found: mine };
    }
  }
  return { ok: true };
}
