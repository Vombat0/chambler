/**
 * V2 — Görsel nesne fabrikası.
 *
 * Her nesne türü kendi görsel diline sahiptir:
 *   - board: gerçek `board.png` üst kaplaması + ceviz yanlar
 *   - die:   6 yüzlü, noktalı (pip) prosedürel zar; yüz değerleri
 *            `DieReader` normalleriyle birebir hizalı
 *   - pawn:  klasik torna piyonu (LatheGeometry) + oyuncu rengi
 *   - card / deck / tile: paket PNG dokuları (ön/arka yüz)
 *   - token: para/bilet plakası, üst yüzde değer dokusu
 *
 * Dokular `textureLoader` üzerinden önbelleklenir; DOM olmayan test
 * ortamında otomatik olarak renkli materyale düşülür.
 */

import * as THREE from 'three';
import type { ObjectDef, Transform } from '@chambler/shared';
import { cloneTransform, IDENTITY_TRANSFORM } from '@chambler/shared';
import { specFor, halfExtents, type ObjectSpec } from './ObjectSpec.js';
import {
  getCanvasTexture,
  getCardFaceTexture,
  getMoneyFaceTexture,
  getPackTexture,
  getParchmentBoardTexture,
  getPropertyTycoonBoardTexture,
  getTileFaceTexture,
  getWoodTexture,
} from './textureLoader.js';
import { pawnGeometry } from './pawnGeometry.js';
import type { CreateBodyOptions, ShapeDesc } from '../sim/PhysicsWorld.js';

/** Yüz indeksleri (BoxGeometry sırası): +X, -X, +Y, -Y, +Z, -Z. */
const FACE_PX = 0;
const FACE_NX = 1;
const FACE_PY = 2;
const FACE_NY = 3;
const FACE_PZ = 4;
const FACE_NZ = 5;

/**
 * `DieReader` yüz değerleri: +Y=1, -Y=6, +X=2, -X=5, +Z=3, -Z=4.
 * BoxGeometry materyal dizisi bu sırayla eşlenir; böylece zar durduğunda
 * üstte görünen nokta sayısı ile fizik okuyucusu aynı sonucu verir.
 */
export const DIE_FACE_VALUES = [2, 5, 1, 6, 3, 4] as const;

/** Ceviz/mukavva yan yüz rengi. */
const WOOD = { color: '#2a1c12', roughness: 0.6, metalness: 0.02 } as const;
/** Kart kenarı (kağıt) rengi. */
const PAPER = { color: '#f6f0e2', roughness: 0.75, metalness: 0 } as const;

export function createMesh(def: ObjectDef): THREE.Mesh {
  const spec = specFor(def);
  const mesh = buildMesh(def, spec);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.objectId = def.id;
  mesh.name = `object-${def.kind}`;
  applyTransform(mesh, def.transform);
  if (!def.faceUp && (def.kind === 'card' || def.kind === 'tile')) {
    mesh.rotation.x += Math.PI; // yüz aşağı: kart arkası görünür
  }
  return mesh;
}

function buildMesh(def: ObjectDef, spec: ObjectSpec): THREE.Mesh {
  switch (def.kind) {
    case 'board':
      return boardMesh(def, spec);
    case 'die':
      return dieMesh(spec);
    case 'pawn':
      return pawnMesh(def, spec);
    case 'card':
      return cardMesh(def, spec);
    case 'deck':
      return deckMesh(def, spec);
    case 'tile':
      return tileMesh(def, spec);
    case 'token':
      return tokenMesh(def, spec);
    default:
      return plainBox(spec);
  }
}

/* ------------------------------------------------------------------ */
/* Tahta                                                               */
/* ------------------------------------------------------------------ */

