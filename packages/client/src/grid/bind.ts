/**
 * A5 binding: bridges GridManager onto the interaction loop.
 * - claim (pickup): clears stale highlights.
 * - transformUpdate while held: highlights nearby cells (green valid / red occupied-invalid).
 * - release: snaps into the nearest valid cell when within threshold (45% of
 *   cellSize, free drop otherwise), tile edges honored via `def.meta.edges`,
 *   optionally named board slots first.
 * Structural typing keeps grid/ WebGL-free and unit-testable without a scene.
 */

import { parseTileEdges, type GridManager } from './GridManager.js';

/** Subset of ManagedObject the binding needs. */
export interface SnapTargetObject {
  def: { id: string; kind: string; meta: Record<string, unknown> };
  mesh: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number }; scale: { x: number; y: number; z: number } };
  body: {
    rigidBody: {
      setTranslation(v: { x: number; y: number; z: number }, wake?: boolean): unknown;
      setLinvel(v: { x: number; y: number; z: number }, wake?: boolean): unknown;
    };
  };
  held: boolean;
}

export interface GridSnapTarget {
  emitter: {
    on(event: string, handler: (payload: unknown) => void): () => void;
    emit(event: string, payload: unknown): void;
  };
  objects: { get(id: string): SnapTargetObject | undefined };
}

export interface GridBindingOptions {
  /** Try named board slots before cell snapping. */
  useSlots?: boolean;
}

export interface GridBindingStats {
  snapped: number;
  slotPlaced: number;
  freed: number;
  rejected: number;
  lastRejection?: string;
}

export interface GridBinding {
  detach(): void;
  readonly stats: GridBindingStats;
}

const ZERO_VEL = { x: 0, y: 0, z: 0 };

export function bindGridToInteraction(
  grid: GridManager,
  target: GridSnapTarget,
  opts: GridBindingOptions = {},
): GridBinding {
  const stats: GridBindingStats = { snapped: 0, slotPlaced: 0, freed: 0, rejected: 0 };
  const offs: Array<() => void> = [];

  /** Move mesh + physics body to a world XZ target (keep current Y). */
  function teleport(id: string, mo: SnapTargetObject, x: number, z: number): void {
    mo.mesh.position.x = x;
    mo.mesh.position.z = z;
    mo.body.rigidBody.setTranslation({ x, y: mo.mesh.position.y, z }, true);
    mo.body.rigidBody.setLinvel(ZERO_VEL, true);
    const qu = mo.mesh.quaternion;
    const sc = mo.mesh.scale;
    target.emitter.emit('transformUpdate', {
      type: 'transformUpdate',
      id,
      transform: {
        position: { x, y: mo.mesh.position.y, z },
        rotation: { x: qu.x, y: qu.y, z: qu.z, w: qu.w },
        scale: { x: sc.x, y: sc.y, z: sc.z },
      },
      velocity: ZERO_VEL,
    });
  }

  function layerOf(kind: string): string {
    return kind === 'tile' || kind === 'card' ? 'tile' : 'token';
  }

  offs.push(
    target.emitter.on('objectRelease', (payload) => {
      const { objectId } = payload as { objectId?: string };
      grid.clearHighlight();
      const mo = objectId ? target.objects.get(objectId) : undefined;
      if (!mo) return;
      const pos = { x: mo.mesh.position.x, z: mo.mesh.position.z };
      const threshold = grid.snapThreshold;

      if (opts.useSlots && grid.slots.all().length > 0) {
        const slotHit = grid.slots.nearestFree(pos, threshold * 1.25);
        if (slotHit) {
          const placed = grid.placeInSlot(slotHit.slot.id, objectId!);
          if (placed.ok && placed.center) {
            // cleanup cell occupancy; do NOT release the slot we just occupied
            grid.occupancy.remove(objectId!);
            teleport(objectId!, mo, placed.center.x, placed.center.z);
            stats.slotPlaced += 1;
          }
          return;
        }
      }

      const snap = grid.snapCheck(pos);
      if (!snap.ok) {
        stats.freed += 1;
        return; // threshold exceeded -> free drop
      }
      const edges = mo.def.kind === 'tile' ? parseTileEdges(mo.def.meta) : undefined;
      const check = grid.canPlace(snap.cell!, layerOf(mo.def.kind), edges ?? undefined);
      if (!check.ok) {
        stats.rejected += 1;
        stats.lastRejection = check.reason;
        return; // occupied / edge mismatch -> leave free where dropped
      }
      const place = grid.place({
        objectId: objectId!,
        layer: layerOf(mo.def.kind),
        cell: snap.cell,
        edges: edges ?? null,
      });
      if (place.ok && place.center) {
        teleport(objectId!, mo, place.center.x, place.center.z);
        stats.snapped += 1;
      }
    }),
  );

  offs.push(
    target.emitter.on('objectClaim', () => {
      grid.clearHighlight();
    }),
  );

  offs.push(
    target.emitter.on('transformUpdate', (payload) => {
      const { id } = payload as { id?: string };
      const mo = id ? target.objects.get(id) : undefined;
      if (!mo || !mo.held) return;
      const pos = { x: mo.mesh.position.x, z: mo.mesh.position.z };
      const edges = mo.def.kind === 'tile' ? parseTileEdges(mo.def.meta) : undefined;
      grid.highlight(pos, mo.def.kind === 'tile' ? 'tile' : layerOf(mo.def.kind), edges);
    }),
  );

  return {
    stats,
    detach(): void {
      for (const off of offs) off();
      offs.length = 0;
    },
  };
}
