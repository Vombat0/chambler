import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SNAPSHOT_SCHEMA_VERSION,
  sanitizeObjectForSnapshot,
  type ObjectDef,
  type TableSnapshot,
} from '@chambler/shared';
import { SnapshotStore, getSnapshotStore, configureSnapshotStore } from './SnapshotStore.js';

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
const UNIT = { x: 1, y: 1, z: 1 };

function makeSnapshot(roomCode: string, extra: Partial<TableSnapshot> = {}): TableSnapshot {
  const card: ObjectDef = {
    id: 'c1',
    kind: 'card',
    assetRef: 'risk/card-infantry',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY, scale: UNIT },
    ownerId: null,
    locked: false,
    faceUp: false,
    meta: { cardId: 'infantry-7' },
  };
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    roomCode,
    createdAt: 1700000000000,
    savedAt: Date.now(),
    objects: [sanitizeObjectForSnapshot(card)],
    players: [{ name: 'Alice', color: '#e63946', seat: 0, isHost: true }],
    dieValues: {},
    ...extra,
  };
}

let dir: string;
let store: SnapshotStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chambler-saves-'));
  store = new SnapshotStore({ dir, maxSaves: 3, maxBytes: 4096 });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SnapshotStore save/load', () => {
  it('roundtrips a snapshot through disk', () => {
    const result = store.save(makeSnapshot('ABC23'));
    expect(result.ok).toBe(true);
    const loaded = store.load('ABC23');
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.snapshot.roomCode).toBe('ABC23');
      expect(loaded.snapshot.objects[0]!.id).toBe('c1');
      expect(loaded.snapshot.players[0]!.name).toBe('Alice');
    }
  });

  it('writes atomically: no .tmp file survives a save', () => {
    store.save(makeSnapshot('DEF45'));
    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'DEF45.json'))).toBe(true);
  });

  it('overwrites a stale .tmp from a crashed write', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'GHJ67.json.tmp'), 'half-written');
    store.save(makeSnapshot('GHJ67'));
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(store.load('GHJ67').status).toBe('ok');
  });

  it('overwrites the previous save of the same room', () => {
    store.save(makeSnapshot('JKM78', { savedAt: 1 }));
    store.save(makeSnapshot('JKM78', { savedAt: 2, objects: [] }));
    const loaded = store.load('JKM78');
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.snapshot.savedAt).toBe(2);
      expect(loaded.snapshot.objects).toHaveLength(0);
    }
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('JKM78'))).toHaveLength(1);
  });

  it('rejects a snapshot above the size limit without writing', () => {
    const huge = makeSnapshot('MNP89', {
      objects: [
        {
          id: 'big',
          kind: 'custom',
          assetRef: '',
          transform: { position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY, scale: UNIT },
          ownerId: null,
          locked: false,
          faceUp: true,
          meta: { blob: 'x'.repeat(8192) },
        },
      ],
    });
    const result = store.save(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOO_LARGE');
      expect(result.message).toContain('limit');
    }
    expect(fs.existsSync(path.join(dir, 'MNP89.json'))).toBe(false);
  });

  it('rejects an invalid snapshot without writing', () => {
    const broken = makeSnapshot('QRS92', { objects: 'no' as unknown as TableSnapshot['objects'] });
    const result = store.save(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID');
    expect(fs.existsSync(path.join(dir, 'QRS92.json'))).toBe(false);
  });

  it('refuses to write a snapshot that leaks a card face', () => {
    const leaky = makeSnapshot('TUV34');
    leaky.objects[0]!.meta.cardId = 'secret-identity'; // face-down card identity
    const result = store.save(leaky);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SECRET_LEAK');
    expect(fs.existsSync(path.join(dir, 'TUV34.json'))).toBe(false);
  });

  it('rejects an invalid room code', () => {
    const result = store.save(makeSnapshot('not-a-code'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CODE_INVALID');
  });
});

describe('SnapshotStore corruption handling', () => {
  it('quarantines an unparsable file and reports corrupt', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'WXY35.json'), '{not json');
    const loaded = store.load('WXY35');
    expect(loaded.status).toBe('corrupt');
    if (loaded.status === 'corrupt') {
      expect(loaded.quarantined).toContain('WXY35.json.corrupt');
    }
    expect(fs.existsSync(path.join(dir, 'WXY35.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'WXY35.json.corrupt'))).toBe(true);
    // The code is usable again: a fresh save lands normally.
    expect(store.save(makeSnapshot('WXY35')).ok).toBe(true);
  });

  it('quarantines structurally invalid JSON with a known version', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ZA298.json'), JSON.stringify({ schemaVersion: 1, objects: 'no' }));
    expect(store.load('ZA298').status).toBe('corrupt');
    expect(fs.existsSync(path.join(dir, 'ZA298.json.corrupt'))).toBe(true);
  });

  it('reports an unsupported schema version without quarantining', () => {
    fs.mkdirSync(dir, { recursive: true });
    const future = makeSnapshot('BCD46');
    future.schemaVersion = 99;
    fs.writeFileSync(path.join(dir, 'BCD46.json'), JSON.stringify(future));
    const loaded = store.load('BCD46');
    expect(loaded.status).toBe('unsupported');
    if (loaded.status === 'unsupported') expect(loaded.foundVersion).toBe(99);
    // Not destroyed: a future server may still read it.
    expect(fs.existsSync(path.join(dir, 'BCD46.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'BCD46.json.corrupt'))).toBe(false);
  });

  it('missing snapshots report missing', () => {
    expect(store.load('ZZZZZ').status).toBe('missing');
  });
});

describe('SnapshotStore housekeeping', () => {
  it('keeps only MAX_SAVES snapshots, deleting the oldest', () => {
    const codes = ['AAA2A', 'BBB2B', 'CCC2C', 'DDD2D', 'EEE2E'];
    codes.forEach((code, index) => {
      store.save(makeSnapshot(code, { savedAt: 1000 + index }));
    });
    const remaining = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    expect(remaining).toEqual(['CCC2C.json', 'DDD2D.json', 'EEE2E.json']);
  });

  it('lists saves newest first with metadata', () => {
    store.save(makeSnapshot('FFF2F', { savedAt: 100 }));
    store.save(makeSnapshot('GGG2G', { savedAt: 300 }));
    store.save(makeSnapshot('HHH2H', { savedAt: 200 }));
    const list = store.list();
    expect(list.map((s) => s.roomCode)).toEqual(['GGG2G', 'HHH2H', 'FFF2F']);
    expect(list[0]!.objects).toBe(1);
    expect(list[0]!.bytes).toBeGreaterThan(0);
  });

  it('deletes a save and reports whether it existed', () => {
    store.save(makeSnapshot('JJJ2J'));
    expect(store.delete('JJJ2J')).toBe(true);
    expect(store.delete('JJJ2J')).toBe(false);
    expect(store.load('JJJ2J').status).toBe('missing');
  });

  it('clears leftover .tmp files', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'KKK2K.json.tmp'), 'junk');
    const removed = store.clearTmp();
    expect(removed).toEqual(['KKK2K.json.tmp']);
  });
});

describe('SnapshotStore default store', () => {
  it('getSnapshotStore returns the configured instance', () => {
    const previous = getSnapshotStore();
    configureSnapshotStore(store);
    expect(getSnapshotStore()).toBe(store);
    configureSnapshotStore(previous);
  });
});