function boardMesh(def: ObjectDef, spec: ObjectSpec): THREE.Mesh {
  const geo = new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z);
  const top = new THREE.MeshStandardMaterial({
    color: '#c9b48a',
    roughness: 0.55,
    metalness: 0.02,
  });

  const packId = packOf(def);
  const isTycoon = packId === 'property-tycoon' || def.assetRef === 'board-plate';
  // Mülk Tycoon: 40 hücreli, isim+fiyat yazılı prosedürel yüzey.
  const tycoon = isTycoon ? getPropertyTycoonBoardTexture() : null;
  // Diğer paketler: paket tahta görseli (board.png 1440² tuvalin sol-üst
  // 720² bölgesini kaplar; kırpma UV ile yapılır).
  const texture =
    tycoon ??
    getPackTexture(def.assetRef || 'board-plate', {
      packId,
      repeat: { x: 0.5, y: 0.5 },
      offset: { x: 0, y: 0.5 },
    });
  const fallback = texture ? null : getParchmentBoardTexture();
  if (texture) {
    top.map = texture;
    top.color.set('#ffffff');
    top.needsUpdate = true;
  } else if (fallback) {
    top.map = fallback;
    top.color.set('#ffffff');
  }
  const side = woodMaterial();
  const materials: THREE.Material[] = [];
  materials[FACE_PX] = side;
  materials[FACE_NX] = side;
  materials[FACE_PY] = top;
  materials[FACE_NY] = side;
  materials[FACE_PZ] = side;
  materials[FACE_NZ] = side;
  return new THREE.Mesh(geo, materials);
}

/** Ceviz/mukavva yan yüzeyi: prosedürel damar dokusu + mat cila. */
function woodMaterial(): THREE.MeshStandardMaterial {
  const texture = getWoodTexture();
  if (!texture) {
    return new THREE.MeshStandardMaterial({ ...WOOD });
  }
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: '#c8b39a',
    roughness: WOOD.roughness,
    metalness: WOOD.metalness,
  });
}

/* ------------------------------------------------------------------ */
/* Zar: 6 yüzlü, noktalı                                                 */
/* ------------------------------------------------------------------ */

function dieMesh(spec: ObjectSpec): THREE.Mesh {
  const geo = new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z);
  const materials = DIE_FACE_VALUES.map((value) => dieFaceMaterial(value));
  return new THREE.Mesh(geo, materials);
}

function dieFaceMaterial(value: number): THREE.Material {
  const texture = getCanvasTexture(`die-face-${value}`, 256, (ctx, size) =>
    drawDieFace(ctx, size, value),
  );
  if (!texture) {
    return new THREE.MeshStandardMaterial({ color: '#f4efe4', roughness: 0.32, metalness: 0.02 });
  }
  return new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.3,
    metalness: 0.02,
  });
}

/** 3 × 3 ızgarada standart pip yerleşimleri (kolon, satır). */
const PIP_LAYOUT: Readonly<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 1],
    [0, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
};

function drawDieFace(ctx: CanvasRenderingContext2D, size: number, value: number): void {
  // Fildişi gövde + yumuşak kenar gölgesi (cilalı zar).
  const gradient = ctx.createRadialGradient(
    size * 0.35,
    size * 0.3,
    size * 0.05,
    size * 0.5,
    size * 0.5,
    size * 0.78,
  );
  gradient.addColorStop(0, '#fffdf7');
  gradient.addColorStop(0.7, '#f4ecdc');
  gradient.addColorStop(1, '#ded2ba');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(120, 100, 70, 0.35)';
  ctx.lineWidth = size * 0.035;
  ctx.strokeRect(size * 0.02, size * 0.02, size * 0.96, size * 0.96);

  const pips = PIP_LAYOUT[value] ?? PIP_LAYOUT[1]!;
  const cell = size / 3;
  const radius = size * 0.095;
  for (const [col, row] of pips) {
    const cx = cell * (col + 0.5);
    const cy = cell * (row + 0.5);
    // Çukur görünümü: dış halka gölge + iç dolgu.
    ctx.beginPath();
    ctx.arc(cx, cy + size * 0.008, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#1b1b1b';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - radius * 0.18, cy - radius * 0.22, radius * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(90, 70, 70, 0.35)';
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ */
/* Piyon                                                               */
/* ------------------------------------------------------------------ */

function pawnMesh(def: ObjectDef, spec: ObjectSpec): THREE.Mesh {
  const geo = pawnGeometry(spec.size.y);
  const color = typeof def.meta?.color === 'string' ? def.meta.color : spec.color;
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.05,
  });
  return new THREE.Mesh(geo, mat);
}

/* ------------------------------------------------------------------ */
/* Kart / deste / kutu / para                                          */
/* ------------------------------------------------------------------ */

function cardMesh(def: ObjectDef, spec: ObjectSpec): THREE.Mesh {
  const packId = packOf(def);
  const front = cardFaceMaterial(def);
  const backRef = typeof def.meta?.deckId === 'string'
    ? `card-back-${String(def.meta.deckId)}`
    : 'card-back-community';
  const back = textureMaterial(backRef, packId, { ...PAPER });
  const edge = new THREE.MeshStandardMaterial(PAPER);
  return new THREE.Mesh(
    new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z),
    faceMaterials({ top: front, bottom: back, sides: edge, z: edge }),
  );
}

