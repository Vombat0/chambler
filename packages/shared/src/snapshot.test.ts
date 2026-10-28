import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_SAVES,
  SNAPSHOT_CARD_IDENTITY_KEYS,
  SNAPSHOT_FACE_MAPPING_KEYS,
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_VERSION_UNSUPPORTED,
  getSnapshotSchemaVersion,
  sanitizeObjectForSnapshot,
  snapshotSecretLeak,
  validateTableSnapshot,
  type TableSnapshot,
} from './snapshot.js';
import type { ObjectDef } from './types.js';
import type { DieValueSnapshot, ObjectSnapshotData, PlayerSnapshot } from './snapshot.js';

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
const UNIT = { x: 1, y: 1, z: 1 };

function object(partial: Partial<ObjectDef> & { id: string }): ObjectDef {
  return {
    kind: 'pawn',
    assetRef: 'risk/pawn-red',
    transform: { position: { x: 1, y: 2, z: 3 }, rotation: IDENTITY, scale: UNIT },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {},
    ...partial,
  };
}

function snapshot(partial: Partial<TableSnapshot> = {}): TableSnapshot {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    roomCode: 'ABC23',
    createdAt: 1700000000000,
    savedAt: 1700000005000,
    objects: [
      {
        id: 'o1',
        kind: 'die',
        assetRef: 'risk/die-black',
        transform: { position: { x: 0.5, y: 0, z: -0.5 }, rotation: IDENTITY, scale: UNIT },
        ownerId: null,
        locked: false,
        faceUp: true,
        meta: { faces: 6 },
        netIndex: 0,
      },
    ],
    players: [{ name: 'Alice', color: '#e63946', seat: 0, isHost: true }],
    dieValues: { o1: { value: 5, rolledBy: 'alice-session', rolledAt: 1700000004000 } },
    ...partial,
  };
}

describe('snapshot format', () => {
  it('roundtrips through JSON and validates', () => {
    const original = snapshot();
    const parsed = JSON.parse(JSON.stringify(original)) as unknown;
    expect(validateTableSnapshot(parsed).ok).toBe(true);
    const again = parsed as TableSnapshot;
    expect(again.roomCode).toBe('ABC23');
    expect(again.objects[0]!.meta.faces).toBe(6);
    expect(again.dieValues.o1!.value).toBe(5);
    expect(again.players[0]!.name).toBe('Alice');
  });

  it('accepts a turnState payload as opaque JSON', () => {
    const withTurn = snapshot({ turnState: { turn: 3, order: ['a', 'b'] } });
    expect(validateTableSnapshot(JSON.parse(JSON.stringify(withTurn)))).toEqual({
      ok: true,
      errors: [],
    });
  });

  it('rejects an unknown schemaVersion with SNAPSHOT_VERSION_UNSUPPORTED', () => {
    const future = snapshot({ schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 });
    const result = validateTableSnapshot(JSON.parse(JSON.stringify(future)));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain(SNAPSHOT_VERSION_UNSUPPORTED);
  });

  it('rejects a missing schemaVersion', () => {
    const raw = JSON.parse(JSON.stringify(snapshot())) as Record<string, unknown>;
    delete raw.schemaVersion;
    const result = validateTableSnapshot(raw);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('SNAPSHOT_VERSION_UNSUPPORTED');
  });

  it('getSnapshotSchemaVersion reads the version without full validation', () => {
    expect(getSnapshotSchemaVersion({ schemaVersion: 7 })).toBe(7);
    expect(getSnapshotSchemaVersion({})).toBeNull();
    expect(getSnapshotSchemaVersion('nope')).toBeNull();
    expect(getSnapshotSchemaVersion({ schemaVersion: 'x' })).toBeNull();
  });

  it('rejects non-objects and broken fields', () => {
    expect(validateTableSnapshot(null).ok).toBe(false);
    expect(validateTableSnapshot([]).ok).toBe(false);
    expect(validateTableSnapshot('x').ok).toBe(false);
    expect(validateTableSnapshot(snapshot({ roomCode: '' })).ok).toBe(false);
    expect(validateTableSnapshot(snapshot({ createdAt: 'yesterday' as unknown as number })).ok).toBe(false);
    expect(validateTableSnapshot(snapshot({ objects: 'none' as unknown as ObjectSnapshotData[] })).ok).toBe(false);
    expect(
      validateTableSnapshot(snapshot({ players: [{ name: 1 } as unknown as PlayerSnapshot] })).ok,
    ).toBe(false);
    expect(
      validateTableSnapshot(snapshot({ dieValues: { o1: { value: 'five' } as unknown as DieValueSnapshot } })).ok,
    ).toBe(false);
  });

  it('rejects objects without a valid transform', () => {
    const broken = snapshot();
    broken.objects = [
      { ...broken.objects[0]!, transform: { position: { x: 0, y: 0 }, rotation: IDENTITY, scale: UNIT } as never },
    ];
    expect(validateTableSnapshot(broken).ok).toBe(false);
  });
});

