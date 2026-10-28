import { describe, expect, it } from 'vitest';
import { BoardSlots, type SnapPointDef } from './BoardSlots.js';

const pts: SnapPointDef[] = [
  { id: 'go', position: [0, 0, 0] },
  { id: 'boardwalk', position: [10, 0, 4] },
  { id: 'jail', position: [10, 0, -4] },
];

describe('BoardSlots', () => {
  it('byName resolves defined slots and misses unknown ones', () => {
    const slots = new BoardSlots(pts);
    expect(slots.byName('go')?.position).toEqual([0, 0, 0]);
    expect(slots.byName('nowhere')).toBeUndefined();
  });

  it('occupy tracks the occupant; the object keeps exactly one slot', () => {
    const slots = new BoardSlots(pts);
    expect(slots.occupy('go', 'pawn1').ok).toBe(true);
    expect(slots.occupant('go')).toBe('pawn1');
    expect(slots.slotOf('pawn1')).toBe('go');
  });

  it('occupying a taken slot is rejected with SLOT_OCCUPIED', () => {
    const slots = new BoardSlots(pts);
    slots.occupy('go', 'pawn1');
    const r = slots.occupy('go', 'pawn2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('SLOT_OCCUPIED');
  });

  it('unknown slot id is rejected', () => {
    const slots = new BoardSlots(pts);
    const r = slots.occupy('missing', 'pawn1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('SLOT_UNKNOWN');
  });

  it('release frees the slot and returns its id', () => {
    const slots = new BoardSlots(pts);
    slots.occupy('go', 'pawn1');
    expect(slots.release('pawn1')).toBe('go');
    expect(slots.occupant('go')).toBeUndefined();
    expect(slots.release('pawn1')).toBeNull();
  });

  it('nearestFree honors the threshold and skips occupied slots', () => {
    const slots = new BoardSlots(pts);
    expect(slots.nearestFree({ x: 0.4, z: 0 }, 0.45)?.slot.id).toBe('go');
    expect(slots.nearestFree({ x: 3, z: 3 }, 0.45)).toBeNull();
    slots.occupy('go', 'pawn1');
    expect(slots.nearestFree({ x: 0.4, z: 0 }, 0.45)).toBeNull();
    slots.release('pawn1');
    expect(slots.nearestFree({ x: 9.6, z: 3.6 }, 1)?.slot.id).toBe('boardwalk');
  });
});