/**
 * Kart ön yüzü: paket görseli varsa o, yoksa meta bilgisinden prosedürel
 * kart (başlık şeridi, açıklama, fiyat rozeti).
 */
function cardFaceMaterial(def: ObjectDef): THREE.MeshStandardMaterial {
  const packId = packOf(def);
  const texture = def.assetRef ? getPackTexture(def.assetRef, { packId }) : null;
  if (texture) {
    return new THREE.MeshStandardMaterial({
      map: texture,
      color: '#ffffff',
      roughness: 0.5,
      metalness: 0,
    });
  }
  const title = typeof def.meta?.name === 'string' ? def.meta.name : 'Kart';
  const groupColor = typeof def.meta?.color === 'string' ? def.meta.color : '#5b6b7f';
  const type = typeof def.meta?.type === 'string' ? def.meta.type : 'Oyun Kartı';
  const description = typeof def.meta?.description === 'string' ? def.meta.description : '';
  const groupId = typeof def.meta?.groupId === 'string' ? def.meta.groupId : '';
  const price = typeof def.meta?.price === 'number' ? `${def.meta.price} CHB` : undefined;
  const painted = getCardFaceTexture(def.assetRef || `${groupId}-${title}`, {
    title,
    color: groupColor,
    eyebrow: groupId ? `${type} · ${groupId}` : type,
    body: description ? [description] : [],
    ...(price ? { badge: price } : {}),
  });
  if (!painted) {
    return new THREE.MeshStandardMaterial({ ...PAPER });
  }
  return new THREE.MeshStandardMaterial({ map: painted, roughness: 0.5, metalness: 0 });
}

function deckMesh(def: ObjectDef, spec: ObjectSpec): THREE.Mesh {
  const packId = packOf(def);
  const back = textureMaterial(def.assetRef || 'card-back-community', packId, { ...PAPER });
  const edge = new THREE.MeshStandardMaterial({ color: '#e8e0cd', roughness: 0.7 });
  return new THREE.Mesh(
    new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z),
    faceMaterials({ top: back, bottom: edge, sides: edge, z: edge }),
  );
}

function tileMesh(def: ObjectDef, spec: ObjectSpec): THREE.Mesh {
  const packId = packOf(def);
  const cellType = typeof def.meta?.cellType === 'string' ? def.meta.cellType : '';
  const faceRef = def.assetRef || (cellType ? `tile-${cellType}` : '');
  const texture = faceRef ? getPackTexture(faceRef, { packId }) : null;
  const fallbackColor = typeof def.meta?.color === 'string' ? def.meta.color : '#8b7a58';
  const painted = texture
    ? null
    : getTileFaceTexture(faceRef || cellType || 'tile', tileLabel(def, cellType), fallbackColor);
  const face = waterMaterial(texture, painted, spec.color);
  const edge = new THREE.MeshStandardMaterial({ color: '#d9c7a0', roughness: 0.7 });
  return new THREE.Mesh(
    new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z),
    faceMaterials({ top: face, bottom: edge, sides: edge, z: edge }),
  );
}

function tileLabel(def: ObjectDef, cellType: string): string {
  if (typeof def.meta?.name === 'string') return def.meta.name;
  const names: Record<string, string> = {
    chance: 'Şans',
    community: 'Toplum Sandığı',
    property: 'Mülk',
    tax: 'Vergi',
    start: 'Başlangıç',
    jail: 'Hapishane',
    'go-to-jail': 'Hapse Git',
    'free-parking': 'Ücretsiz Park',
    transport: 'Ulaşım',
    energy: 'Enerji',
  };
  return names[cellType] ?? (cellType || 'Kutu');
}

