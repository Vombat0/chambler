import { describe, expect, it } from 'vitest';
import {
  boxOverlap,
  findFreeSpot,
  fitsBounds,
  type Footprint,
  type Occupied,
} from './spawnPlacer.js';

const SMALL: Footprint = { x: 0.5, y: 0.5, z: 0.5 };
const BOUNDS = { halfX: 4, halfZ: 3 };

function overlapAny(point: { x: number; z: number; foot: Footprint }, occupied: readonly Occupied[]): boolean {
  return occupied.some((other) => boxOverlap(point, other));
}

describe('spawn placer (D2)', () => {
  it('AABB çakışması temas hâlinde bile false döner (ayrı kutular)', () => {
    const a = { x: 0, z: 0, foot: { x: 1, y: 1, z: 1 } };
    const b: Occupied = { x: 1.2, z: 0, foot: { x: 1, y: 1, z: 1 } };
    expect(boxOverlap(a, b)).toBe(false);
    expect(boxOverlap(a, { ...b, x: 1.0 })).toBe(true);
  });

  it('fitsBounds kenar payını uygular', () => {
    const point = { x: 3.7, z: 0, foot: { x: 0.5, y: 0.5, z: 0.5 } };
    expect(fitsBounds(point, BOUNDS)).toBe(false);
    expect(fitsBounds({ ...point, x: 3.3 }, BOUNDS)).toBe(true);
  });

  it('boş masada merkeze yerleşir', () => {
    expect(findFreeSpot(SMALL, [], BOUNDS)).toEqual({ x: 0, z: 0, attempts: 1 });
  });

  it('dolu merkezin dışına çıkar ve çakışmaz', () => {
    const occupied: Occupied[] = [{ x: 0, z: 0, foot: SMALL }];
    const spot = findFreeSpot(SMALL, occupied, BOUNDS);
    expect(spot).not.toBeNull();
    expect(spot?.x !== 0 || spot?.z !== 0).toBe(true);
    expect(overlapAny({ x: spot!.x, z: spot!.z, foot: SMALL }, occupied)).toBe(false);
  });

  it('birden çok mevcut nesneyle çakışmayan nokta bulur', () => {
    const occupied: Occupied[] = [
      { x: 0, z: 0, foot: SMALL },
      { x: 0.5, z: 0, foot: SMALL },
      { x: -0.5, z: 0, foot: SMALL },
      { x: 0, z: 0.5, foot: SMALL },
      { x: 0, z: -0.5, foot: SMALL },
    ];
    const spot = findFreeSpot(SMALL, occupied, BOUNDS);
    expect(spot).not.toBeNull();
    expect(overlapAny({ x: spot!.x, z: spot!.z, foot: SMALL }, occupied)).toBe(false);
  });

  it('yerleştirilen tüm nesneler birbiriyle çakışmaz', () => {
    const occupied: Occupied[] = [];
    for (let i = 0; i < 8; i++) {
      const spot = findFreeSpot(SMALL, occupied, BOUNDS);
      expect(spot).not.toBeNull();
      expect(overlapAny({ x: spot!.x, z: spot!.z, foot: SMALL }, occupied)).toBe(false);
      occupied.push({ x: spot!.x, z: spot!.z, foot: SMALL });
    }
    expect(new Set(occupied.map((o) => `${o.x}:${o.z}`)).size).toBe(8);
  });

  it('masa sınırlarından büyük nesne için null döner', () => {
    expect(findFreeSpot({ x: 9, y: 1, z: 9 }, [], BOUNDS)).toBeNull();
  });

  it('masa dolduğunda null döner', () => {
    const occupied: Occupied[] = [];
    for (let x = -3.5; x <= 3.5; x += 0.5) {
      for (let z = -2.5; z <= 2.5; z += 0.5) {
        occupied.push({ x, z, foot: { x: 0.5, y: 0.5, z: 0.5 } });
      }
    }
    expect(findFreeSpot(SMALL, occupied, BOUNDS)).toBeNull();
  });

  it('denenen aday sayısı raporlanır', () => {
    const occupied: Occupied[] = [{ x: 0, z: 0, foot: SMALL }];
    const spot = findFreeSpot(SMALL, occupied, BOUNDS);
    expect(spot!.attempts).toBeGreaterThan(1);
  });

  it('küçük step daha ince yerleşim sağlar', () => {
    const occupied: Occupied[] = [{ x: 0, z: 0, foot: SMALL }];
    const coarse = findFreeSpot(SMALL, occupied, BOUNDS, { step: 1 });
    const fine = findFreeSpot(SMALL, occupied, BOUNDS, { step: 0.25 });
    expect(fine).not.toBeNull();
    expect(Math.hypot(fine!.x, fine!.z)).toBeLessThanOrEqual(Math.hypot(coarse!.x, coarse!.z));
  });
});
