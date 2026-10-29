/**
 * D2 — Paket kurulumu: manifest → masa nesneleri (saf).
 *
 * "Mülk Tycoon" tek tıkla masa kurulumu. Adımlar (`PACK_STEPS`):
 *   validate → board → pawns → decks → money
 * Her adım saf olarak `ObjectDef` üretir; gerçek spawn, React tarafındaki
 * kare bütçeli kuyrukla (`spawnQueue`) uygulanır. Sanat PNG'leri indirilmez;
 * `assetRef` mantıksal varlık adıdır.
 *
 * Yerleşim:
 *   - Tahta 6 × 4,5 m kutu, `BOARD_CENTER` konumunda (masa 8 × 6).
 *   - `manifest.board.snapPoints` (40 hücre) tahta yüzeyine ölçeklenir ve
 *     `meta.slots` olarak saklanır (A5 BoardSlots uyumlu).
 *   - Piyonlar başlangıç hücresine 3 × 2 ızgara yerleşir (`packPlace: fixed`).
 *   - Desteler ve para, tahtanın sağındaki boş şeride `findFreeSpot` ile
 *     çakışmadan konur; sığmayan nesne atlanır (sonuç raporlanır).
 */

import { generateId, type ObjectDef } from '@chambler/shared';
import { TABLE_HALF_X, TABLE_HALF_Z } from '../camera/bounds.js';
import { OBJECT_SPECS } from '../object/ObjectSpec.js';
import type { GamePackManifest } from './packValidation.js';
import { findFreeSpot, type Footprint, type Occupied } from './spawnPlacer.js';

export type PackStepId = 'validate' | 'board' | 'pawns' | 'decks' | 'money';

export const PACK_STEPS: readonly PackStepId[] = ['validate', 'board', 'pawns', 'decks', 'money'];

/** Bu görevin standart paket kimliği. */
export const PROPERTY_TYCOON_PACK_ID = 'property-tycoon';

export interface PackStepState {
  readonly id: PackStepId;
  readonly state: 'pending' | 'running' | 'ok' | 'failed';
  /** Başarısızlık açıklaması (i18n değerine eklenir). */
  readonly message?: string;
}

export interface PackLoadProgress {
  readonly steps: readonly PackStepState[];
  readonly current: PackStepId | null;
  readonly failed: boolean;
}

export function initialProgress(): PackLoadProgress {
  return {
    steps: PACK_STEPS.map((id) => ({ id, state: 'pending' as const })),
    current: null,
    failed: false,
  };
}

export function stepProgress(
  all: PackLoadProgress,
  id: PackStepId,
  state: PackStepState['state'],
  message?: string,
): PackLoadProgress {
  const steps = all.steps.map((step) =>
    step.id === id ? { ...step, state, message: message ?? step.message } : step,
  );
  return { steps, current: id, failed: all.failed || state === 'failed' };
}

/** Tüm adımlar `ok` mu? (UI "yüklendi" durumu için.) */
export function isComplete(progress: PackLoadProgress): boolean {
  return progress.steps.every((step) => step.state === 'ok');
}

/* --------------------------------------------------------------- */
/* Tahta geometrisi                                                  */
/* --------------------------------------------------------------- */

/** Tahta ayak izi = ObjectSpec.board ölçüsü (görsel ile birebir). */
export const BOARD_FOOTPRINT: Footprint = {
  x: OBJECT_SPECS.board.size.x,
  y: OBJECT_SPECS.board.size.y,
  z: OBJECT_SPECS.board.size.z,
};

/** Tahta merkezi: sağında deste/para için ~1,5 m şerit bırakır. */
export const BOARD_CENTER = { x: -0.9, z: 0 };

/** Bu paket için varsayılan masa sınırları (yarı ölçüler). */
export const PACK_BOUNDS = { halfX: TABLE_HALF_X, halfZ: TABLE_HALF_Z } as const;

/** Snap koordinatlarının tahta üzerindeki dünya konumları. */
export function slotWorldPositions(
  board: GamePackManifest['board'],
): Array<{ id: string; position: { x: number; y: number; z: number } }> {
  const snaps = board?.snapPoints ?? [];
  if (snaps.length === 0) return [];
  const spanX = Math.max(...snaps.map((s) => s.position[0]), 0) + 1;
  const spanZ = Math.max(...snaps.map((s) => s.position[2]), 0) + 1;
  const scaleX = BOARD_FOOTPRINT.x / spanX;
  const scaleZ = BOARD_FOOTPRINT.z / spanZ;
  const halfX = (spanX * scaleX) / 2;
  const halfZ = (spanZ * scaleZ) / 2;
  return snaps.map((snap) => ({
    id: snap.id,
    position: {
      x: BOARD_CENTER.x - halfX + snap.position[0] * scaleX,
      y: BOARD_FOOTPRINT.y,
      z: BOARD_CENTER.z - halfZ + snap.position[2] * scaleZ,
    },
  }));
}

