/**
 * Board slots (A5): named snap points defined on a board object
 * (matches the modkit `board.snapPoints` schema: { id, position[x,y,z], rotation? }).
 * Pure TS — no WebGL.
 */

import type { PlaceRejection } from './TileEdges.js';
import type { WorldPoint } from './GridModel.js';

export interface SnapPointDef {
  id: string;
  /** [x, y, z] world position of the slot (schema uses a tuple). */
  position: [number, number, number];
  rotation?: [number, number, number];
}

export interface SlotPlacement {
  slotId: string;
  objectId: string;
}

export interface SlotQueryResult {
  slot: SnapPointDef;
  distance: number;
}

export type SlotResult =
  | { ok: true; slot: SnapPointDef }
  | { ok: false; reason: PlaceRejection };

/** Minimal 2-D view over the slot tuple. */
function slotWorld(slot: SnapPointDef): WorldPoint {
  return { x: slot.position[0]!, z: slot.position[2]! };
}

export class BoardSlots {
  private readonly points = new Map<string, SnapPointDef>();
  private readonly occupantBySlot = new Map<string, string>();
  private readonly slotOfObject = new Map<string, string>();

  constructor(points: readonly SnapPointDef[] = []) {
    for (const p of points) {
      this.points.set(p.id, p);
    }
  }

  byName(id: string): SnapPointDef | undefined {
    return this.points.get(id);
  }

  all(): SnapPointDef[] {
    return Array.from(this.points.values());
  }

  /** Nearest free slot within `threshold` world units of the point, or null. */
  nearestFree(point: WorldPoint, threshold: number): SlotQueryResult | null {
    let best: SlotQueryResult | null = null;
    for (const slot of this.points.values()) {
      if (this.occupantBySlot.has(slot.id)) continue;
      const w = slotWorld(slot);
      const d = Math.hypot(point.x - w.x, point.z - w.z);
      if (d <= threshold && (best === null || d < best.distance)) {
        best = { slot, distance: d };
      }
    }
    return best;
  }

  occupy(slotId: string, objectId: string, releaseExisting: (objectId: string) => void = () => {}): SlotResult {
    const slot = this.points.get(slotId);
    if (!slot) return { ok: false, reason: 'SLOT_UNKNOWN' };
    const existing = this.occupantBySlot.get(slotId);
    if (existing !== undefined && existing !== objectId) {
      return { ok: false, reason: 'SLOT_OCCUPIED' };
    }
    this.clearObject(objectId, releaseExisting);
    this.occupantBySlot.set(slotId, objectId);
    this.slotOfObject.set(objectId, slotId);
    return { ok: true, slot };
  }

  /** Removes the object from its slot (if any); returns the slot id or null. */
  release(objectId: string): string | null {
    const slotId = this.slotOfObject.get(objectId);
    if (slotId === undefined) return null;
    this.slotOfObject.delete(objectId);
    if (this.occupantBySlot.get(slotId) === objectId) {
      this.occupantBySlot.delete(slotId);
    }
    return slotId;
  }

  private clearObject(objectId: string, releaseExisting: (objectId: string) => void): void {
    releaseExisting(objectId);
    this.slotOfObject.delete(objectId);
  }

  occupant(slotId: string): string | undefined {
    return this.occupantBySlot.get(slotId);
  }

  slotOf(objectId: string): string | undefined {
    return this.slotOfObject.get(objectId);
  }
}
