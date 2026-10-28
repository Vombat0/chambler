/**
 * D2 — Paletten nesne üretme (saf).
 *
 * `PaletteItemDef` + adet + masa doluluk durumu → `ObjectDef[]`. Yerleşim
 * `spawnPlacer` ile çakışmasız; sığmayan kopyalar atlanır ve `skipped`
 * olarak raporlanır. Kimlik üretimi enjekte edilebilir (testler deterministik).
 */

import { generateId, type ObjectDef, type ObjectKind } from '@chambler/shared';
import { TABLE_HALF_X, TABLE_HALF_Z } from '../camera/bounds.js';
import { OBJECT_SPECS } from '../object/ObjectSpec.js';
import { clampCopyCount, type PaletteItemDef } from './paletteItems.js';
import { findFreeSpot, type Footprint, type Occupied, type PlacerBounds } from './spawnPlacer.js';

/** Palet için masa sınırları (kenar payı placer'ın varsayılanına bırakılır). */
export const PALETTE_BOUNDS: PlacerBounds = { halfX: TABLE_HALF_X, halfZ: TABLE_HALF_Z };

/** Piyon varsayılan rengi (oyuncu paleti henüz seçilmediyse). */
export const DEFAULT_PAWN_COLOR = '#e5533c';

/** Kind → ayak izi (ObjectSpec'ten; görsel boyutla birebir). */
export function footprintForKind(kind: ObjectKind): Footprint {
  const spec = OBJECT_SPECS[kind] ?? OBJECT_SPECS.custom;
  return { x: spec.size.x, y: spec.size.y, z: spec.size.z };
}

/** Zeminin üstünde duracak şekilde y (yarı yükseklik + 2 cm). */
export function restHeight(kind: ObjectKind): number {
  const spec = OBJECT_SPECS[kind] ?? OBJECT_SPECS.custom;
  return spec.size.y / 2 + 0.02;
}

/** Masa nesnesinden placer girdisi (mesh pozisyonu). */
export interface TableObjectLike {
  readonly kind: ObjectKind;
  readonly x: number;
  readonly z: number;
}

export function occupiedFrom(objects: readonly TableObjectLike[]): Occupied[] {
  return objects.map((object) => ({
    x: object.x,
    z: object.z,
    foot: footprintForKind(object.kind),
  }));
}

export interface PlanPaletteSpawnInput {
  readonly item: PaletteItemDef;
  /** 1–10; kırpılır (`clampCopyCount`). */
  readonly count: number;
  readonly occupied?: readonly Occupied[];
  /** Piyon için renk; diğer türlerde yok sayılır. */
  readonly color?: string;
  readonly bounds?: PlacerBounds;
  /** Testler için deterministik kimlik üretici. */
  readonly idFactory?: (item: PaletteItemDef, index: number) => string;
}

export interface PlanPaletteSpawnResult {
  readonly defs: ObjectDef[];
  /** Yer bulunamadığı için eklenemeyen kopya sayısı. */
  readonly skipped: number;
}

/**
 * Adet kadar nesne üretir. Her kopya bir öncekiyle çakışmayacak boş noktaya
 * konur; masa dolarsa kalan kopyalar atlanır (kısmi başarı).
 */
export function planPaletteSpawn(input: PlanPaletteSpawnInput): PlanPaletteSpawnResult {
  const count = clampCopyCount(input.count);
  const bounds = input.bounds ?? PALETTE_BOUNDS;
  const foot = footprintForKind(input.item.kind);
  const occupied: Occupied[] = [...(input.occupied ?? [])];
  const makeId = input.idFactory ?? ((item, index) => generateId(`pal-${item.id}-${index}`));
  const defs: ObjectDef[] = [];
  let skipped = 0;

  const y = restHeight(input.item.kind);

  for (let index = 0; index < count; index++) {
    const spot = findFreeSpot(foot, occupied, bounds);
    if (!spot) {
      skipped++;
      continue;
    }
    occupied.push({ x: spot.x, z: spot.z, foot });

    const meta: Record<string, unknown> = {
      ...(input.item.meta ?? {}),
      paletteItem: input.item.id,
      source: 'palette',
    };
    if (input.item.faces !== undefined) meta.sides = input.item.faces;
    if (input.item.kind === 'pawn') {
      meta.color = input.color ?? DEFAULT_PAWN_COLOR;
      meta.label = input.item.nameKey;
    }

    defs.push({
      id: makeId(input.item, index),
      kind: input.item.kind,
      assetRef: '',
      transform: {
        position: { x: spot.x, y, z: spot.z },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      ownerId: null,
      locked: false,
      faceUp: true,
      meta,
    });
  }

  return { defs, skipped };
}
