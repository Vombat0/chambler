import { describe, expect, it } from 'vitest';
import {
  BOARD_UNITS,
  CELL_UNITS,
  boardToWorld,
  buildCellGeometry,
  cellAt,
  cellContaining,
  cellRect,
  clampToBoard,
  nearestCell,
  snapToCell,
  stackOffset,
  worldToBoard,
  type CellInput,
} from './boardGeometry.js';
import { BOARD_JSON } from './boardData.js';

const cells = buildCellGeometry(BOARD_JSON.cells);

describe('boardGeometry — paketten geometri', () => {
  it('40 hücrenin tamamını üretir ve index sırasını korur', () => {
    expect(cells).toHaveLength(40);
    cells.forEach((geom, i) => expect(geom.index).toBe(i));
  });

  it('başlangıç hücresi sağ alt köşededir (slot 0, alt kenar)', () => {
    const start = cellAt(cells, 0);
    expect(start).not.toBeNull();
    expect(start!.side).toBe('bottom');
    expect(start!.slot).toBe(0);
    expect(start!.x).toBeCloseTo(BOARD_UNITS - CELL_UNITS, 6);
    expect(start!.y).toBeCloseTo(BOARD_UNITS - CELL_UNITS, 6);
  });

  it('köşe hücreleri sanat betiğiyle aynı konumlarda: hapishane sol alt, zindana sağ üst', () => {
    const jail = cellAt(cells, 10)!;
    const goToJail = cellAt(cells, 30)!;
    expect(jail.x).toBeCloseTo(0, 6);
    expect(jail.y).toBeCloseTo(BOARD_UNITS - CELL_UNITS, 6);
    expect(goToJail.x).toBeCloseTo(BOARD_UNITS - CELL_UNITS, 6);
    expect(goToJail.y).toBeCloseTo(0, 6);
  });

  it('cellRect dört kenarın hepsi için hücreyi ızgarada tutar', () => {
    const inputs: CellInput[] = BOARD_JSON.cells;
    for (const cell of inputs) {
      const { x, y } = cellRect(cell.side, cell.slot);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + CELL_UNITS).toBeLessThanOrEqual(BOARD_UNITS + 1e-9);
      expect(y + CELL_UNITS).toBeLessThanOrEqual(BOARD_UNITS + 1e-9);
    }
  });
});

describe('boardGeometry — koordinat eşleme', () => {
  it('board↔world turunda birim kaybsız döner (1000 birim = 10 m)', () => {
    const world = boardToWorld(555, 111);
    expect(world).toEqual({ x: 5.55, y: 0, z: 1.11 });
    const back = worldToBoard({ x: world.x, z: world.z });
    expect(back.x).toBeCloseTo(555, 9);
    expect(back.y).toBeCloseTo(111, 9);
  });

  it('clampToBoard taşan koordinatları 0..1000 arasına çeker', () => {
    expect(clampToBoard({ x: -50, y: 1200 })).toEqual({ x: 0, y: 1000 });
  });

  it('cellContaining tam isabetli hücreyi bulur, orta alanda null döner', () => {
    const startCenter = cellAt(cells, 0)!;
    expect(cellContaining(cells, { x: startCenter.cx, y: startCenter.cy })?.index).toBe(0);
    expect(cellContaining(cells, { x: 500, y: 500 })).toBeNull();
  });
});

describe('boardGeometry — snap', () => {
  it('hücre içine bırakılan piyon o hücreye oturur', () => {
    const target = cellAt(cells, 5)!;
    const snap = snapToCell(cells, { x: target.cx + 12, y: target.cy - 8 }, 0);
    expect(snap?.cell.index).toBe(5);
    expect(snap!.x).toBeCloseTo(target.cx, 6);
    expect(snap!.y).toBeCloseTo(target.cy, 6);
  });

  it('orta alana (geçersiz) bırakılan piyon en yakın çevre hücresine snap olur', () => {
    const snap = snapToCell(cells, { x: 500, y: 500 }, 0);
    expect(snap).not.toBeNull();
    const center = snap!.cell;
    // Merkeze en yakın çevre hücrelerinden biri seçilmeli: ızgara merkezi
    // çevre hücre merkezlerine ~5 hücre uzaklıktadır.
    const dist = Math.hypot(center.cx - 500, center.cy - 500);
    expect(dist).toBeLessThanOrEqual(CELL_UNITS * 5.1);
    expect(snap!.x).toBeGreaterThanOrEqual(0);
    expect(snap!.y).toBeLessThanOrEqual(BOARD_UNITS);
  });

  it('hücre kenarına yakın dış nokta da bir hücreye bağlanır', () => {
    const cell3 = cellAt(cells, 3)!;
    const justOutside = { x: cell3.cx, y: cell3.y - CELL_UNITS / 2 + 2 };
    const nearest = nearestCell(cells, justOutside);
    expect(nearest).not.toBeNull();
    const dist = Math.hypot(nearest!.cx - justOutside.x, nearest!.cy - justOutside.y);
    expect(dist).toBeLessThan(CELL_UNITS * 1.5);
  });

  it('çoklu piyon aynı hücrede yelpaze ofsetiyle ayrışır', () => {
    const second = stackOffset(3, 1);
    // Tek piyon merkezde, ikiden itibaren yarıçapı hücrenin yarısından küçük çemberde.
    expect(stackOffset(1, 0)).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(second.x, second.y)).toBeGreaterThan(0);
    expect(Math.hypot(second.x, second.y)).toBeLessThan(CELL_UNITS * 0.5);
  });

  it('snap hedefi mevcut piyon sayısına göre ofset uygular', () => {
    const target = cellAt(cells, 7)!;
    const alone = snapToCell(cells, { x: target.cx, y: target.cy }, 0)!;
    const crowded = snapToCell(cells, { x: target.cx, y: target.cy }, 2)!;
    expect(alone.x).toBeCloseTo(target.cx, 6);
    expect(Math.hypot(crowded.x - target.cx, crowded.y - target.cy)).toBeGreaterThan(0);
  });
});