function waterMaterial(
  texture: THREE.Texture | null,
  painted: THREE.Texture | null,
  fallbackColor: string,
): THREE.MeshStandardMaterial {
  const map = texture ?? painted;
  if (!map) {
    return new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 0.6 });
  }
  return new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.02 });
}

function tokenMesh(def: ObjectDef, spec: ObjectSpec): THREE.Mesh {
  const packId = packOf(def);
  const texture = def.assetRef ? getPackTexture(def.assetRef, { packId }) : null;
  const fallbackColor = typeof def.meta?.color === 'string' ? def.meta.color : '#b58a2b';
  const label =
    typeof def.meta?.label === 'string'
      ? def.meta.label
      : typeof def.meta?.denomination === 'number'
        ? String(def.meta.denomination)
        : '';
  const painted = texture ? null : getMoneyFaceTexture(def.assetRef || label || 'token', label, fallbackColor);
  const face = waterMaterial(texture, painted, spec.color);
  const edge = new THREE.MeshStandardMaterial({ color: '#cbbf9a', roughness: 0.6, metalness: 0.1 });
  return new THREE.Mesh(
    new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z),
    faceMaterials({ top: face, bottom: edge, sides: edge, z: edge }),
  );
}

function plainBox(spec: ObjectSpec): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(spec.size.x, spec.size.y, spec.size.z),
    new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.55, metalness: 0.05 }),
  );
}

interface FaceMaterialSet {
  readonly top: THREE.Material;
  readonly bottom: THREE.Material;
  readonly sides: THREE.Material;
  /** ±Z yüzleri (kenar dokusu). */
  readonly z: THREE.Material;
}

function faceMaterials(set: FaceMaterialSet): THREE.Material[] {
  const materials: THREE.Material[] = [];
  materials[FACE_PX] = set.sides;
  materials[FACE_NX] = set.sides;
  materials[FACE_PY] = set.top;
  materials[FACE_NY] = set.bottom;
  materials[FACE_PZ] = set.z;
  materials[FACE_NZ] = set.z;
  return materials;
}

interface FallbackColor {
  readonly color: string;
  readonly roughness: number;
  readonly metalness?: number;
}

function textureMaterial(
  assetRef: string,
  packId: string | undefined,
  fallback: FallbackColor,
): THREE.MeshStandardMaterial {
  const texture = assetRef ? getPackTexture(assetRef, { packId }) : null;
  if (!texture) {
    return new THREE.MeshStandardMaterial({ ...fallback, metalness: fallback.metalness ?? 0.02 });
  }
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: '#ffffff',
    roughness: fallback.roughness,
    metalness: fallback.metalness ?? 0.02,
  });
}

function packOf(def: ObjectDef): string | undefined {
  return typeof def.meta?.sourcePack === 'string' ? def.meta.sourcePack : undefined;
}

/* ------------------------------------------------------------------ */
/* Dönüşüm / fizik                                                     */
/* ------------------------------------------------------------------ */

function applyTransform(mesh: THREE.Object3D, t: Transform): void {
  mesh.position.set(t.position.x, t.position.y, t.position.z);
  mesh.quaternion.set(t.rotation.x, t.rotation.y, t.rotation.z, t.rotation.w);
  mesh.scale.set(t.scale.x, t.scale.y, t.scale.z);
}

export function createBodyOptions(def: ObjectDef, transform?: Transform): CreateBodyOptions {
  const spec = specFor(def);
  const t = transform ? cloneTransform(transform) : cloneTransform(def.transform);
  const shape: ShapeDesc =
    spec.shape === 'sphere'
      ? { kind: 'sphere', radius: spec.radius ?? 0.1 }
      : { kind: 'box', halfExtents: halfExtents(spec) };
  const opts: CreateBodyOptions = {
    type: def.locked ? 'fixed' : 'dynamic',
    shape,
    transform: t,
    mass: spec.mass > 0 ? spec.mass : undefined,
    canSleep: true,
    linearDamping: 0.1,
    angularDamping: 0.15,
  };
  return opts;
}

export { IDENTITY_TRANSFORM };
