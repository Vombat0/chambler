import { describe, expect, it } from 'vitest';
import { OccupancyMap } from './Occupancy.js';
import type { CellCoord } from './GridModel.js';

const c0: CellCoord = { col: 1, row: 1 };
const c1: CellCoord = { col: 2, row: 1 };

describe('OccupancyMap', () => {
  it('place + layerAt registers an object on its layer', () => {
    const occ = new OccupancyMap();
    const r = occ.place(c0, 'tok1', 'token');
    expect(r.ok).toBe(true);
    expect(occ.layerAt(c0, 'token')).toBe('tok1');
    expect(occ.cellOf('tok1')).toEqual(c0);
  });

  it('same layer in the same cell is a conflict', () => {
    const occ = new OccupancyMap();
    occ.place(c0, 'a', 'token');
    const check = occ.canPlace(c0, 'token');
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('CELL_OCCUPIED');
  });

  it('other cells are independent', () => {
    const occ = new OccupancyMap();
    occ.place(c0, 'a', 'token');
    expect(occ.canPlace(c1, 'token').ok).toBe(true);
  });

  it('multiLayer: token and tile share one cell', () => {
    const occ = new OccupancyMap({ multiLayer: true });
    occ.place(c0, 'tileA', 'tile');
    expect(occ.canPlace(c0, 'token').ok).toBe(true);
    occ.place(c0, 'tokB', 'token');
    expect(occ.layerAt(c0, 'tile')).toBe('tileA');
    expect(occ.layerAt(c0, 'token')).toBe('tokB');
  });

  it('multiLayer=false: any occupant blocks the cell', () => {
    const occ = new OccupancyMap({ multiLayer: false });
    occ.place(c0, 'tileA', 'tile');
    const check = occ.canPlace(c0, 'token');
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('CELL_OCCUPIED');
  });

  it('unknown layer is rejected', () => {
    const occ = new OccupancyMap();
    const check = occ.canPlace(c0, 'pawn');
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('LAYER_UNKNOWN');
  });

  it('place on an existing object moves it and returns its previous cell on remove', () => {
    const occ = new OccupancyMap();
    occ.place(c0, 'tok1', 'token');
    occ.place(c1, 'tok1', 'token');
    expect(occ.cellOf('tok1')).toEqual(c1);
    expect(occ.layerAt(c0, 'token')).toBeUndefined();
    const removed = occ.remove('tok1');
    expect(removed).toEqual(c1);
    expect(occ.remove('tok1')).toBeNull();
  });

  it('occupant returns the first layer occupant (tile wins)', () => {
    const occ = new OccupancyMap({ multiLayer: true });
    occ.place(c0, 'tok1', 'token');
    occ.place(c0, 'tile1', 'tile');
    expect(occ.occupant(c0)).toBe('tile1'); // 'tile' listed before 'token'
  });

  it('entries lists only occupied cells', () => {
    const occ = new OccupancyMap();
    occ.place(c0, 'a', 'token');
    occ.place(c1, 'b', 'token');
    occ.remove('b');
    expect(Array.from(occ.entries()).length).toBe(1);
  });

  it('isOccupied reflects the main layer', () => {
    const occ = new OccupancyMap();
    expect(occ.isOccupied(c0)).toBe(false);
    occ.place(c0, 't', 'tile');
    expect(occ.isOccupied(c0)).toBe(true);
  });
});