describe('snapshot secret-face rules', () => {
  it('strips the identity of a face-down card and masks its assetRef', () => {
    const card = object({
      id: 'c1',
      kind: 'card',
      assetRef: 'risk/card-infantry',
      faceUp: false,
      meta: { cardId: 'infantry-7', secret: 'face', note: 'visible' },
    });
    const clean = sanitizeObjectForSnapshot(card);
    expect(clean.meta).not.toHaveProperty('cardId');
    expect(clean.meta).not.toHaveProperty('secret');
    expect(clean.meta.note).toBe('visible');
    expect(clean.assetRef).toBe('risk/card-infantry#back');
  });

  it('keeps a face-up card readable but drops face mappings', () => {
    const card = object({
      id: 'c2',
      kind: 'card',
      faceUp: true,
      meta: { cardId: 'cavalry-2', faceMap: { 'cavalry-2': 'front' } },
    });
    const clean = sanitizeObjectForSnapshot(card);
    expect(clean.meta.cardId).toBe('cavalry-2'); // public at the table
    expect(clean.meta).not.toHaveProperty('faceMap');
  });

  it('keeps deck order but never a cardId->face mapping', () => {
    const deck = object({
      id: 'd1',
      kind: 'deck',
      meta: {
        cardIds: ['infantry-1', 'infantry-2', 'cavalry-9'], // deck order / identity list
        faces: { 'infantry-1': 'risk/card-infantry', 'cavalry-9': 'risk/card-cavalry' },
      },
    });
    const clean = sanitizeObjectForSnapshot(deck);
    expect(clean.meta.cardIds).toEqual(['infantry-1', 'infantry-2', 'cavalry-9']);
    expect(clean.meta).not.toHaveProperty('faces');
    for (const key of SNAPSHOT_FACE_MAPPING_KEYS) {
      expect(clean.meta).not.toHaveProperty(key);
    }
  });

  it('snapshotSecretLeak finds violations and passes clean snapshots', () => {
    const clean = snapshot({
      objects: [sanitizeObjectForSnapshot(object({ id: 'c1', kind: 'card', faceUp: false, meta: { cardId: 'x' } }))],
    });
    expect(snapshotSecretLeak(clean)).toBeNull();

    const leakyFace = snapshot({
      objects: [object({ id: 'd1', kind: 'deck', meta: { faceMap: { a: 'b' } } })],
    });
    expect(snapshotSecretLeak(leakyFace)).toContain('d1');

    const leakyCard = snapshot({
      objects: [object({ id: 'c9', kind: 'card', faceUp: false, meta: { cardId: 'secret-1' } })],
    });
    expect(snapshotSecretLeak(leakyCard)).toContain('c9');

    const unmasked = snapshot({
      objects: [
        sanitizeObjectForSnapshot(object({ id: 'c3', kind: 'card', faceUp: false, meta: {} })),
      ],
    });
    unmasked.objects[0]!.assetRef = 'risk/card-infantry';
    expect(snapshotSecretLeak(unmasked)).toContain('c3');
  });

  it('exposes the documented constants', () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(DEFAULT_MAX_SAVES).toBe(50);
    expect(SNAPSHOT_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(SNAPSHOT_CARD_IDENTITY_KEYS.length).toBeGreaterThan(0);
  });
});
