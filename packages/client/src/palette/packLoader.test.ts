import { describe, expect, it } from 'vitest';
import { propertyTycoonManifest } from './packSource.js';
import {
  BOARD_CENTER,
  BOARD_FOOTPRINT,
  PACK_STEPS,
  buildPackTable,
  initialProgress,
  isComplete,
  materializeBoard,
  materializeDecks,
  materializeMoney,
  materializePawns,
  pawnSources,
  slotWorldPositions,
  stepProgress,
} from './packLoader.js';
import { boxOverlap, type Footprint } from './spawnPlacer.js';
import { footprintForKind } from './paletteSpawn.js';

const manifest = propertyTycoonManifest();

function feet(def: { kind: string; transform: { position: { x: number; z: number } } }): {
  x: number;
  z: number;
  foot: Footprint;
} {
  return {
    x: def.transform.position.x,
    z: def.transform.position.z,
    foot: footprintForKind(def.kind as never),
  };
}

describe('pack loader (D2)', () => {
  it('manifestten altı piyon kaynağı ve rengi çıkar', () => {
    const sources = pawnSources(manifest);
    expect(sources).toHaveLength(6);
    expect(sources[0]?.assetRef).toBe('token-crimson');
    expect(sources[0]?.color).toMatch(/^#/);
    expect(new Set(sources.map((source) => source.assetRef)).size).toBe(6);
  });

  it('tahta 40 hücreyle üretilir', () => {
    const result = materializeBoard(manifest);
    expect(result).not.toBeNull();
    expect(result!.def.kind).toBe('board');
    expect(result!.slots).toHaveLength(40);
    expect(result!.def.meta.slots).toHaveLength(40);
    expect(result!.def.meta.sourcePack).toBe('property-tycoon');
  });

  it('tahta merkezi ve ölçüsü ObjectSpec ile uyumludur', () => {
    const def = materializeBoard(manifest)!.def;
    expect(def.transform.position.x).toBe(BOARD_CENTER.x);
    expect(def.transform.position.z).toBe(BOARD_CENTER.z);
    expect(def.transform.position.y).toBeCloseTo(BOARD_FOOTPRINT.y / 2);
  });

  it('hücre konumları tahta yüzeyinin içinde kalır', () => {
    const slots = slotWorldPositions(manifest.board);
    for (const slot of slots) {
      expect(slot.position.x).toBeGreaterThanOrEqual(BOARD_CENTER.x - BOARD_FOOTPRINT.x / 2 - 1e-9);
      expect(slot.position.x).toBeLessThanOrEqual(BOARD_CENTER.x + BOARD_FOOTPRINT.x / 2 + 1e-9);
      expect(Math.abs(slot.position.z - BOARD_CENTER.z)).toBeLessThanOrEqual(BOARD_FOOTPRINT.z / 2 + 1e-9);
      expect(slot.position.y).toBeCloseTo(BOARD_FOOTPRINT.y);
    }
  });

  it('piyonlar başlangıç hücresine sabit yerleşir', () => {
    const slots = slotWorldPositions(manifest.board);
    const pawns = materializePawns(slots, pawnSources(manifest), manifest);
    expect(pawns).toHaveLength(6);
    for (const pawn of pawns) {
      expect(pawn.meta.packPlace).toBe('fixed');
      expect(pawn.meta.snapPoint).toBe(slots[0]!.id);
      expect(pawn.kind).toBe('pawn');
    }
    expect(new Set(pawns.map((pawn) => pawn.meta.color)).size).toBe(6);
  });

  it('iki deste arka yüz varlığıyla üretilir', () => {
    const decks = materializeDecks(manifest);
    expect(decks).toHaveLength(2);
    expect(decks.map((deck) => deck.meta.deckId)).toEqual(['chance', 'community']);
    expect(decks[0]?.assetRef).toBe('card-back-chance');
    expect(decks[0]?.meta.faceCount).toBe(16);
    expect(decks[0]?.faceUp).toBe(false);
  });

  it('para birimleri helpers.money’den gelir', () => {
    const money = materializeMoney(manifest);
    expect(money).toHaveLength(6);
    expect(money.map((token) => token.meta.denomination)).toEqual([1, 5, 10, 50, 100, 500]);
    expect(money[0]?.assetRef).toBe('money-1');
    expect(money[0]?.kind).toBe('token');
  });

  it('tam masa kurulumu 15 nesne üretir ve hiçbiri atlanmaz', () => {
    const table = buildPackTable(manifest);
    expect(table.all).toHaveLength(15);
    expect(table.skipped).toBe(0);
    expect(table.all[0]?.kind).toBe('board');
  });

  it('adım dağılımı PACK_STEPS ile uyumludur', () => {
    const table = buildPackTable(manifest);
    expect(Object.keys(table.defsByStep).sort()).toEqual([...PACK_STEPS].sort());
    expect(table.defsByStep.validate).toHaveLength(0);
    expect(table.defsByStep.board).toHaveLength(1);
    expect(table.defsByStep.pawns).toHaveLength(6);
    expect(table.defsByStep.decks).toHaveLength(2);
    expect(table.defsByStep.money).toHaveLength(6);
  });

  it('masa üstü piyon dışındaki nesneler tahtayla çakışmaz', () => {
    const table = buildPackTable(manifest);
    const board = table.defsByStep.board[0]!;
    const boardBox = feet(board);
    for (const def of [...table.defsByStep.decks, ...table.defsByStep.money]) {
      expect(boxOverlap(feet(def), boardBox)).toBe(false);
    }
  });

  it('deste ve para birbirleriyle çakışmaz', () => {
    const table = buildPackTable(manifest);
    const objects = [...table.defsByStep.decks, ...table.defsByStep.money].map(feet);
    for (let i = 0; i < objects.length; i++) {
      for (let j = i + 1; j < objects.length; j++) {
        expect(boxOverlap(objects[i]!, objects[j]!)).toBe(false);
      }
    }
  });

  it('desteler tahtanın sağındaki şeride yerleşir', () => {
    const table = buildPackTable(manifest);
    for (const def of table.defsByStep.decks) {
      expect(def.transform.position.x).toBeGreaterThan(BOARD_CENTER.x + BOARD_FOOTPRINT.x / 2);
    }
  });

  it('tüm paket nesneleri masa sınırları içinde kalır', () => {
    const table = buildPackTable(manifest);
    for (const def of table.all) {
      const foot = footprintForKind(def.kind);
      expect(Math.abs(def.transform.position.x) + foot.x / 2).toBeLessThanOrEqual(4);
      expect(Math.abs(def.transform.position.z) + foot.z / 2).toBeLessThanOrEqual(3);
    }
  });

  it('dar masada sığmayanlar atlanır, tahta ve piyonlar kalır', () => {
    const table = buildPackTable(manifest, [], { halfX: 0.3, halfZ: 0.3 });
    expect(table.skipped).toBe(8);
    expect(table.defsByStep.board).toHaveLength(1);
    expect(table.defsByStep.pawns).toHaveLength(6);
    expect(table.defsByStep.decks).toHaveLength(0);
    expect(table.defsByStep.money).toHaveLength(0);
  });

  it('mevcut doluluk dikkate alınır', () => {
    const table = buildPackTable(manifest, [
      { x: 3, z: 0, foot: { x: 1, y: 1, z: 1 } },
      { x: 3, z: 1, foot: { x: 1, y: 1, z: 1 } },
    ]);
    for (const def of [...table.defsByStep.decks, ...table.defsByStep.money]) {
      expect(boxOverlap(feet(def), { x: 3, z: 0, foot: { x: 1, y: 1, z: 1 } })).toBe(false);
    }
  });

  it('ilerleme yardımcıları adımları sırayla işaretler', () => {
    let progress = initialProgress();
    expect(isComplete(progress)).toBe(false);
    progress = stepProgress(progress, 'validate', 'ok');
    progress = stepProgress(progress, 'board', 'failed', 'boom');
    expect(progress.failed).toBe(true);
    expect(progress.current).toBe('board');
    expect(progress.steps.find((step) => step.id === 'board')?.message).toBe('boom');
    expect(isComplete(progress)).toBe(false);
  });

  it('tüm adımlar ok olunca isComplete true olur', () => {
    let progress = initialProgress();
    for (const id of PACK_STEPS) progress = stepProgress(progress, id, 'ok');
    expect(isComplete(progress)).toBe(true);
    expect(progress.failed).toBe(false);
  });
});
