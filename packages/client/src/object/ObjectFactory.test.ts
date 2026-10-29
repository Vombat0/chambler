import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ObjectDef } from '@chambler/shared';
import { createMesh, DIE_FACE_VALUES } from './ObjectFactory.js';
import { readDieFace, quaternionForTopFace } from './DieReader.js';

function def(kind: ObjectDef['kind'], patch: Partial<ObjectDef> = {}): ObjectDef {
  return {
    id: 'o1',
    kind,
    assetRef: '',
    transform: {
      position: { x: 0, y: 0.5, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {},
    ...patch,
  };
}

describe('ObjectFactory görsel eşleme (V2)', () => {
  it('zar 6 materyalli küp üretir (her yüz ayrı)', () => {
    const mesh = createMesh(def('die'));
    expect(Array.isArray(mesh.material)).toBe(true);
    expect((mesh.material as THREE.Material[]).length).toBe(6);
  });

  it('görsel yüz değerleri BoxGeometry sırası ile DieReader normallerine uyar', () => {
    // BoxGeometry materyal sırası: +X, -X, +Y, -Y, +Z, -Z
    const normals: Array<[number, number, number]> = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    normals.forEach((normal, index) => {
      const value = DIE_FACE_VALUES[index]!;
      // Bu normal dünya yukarısına döndüğünde DieReader aynı değeri okumalı.
      const axis = new THREE.Vector3(normal[0], normal[1], normal[2]);
      const quat = new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0));
      expect(readDieFace({ w: quat.w, x: quat.x, y: quat.y, z: quat.z })).toBe(value);
      expect(readDieFace(quaternionForTopFace(value))).toBe(value);
    });
  });

  it('karşılıklı yüzlerin toplamı 7', () => {
    expect(DIE_FACE_VALUES[0]! + DIE_FACE_VALUES[1]!).toBe(7);
    expect(DIE_FACE_VALUES[2]! + DIE_FACE_VALUES[3]!).toBe(7);
    expect(DIE_FACE_VALUES[4]! + DIE_FACE_VALUES[5]!).toBe(7);
  });

  it('piyon küp değil, torna profili (Lathe) mesh üretir', () => {
    const mesh = createMesh(def('pawn', { meta: { color: '#C0392B' } }));
    expect(mesh.geometry.type).toBe('LatheGeometry');
    const pos = mesh.geometry.attributes.position!;
    // Taban -y, baş +y: profil yüksekliği piyon yüksekliğine eşit.
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    expect(maxY - minY).toBeCloseTo(0.6, 3);
  });

  it('tahta çoklu materyal: üst yüz ayrı, yanlar ahşap', () => {
    const mesh = createMesh(def('board', { assetRef: 'board-plate', meta: { sourcePack: 'property-tycoon' } }));
    const materials = mesh.material as THREE.Material[];
    expect(materials).toHaveLength(6);
    expect(materials[2]).not.toBe(materials[0]);
    const side = materials[0] as THREE.MeshStandardMaterial;
    expect(side).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(side.roughness).toBeCloseTo(0.6);
  });
});
