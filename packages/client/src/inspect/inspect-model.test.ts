import { describe, expect, it } from 'vitest';
import type { ObjectDef } from '@chambler/shared';
import { buildInspectModel, INSPECTABLE_KINDS, isInspectable, metaSummary, type InspectModel } from './inspect-model';

function def(partial: Partial<ObjectDef> = {}): ObjectDef {
  return {
    id: 'obj_1',
    kind: 'card',
    assetRef: '',
    transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {},
    ...partial,
  };
}

describe('inspect-model — kapsam (inspect devre dışı kalanlar)', () => {
  it('desteklenen türler: card board tile token', () => {
    expect(INSPECTABLE_KINDS).toEqual(['card', 'board', 'tile', 'token']);
  });

  it('die/deck/custom inspect açılmaz', () => {
    expect(isInspectable('die')).toBe(false);
    expect(isInspectable('deck')).toBe(false);
    expect(isInspectable('custom')).toBe(false);
  });

  it('desteklenenlerin tümü true döner', () => {
    for (const k of INSPECTABLE_KINDS) expect(isInspectable(k)).toBe(true);
  });
});

describe('inspect-model — alan türetme', () => {
  it('meta.name ve meta.type kimlikten önceliklidir', () => {
    const m = buildInspectModel(def({ meta: { name: 'Kızıl Kule', type: 'Bina Kartı' } }));
    expect(m.name).toBe('Kızıl Kule');
    expect(m.typeLabel).toBe('Bina Kartı');
  });

  it('meta boşsa türe göre varsayılan ad üretilir (boş panel yok)', () => {
    const m = buildInspectModel(def({ kind: 'tile' }));
    expect(m.name).toBe('Karo');
    expect(m.description.length).toBeGreaterThan(0);
  });

  it('assetRef varsa tür etiketine eklenir', () => {
    const m = buildInspectModel(def({ kind: 'token', assetRef: 'generic/kervan' }));
    expect(m.typeLabel).toContain('kervan');
  });

  it('sahiplik: ownerId var/yok iki etiket', () => {
    const owned = buildInspectModel(def({ ownerId: 'player-42' }));
    const free = buildInspectModel(def({ ownerId: null }));
    expect(owned.ownerLabel).toContain('player-42');
    expect(free.ownerLabel).toBe('Serbest');
  });

  it('tile: kenar değerleri ve döndürme değeri okunur', () => {
    const m: InspectModel = buildInspectModel(
      def({ kind: 'tile', meta: { edges: { north: 'yol', east: 'tarla', south: 'tarla', west: 'yol' }, rotation: 90 } }),
    );
    expect(m.edges?.east).toBe('tarla');
    expect(m.edges?.north).toBe('yol');
    expect(m.rotation).toBe(90);
    expect(m.tokenLabel).toBeNull();
  });

  it('tile: rotation verilmezse 0 kalır; bozuk edges verisi null düşer', () => {
    const m = buildInspectModel(def({ kind: 'tile', meta: { edges: { north: 1, east: 2 } } }));
    expect(m.rotation).toBe(0);
    expect(m.edges).toBeNull();
  });

  it('token: label türetimi (meta.label -> #id fallback)', () => {
    const labeled = buildInspectModel(def({ kind: 'token', meta: { label: 'Kervan' } }));
    expect(labeled.tokenLabel).toBe('Kervan');
    const fallback = buildInspectModel(def({ kind: 'token', id: 'tok9' }));
    expect(fallback.tokenLabel).toBe('#tok9');
  });

  it('board: slot listesi parsing (id + x/y)', () => {
    const m = buildInspectModel(
      def({ kind: 'board', meta: { slots: [{ id: 'A1', position: { x: -2.5, y: -1, z: 0 } }, { id: 'B1', position: { x: 0.5, y: -1, z: 0 } }] } }),
    );
    expect(m.slots).toEqual([
      { id: 'A1', x: -2.5, y: -1 },
      { id: 'B1', x: 0.5, y: -1 },
    ]);
  });
});

describe('inspect-model — metaSummary', () => {
  it('basit değerleri key: value olarak birleştirir, nesneleri filtreler', () => {
    const m = buildInspectModel(def({ meta: { count: 3, name: 'Kervan', big: { a: 1 } } }));
    const s = metaSummary(m);
    expect(s).toContain('count: 3');
    expect(s).toContain('name: Kervan');
    expect(s).not.toContain('big');
  });

  it('meta boşsa bilgi döner (panel boş görünmez)', () => {
    const m = buildInspectModel(def({}));
    expect(metaSummary(m)).toBe('meta boş');
  });
});