/** Hücre ölçeği (telefon/tablet görünümünde ızgara çizimi için). */
export function boardCellScale(board: GamePackManifest['board']): number {
  const snaps = board?.snapPoints ?? [];
  if (snaps.length === 0) return 0.3;
  const spanX = Math.max(...snaps.map((s) => s.position[0]), 0) + 1;
  const spanZ = Math.max(...snaps.map((s) => s.position[2]), 0) + 1;
  return Math.min(BOARD_FOOTPRINT.x / spanX, BOARD_FOOTPRINT.z / spanZ);
}

export function materializeBoard(
  manifest: GamePackManifest,
): { def: ObjectDef; slots: Array<{ id: string; position: { x: number; y: number; z: number } }> } | null {
  const board = manifest.board;
  const component = manifest.components.find((c) => c.kind === 'board');
  if (!component || !board || board.snapPoints.length === 0) return null;

  const slots = slotWorldPositions(board);
  const def: ObjectDef = {
    id: generateId('pack-board'),
    kind: 'board',
    assetRef: component.assetRef,
    transform: {
      position: { x: BOARD_CENTER.x, y: BOARD_FOOTPRINT.y / 2, z: BOARD_CENTER.z },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {
      name: manifest.name,
      slots,
      sourcePack: manifest.packId,
      /** Görsel kaplama kaynağı (`board-plate` → board.png). */
      artRef: component.assetRef,
      cellSize: boardCellScale(board),
      rows: board.grid?.rows ?? 0,
      cols: board.grid?.cols ?? 0,
    },
  };
  return { def, slots };
}

/* --------------------------------------------------------------- */
/* Piyonlar: başlangıç hücresinde 3 × 2                              */
/* --------------------------------------------------------------- */

export interface PackPawnSource {
  /** Mantıksal varlık adı (`token-crimson`). */
  readonly assetRef: string;
  /** CSS rengi. */
  readonly color: string;
  /** Kararlı etiket (component id). */
  readonly label: string;
}

/** Manifestteki pawn component'lerinden piyon kaynakları. */
export function pawnSources(manifest: GamePackManifest): PackPawnSource[] {
  return manifest.components
    .filter((component) => component.kind === 'pawn')
    .map((component) => {
      const meta = component.defaultMeta ?? {};
      return {
        assetRef: component.assetRef,
        color: typeof meta.color === 'string' ? meta.color : '#e5533c',
        label: component.id,
      };
    });
}

export function materializePawns(
  slots: ReadonlyArray<{ id: string; position: { x: number; y: number; z: number } }>,
  sources: readonly PackPawnSource[],
  manifest: GamePackManifest,
): ObjectDef[] {
  const start = slots[0];
  if (!start || sources.length === 0) return [];

  return sources.map((source, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return {
      id: generateId('pack-pawn'),
      kind: 'pawn' as const,
      assetRef: source.assetRef,
      transform: {
        position: {
          x: start.position.x + (col - 1) * 0.45,
          y: OBJECT_SPECS.pawn.size.y / 2 + 0.02,
          z: start.position.z + (row - 0.5) * 0.45,
        },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      ownerId: null,
      locked: false,
      faceUp: true,
      meta: {
        color: source.color,
        label: source.label,
        snapPoint: start.id,
        sourcePack: manifest.packId,
        packPlace: 'fixed',
      },
    };
  });
}

/* --------------------------------------------------------------- */
/* Deste + para                                                      */
/* --------------------------------------------------------------- */

export function materializeDecks(manifest: GamePackManifest): ObjectDef[] {
  return (manifest.decks ?? []).map((deck) => ({
    id: generateId('pack-deck'),
    kind: 'deck' as const,
    assetRef: deck.backAssetRef ?? deck.faces[0] ?? '',
    transform: {
      position: { x: 3, y: OBJECT_SPECS.deck.size.y / 2 + 0.01, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ownerId: null,
    locked: false,
    faceUp: false,
    meta: {
      deckId: deck.id,
      faceCount: deck.faces.length,
      faces: deck.faces,
      sourcePack: manifest.packId,
    },
  }));
}

export function materializeMoney(manifest: GamePackManifest): ObjectDef[] {
  const helper = manifest.helpers?.find((h) => h.type === 'money');
  const denominations = helper?.config?.denominations;
  const values = Array.isArray(denominations)
    ? denominations.filter((value): value is number => typeof value === 'number')
    : [];
  return values.map((denomination) => {
    const assetName = `money-${denomination}`;
    return {
      id: generateId('pack-money'),
      kind: 'token' as const,
      assetRef: assetName,
      transform: {
        position: { x: 3, y: OBJECT_SPECS.token.size.y / 2 + 0.01, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      ownerId: null,
      locked: false,
      faceUp: true,
      meta: {
        label: `${denomination} CHB`,
        denomination,
        sourcePack: manifest.packId,
      },
    };
  });
}

/* --------------------------------------------------------------- */
/* Yerleştirme                                                       */
/* --------------------------------------------------------------- */

export interface PlaceResult {
  readonly placed: ObjectDef[];
  /** Tahtada boş yer olmadığı için atlanan nesne sayısı. */
  readonly skipped: number;
}

/**
 * Sıralı yerleştirme: tahta ve `packPlace: 'fixed'` nesneler konumunu korur;
 * diğerleri `findFreeSpot` ile boş noktaya taşınır. Tahta doluysa nesne
 * atlanır (kural ihlali yerine görünür eksiklik).
 */
export function placePackDefs(
  defs: readonly ObjectDef[],
  existing: readonly Occupied[],
  bounds: { halfX: number; halfZ: number } = PACK_BOUNDS,
  step = 0.5,
): PlaceResult {
  const occupied: Occupied[] = [...existing];
  const placed: ObjectDef[] = [];
  let skipped = 0;

  for (const def of defs) {
    const spec = OBJECT_SPECS[def.kind] ?? OBJECT_SPECS.custom;
    const foot: Footprint = { x: spec.size.x, y: spec.size.y, z: spec.size.z };
    const fixed = def.kind === 'board' || def.meta?.packPlace === 'fixed';
    let x = def.transform.position.x;
    let z = def.transform.position.z;

    if (!fixed) {
      const spot = findFreeSpot(foot, occupied, bounds, { step });
      if (!spot) {
        skipped++;
        continue;
      }
      x = spot.x;
      z = spot.z;
    }

    placed.push({
      ...def,
      transform: { ...def.transform, position: { x, y: def.transform.position.y, z } },
    });
    occupied.push({ x, z, foot });
  }

  return { placed, skipped };
}

export interface PackTable {
  readonly manifest: GamePackManifest;
  /** Adım bazında spawn edilecek nesneler (validate adımı boştur). */
  readonly defsByStep: Readonly<Record<PackStepId, readonly ObjectDef[]>>;
  readonly slots: Array<{ id: string; position: { x: number; y: number; z: number } }>;
  readonly all: readonly ObjectDef[];
  readonly skipped: number;
}

/**
 * Manifestten tam masa kurulumu üretir. `validate` adımı doğrulamayı temsil
 * eder (çağıran manifesti `validatePackManifest` ile doğrulamış olmalı);
 * burada yalnızca yerleşim yapılır.
 */
export function buildPackTable(
  manifest: GamePackManifest,
  existing: readonly Occupied[] = [],
  bounds: { halfX: number; halfZ: number } = PACK_BOUNDS,
): PackTable {
  const boardResult = materializeBoard(manifest);
  const slots = boardResult?.slots ?? [];
  const boardDefs = boardResult ? [boardResult.def] : [];

  const pawns = materializePawns(slots, pawnSources(manifest), manifest);
  const decks = materializeDecks(manifest);
  const money = materializeMoney(manifest);

  const occupied: Occupied[] = [...existing];
  let skipped = 0;

  const take = (result: PlaceResult): ObjectDef[] => {
    skipped += result.skipped;
    for (const def of result.placed) {
      const spec = OBJECT_SPECS[def.kind] ?? OBJECT_SPECS.custom;
      occupied.push({
        x: def.transform.position.x,
        z: def.transform.position.z,
        foot: { x: spec.size.x, y: spec.size.y, z: spec.size.z },
      });
    }
    return [...result.placed];
  };

  const boardPlaced = take(placePackDefs(boardDefs, occupied, bounds));
  const pawnsPlaced = take(placePackDefs(pawns, occupied, bounds));
  const decksPlaced = take(placePackDefs(decks, occupied, bounds));
  const moneyPlaced = take(placePackDefs(money, occupied, bounds));

  const defsByStep: Record<PackStepId, readonly ObjectDef[]> = {
    validate: [],
    board: boardPlaced,
    pawns: pawnsPlaced,
    decks: decksPlaced,
    money: moneyPlaced,
  };

  return {
    manifest,
    defsByStep,
    slots,
    all: [...boardPlaced, ...pawnsPlaced, ...decksPlaced, ...moneyPlaced],
    skipped,
  };
}
