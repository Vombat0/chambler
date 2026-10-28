import { describe, expect, it } from 'vitest';
import { PALETTE_ITEMS, pawnItem } from './paletteItems.js';
import { DEFAULT_PAWN_COLOR, footprintForKind, occupiedFrom, planPaletteSpawn, restHeight } from './paletteSpawn.js';
import { boxOverlap } from './spawnPlacer.js';

const d6 = PALETTE_ITEMS.find((item) => item.id === 'd6')!;
const d20 = PALETTE_ITEMS.find((item) => item.id === 'd20')!;
const deck = PALETTE_ITEMS.find((item) => item.id === 'deck')!;

describe('palette spawn planning (D2)', () => {
  it('adet kadar nesne üretir ve kimlikler benzersizdir', () => {
    const result = planPaletteSpawn({ item: d6, count: 5 });
    expect(result.defs).toHaveLength(5);
    expect(new Set(result.defs.map((def) => def.id)).size).toBe(5);
    expect(result.skipped).toBe(0);
  });

  it('adet 1–10 aralığına kırpılır', () => {
    expect(planPaletteSpawn({ item: d6, count: 0 }).defs).toHaveLength(1);
    expect(planPaletteSpawn({ item: d6, count: 99 }).defs).toHaveLength(10);
  });

  it('üretilen nesneler birbiriyle çakışmaz', () => {
    const { defs } = planPaletteSpawn({ item: deck, count: 6 });
    const foot = footprintForKind('deck');
    for (let i = 0; i < defs.length; i++) {
      for (let j = i + 1; j < defs.length; j++) {
        const a = defs[i]!;
        const b = defs[j]!;
        expect(
          boxOverlap(
            { x: a.transform.position.x, z: a.transform.position.z, foot },
            { x: b.transform.position.x, z: b.transform.position.z, foot },
          ),
        ).toBe(false);
      }
    }
  });

  it('zemin yüksekliği türün yarı boyuna göre hesaplanır', () => {
    const { defs } = planPaletteSpawn({ item: d20, count: 2 });
    for (const def of defs) {
      expect(def.transform.position.y).toBeCloseTo(restHeight('die'));
    }
    expect(restHeight('board')).toBeGreaterThan(restHeight('card'));
  });

  it('zarların meta.sides değeri yüz sayısıdır', () => {
    const { defs } = planPaletteSpawn({ item: d20, count: 1 });
    expect(defs[0]?.meta.sides).toBe(20);
    expect(defs[0]?.meta.paletteItem).toBe('d20');
  });

  it('piyon varsayılan ve özel rengi meta.color olarak taşır', () => {
    const plain = planPaletteSpawn({ item: pawnItem(), count: 1 }).defs[0];
    expect(plain?.meta.color).toBe(DEFAULT_PAWN_COLOR);
    const custom = planPaletteSpawn({ item: pawnItem(), count: 1, color: '#123456' }).defs[0];
    expect(custom?.meta.color).toBe('#123456');
  });

  it('masa doluysa kopyalar atlanır ve sayı raporlanır', () => {
    const result = planPaletteSpawn({ item: deck, count: 3, bounds: { halfX: 0.2, halfZ: 0.2 } });
    expect(result.defs).toHaveLength(0);
    expect(result.skipped).toBe(3);
  });

  it('mevcut nesnelerin üstüne yerleşmez', () => {
    const occupied = occupiedFrom([{ kind: 'token', x: 0, z: 0 }]);
    const { defs } = planPaletteSpawn({ item: d6, count: 1, occupied });
    expect(defs).toHaveLength(1);
    const tokenFoot = footprintForKind('token');
    expect(
      boxOverlap(
        { x: defs[0]!.transform.position.x, z: defs[0]!.transform.position.z, foot: footprintForKind('die') },
        { x: 0, z: 0, foot: tokenFoot },
      ),
    ).toBe(false);
  });

  it('enjekte edilen idFactory deterministiktir', () => {
    const { defs } = planPaletteSpawn({
      item: d6,
      count: 2,
      idFactory: (item, index) => `${item.id}-${index}`,
    });
    expect(defs.map((def) => def.id)).toEqual(['d6-0', 'd6-1']);
  });

  it('occupiedFrom tür ayak izini kullanır', () => {
    const [entry] = occupiedFrom([{ kind: 'card', x: 1, z: 2 }]);
    expect(entry).toEqual({ x: 1, z: 2, foot: footprintForKind('card') });
  });
});
