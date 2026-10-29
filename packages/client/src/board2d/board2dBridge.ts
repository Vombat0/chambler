/**
 * 2D-1 — 2D tahtanın ağ köprüsü.
 *
 * Mevcut altyapıyı AYNEN kullanır:
 *  - `ObjectEventEmitter.emitTransformUpdate` → 20 Hz hareket örneklemesi
 *    (`TRANSFORM_RATE_HZ`), `NetBridge`'in 3D yoluyla aynı sayaç.
 *  - Tel formatı `NetBridge`/sunucu ile birebir uyumludur: JSON
 *    `transformUpdate` {id, transform, velocity, seq, t} (legacy JSON kanalı,
 *    `TRANSFORM_JSON_MESSAGE`) ve `dieResult` {objectId, value}.
 *  - Uzak kareler `TransformInterpolator`'a girer; öteki oyuncunun ekranında
 *    piyonlar akıcı kayar (B3 arayüzüyle aynı 100 ms gecikmeli enterpolasyon).
 *
 * Piyon ve zar, odada gerçek `ObjectDef` nesneleridir (`token` / `die`):
 * sunucu sahiplik/seq/doğrulama kurallarını onlar üzerinden uygular.
 * Zar nesnesi `meta.faces = 12` ile spawn olur (çift zar toplamı 2..12).
 */

import { TRANSFORM_JSON_MESSAGE, type ObjectDef, type Transform } from '@chambler/shared';
import { ObjectEventEmitter } from '../object/ObjectEvents.js';
import { TransformInterpolator } from '../net/TransformInterpolator.js';
import { boardToWorld, worldToBoard } from './boardGeometry.js';

/** Köprünün kullandığı minimum Colyseus Room yüzeyi (testlerde sahte olabilir). */
export interface WireRoom {
  readonly roomId?: string;
  send(type: string, payload?: unknown): void;
  onMessage(type: string, cb: (message: unknown) => void): void;
}

/** Yapısal kontrol: real Colyseus Room da bu kalıba uyar. */
export function asWireRoom(candidate: unknown): WireRoom | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const room = candidate as WireRoom;
  if (typeof room.send !== 'function' || typeof room.onMessage !== 'function') return null;
  return room;
}

export const TOKEN_ID_PREFIX = 'b2d-tok-';
export const DIE_ID_PREFIX = 'b2d-die-';
export const B2D_META = 'board2d' as const;

export function tokenObjectId(playerId: string): string {
  return `${TOKEN_ID_PREFIX}${playerId}`;
}

export function dieObjectId(playerId: string): string {
  return `${DIE_ID_PREFIX}${playerId}`;
}

export function playerIdFromObjectId(objectId: string, prefix: string): string | null {
  return objectId.startsWith(prefix) ? objectId.slice(prefix.length) || null : null;
}

const IDENTITY_ROTATION = { w: 1, x: 0, y: 0, z: 0 } as const;
const UNIT_SCALE = { x: 1, y: 1, z: 1 } as const;

export function tokenDef(playerId: string, name: string, color: string, x: number, y: number): ObjectDef {
  return {
    id: tokenObjectId(playerId),
    kind: 'token',
    assetRef: 'board2d/token',
    transform: {
      position: boardToWorld(x, y),
      rotation: { ...IDENTITY_ROTATION },
      scale: { ...UNIT_SCALE },
    },
    ownerId: playerId,
    locked: false,
    faceUp: true,
    meta: { [B2D_META]: true, role: 'token', playerId, playerColor: color, playerName: name },
  };
}

export function dieDef(playerId: string): ObjectDef {
  return {
    id: dieObjectId(playerId),
    kind: 'die',
    assetRef: 'board2d/dice',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { ...IDENTITY_ROTATION },
      scale: { ...UNIT_SCALE },
    },
    ownerId: playerId,
    locked: false,
    faceUp: true,
    // Çift zar: sunucu `dieFaceCount` meta.faces'i okur → değer 1..12 geçerli.
    meta: { [B2D_META]: true, role: 'die', playerId, faces: 12, dice: 2 },
  };
}

function tokenPlayerId(def: Pick<ObjectDef, 'id' | 'meta'>): string | null {
  const meta = def.meta as { [B2D_META]?: boolean; role?: string; playerId?: unknown } | undefined;
  if (!meta || meta[B2D_META] !== true || meta.role !== 'token') return null;
  if (typeof meta.playerId === 'string' && meta.playerId.length > 0) return meta.playerId;
  return playerIdFromObjectId(def.id, TOKEN_ID_PREFIX);
}

export interface RemoteTokenInfo {
  playerId: string;
  x: number;
  y: number;
}

export interface DieResultInfo {
  playerId: string | null;
  value: number;
}

export interface Board2DBridgeOptions {
  /** Colyseus Room veya null (yerel masa). */
  getRoom: () => unknown;
  selfId: string;
  emitter?: ObjectEventEmitter;
  interpolator?: TransformInterpolator;
  /** Uzaktan piyon görüldü (spawn / resync) — board koordinatlarıyla. */
  onRemoteToken?: (info: RemoteTokenInfo) => void;
  onRemoteTokenGone?: (playerId: string) => void;
  onDieResult?: (info: DieResultInfo) => void;
  /** Enjekte edilebilir saat (test). */
  now?: () => number;
}

export class Board2DBridge {
  readonly emitter: ObjectEventEmitter;
  readonly interpolator: TransformInterpolator;

  private getRoom: () => unknown;
  private selfId: string;
  private readonly now: () => number;
  private onRemoteToken?: (info: RemoteTokenInfo) => void;
  private onRemoteTokenGone?: (playerId: string) => void;
  private onDieResult?: (info: DieResultInfo) => void;

  private wiredRoom: WireRoom | null = null;
  private readonly spawnedIds = new Set<string>();
  private readonly seqByObject = new Map<string, number>();
  private readonly offLocal: Array<() => void> = [];
  /** Son bilinen kendi piyon konumu (duyuru yeniden gönderimi için). */
  private lastSelf: { x: number; y: number } | null = null;

  constructor(options: Board2DBridgeOptions) {
    this.getRoom = options.getRoom;
    this.selfId = options.selfId;
    this.now = options.now ?? (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
    this.emitter = options.emitter ?? new ObjectEventEmitter();
    this.interpolator = options.interpolator ?? new TransformInterpolator();
    this.onRemoteToken = options.onRemoteToken;
    this.onRemoteTokenGone = options.onRemoteTokenGone;
    this.onDieResult = options.onDieResult;
    this.wireLocal();
  }

  setRoomGetter(getRoom: () => unknown): void {
    this.getRoom = getRoom;
  }

  setSelf(playerId: string): void {
    if (playerId === this.selfId) return;
    this.selfId = playerId;
    this.spawnedIds.clear();
  }

  /** Görünüm sonradan bağlanabilir (ReactStrict/curucu sırası için). */
  setHandlers(handlers: {
    onRemoteToken?: (info: RemoteTokenInfo) => void;
    onRemoteTokenGone?: (playerId: string) => void;
    onDieResult?: (info: DieResultInfo) => void;
  }): void {
    if (handlers.onRemoteToken) this.onRemoteToken = handlers.onRemoteToken;
    if (handlers.onRemoteTokenGone) this.onRemoteTokenGone = handlers.onRemoteTokenGone;
    if (handlers.onDieResult) this.onDieResult = handlers.onDieResult;
  }

  get offline(): boolean {
    return asWireRoom(this.getRoom()) === null;
  }

  /* ------------------------------ yerel çıkış ------------------------------ */

  private wireLocal(): void {
    this.offLocal.push(
      this.emitter.on('transformUpdate', (event) => {
        if (event.id !== tokenObjectId(this.selfId)) return;
        this.sendTransformFrame(event.id, event.transform, event.velocity);
      }),
    );
    this.offLocal.push(
      this.emitter.on('dieResult', (event) => {
        const dieId = dieObjectId(this.selfId);
        if (event.id !== dieId) return;
        const room = asWireRoom(this.getRoom());
        if (!room) return;
        // Yeni atış = yeni "kavrama" (claim) epoch'u: sunucunun çakışma
        // penceresine takılmamak için release+claim ile taze token alıyoruz.
        room.send('objectRelease', { objectId: dieId });
        room.send('objectClaim', { objectId: dieId });
        room.send('dieResult', { objectId: dieId, value: event.value });
      }),
    );
  }

  private sendTransformFrame(id: string, transform: Transform, velocity?: { x: number; y: number; z: number }): void {
    const room = asWireRoom(this.getRoom());
    if (!room) return;
    const seq = (this.seqByObject.get(id) ?? 0) + 1;
    this.seqByObject.set(id, seq);
    // t: Sunucu bu damgayı aynen iletir; alıcı taraf enterpolasyon saati
    // Date.now() tabanlıdır (NetBridge ile aynı sözleşme).
    room.send(TRANSFORM_JSON_MESSAGE, {
      id,
      transform,
      velocity,
      seq,
      t: Date.now(),
    });
  }

  /**
   * Piyonu tahta birimi cinsinden taşı (sürükleme). 20 Hz'lik örneklemeyi
   * ObjectEvents yapar; bu metod her karede çağrılabilir.
   */
  reportDrag(x: number, y: number, velocity?: { vx: number; vy: number }): void {
    this.lastSelf = { x, y };
    const position = boardToWorld(x, y);
    this.emitter.emitTransformUpdate(
      tokenObjectId(this.selfId),
      {
        position,
        rotation: { ...IDENTITY_ROTATION },
        scale: { ...UNIT_SCALE },
      },
      velocity ? { x: velocity.vx / 100, y: 0, z: velocity.vy / 100 } : undefined,
      this.now(),
    );
  }

  /** Bırakma / snap sonrası nihai kare: hemen yayınla, kayıtsız kalmasın. */
  reportSettle(x: number, y: number): void {
    this.lastSelf = { x, y };
    const position = boardToWorld(x, y);
    this.emitter.emitTransformUpdate(
      tokenObjectId(this.selfId),
      { position, rotation: { ...IDENTITY_ROTATION }, scale: { ...UNIT_SCALE } },
      { x: 0, y: 0, z: 0 },
      this.now(),
    );
    this.emitter.flush(this.now() + 1000);
  }

  /** Bekleyen kareleri gönder (rAF döngüsünden çağrılır). */
  flush(): void {
    this.emitter.flush(this.now());
  }

  /** Uzak piyonun enterpole konumu (board birimi); veri yoksa null. */
  sampleRemote(playerId: string, nowMs: number): { x: number; y: number } | null {
    const transform = this.interpolator.sample(tokenObjectId(playerId), nowMs);
    if (!transform) return null;
    return worldToBoard(transform.position);
  }

  /* --------------------------- varlık sahipliği (spawn) --------------------- */

  /** Oda değiştiyse mesajları yeniden bağla; kendi piyon + zarını spawn et. */
  syncRoom(): void {
    const room = asWireRoom(this.getRoom());
    if (!room) return;
    if (room !== this.wiredRoom) {
      this.wiredRoom = room;
      this.spawnedIds.clear();
      this.interpolator.resetAll();
      this.wireRemote(room);
    }
    this.ensureSelfAssets();
  }

  private ensureSelfAssets(): void {
    const room = this.wiredRoom;
    if (!room || !this.selfId) return;
    const tokenId = tokenObjectId(this.selfId);
    if (!this.spawnedIds.has(tokenId)) {
      this.spawnedIds.add(tokenId);
      room.send('objectSpawn', { object: tokenDef(this.selfId, this.selfId, '', this.lastSelf?.x ?? 955, this.lastSelf?.y ?? 955) });
    }
    const dieId = dieObjectId(this.selfId);
    if (!this.spawnedIds.has(dieId)) {
      this.spawnedIds.add(dieId);
      room.send('objectSpawn', { object: dieDef(this.selfId) });
    }
  }

  /**
   * Kadro büyüdüğünde (yeni katılan) mevcut konumumuzu bir kez daha duyur:
   * geç katılan oyuncu piyonumuzun yerini state'ten bilemez (transform state
   'te yoktur), bu tek karelik duyuru boşluğu kapatır.
   */
  announceSelf(): void {
    if (!this.lastSelf) return;
    const room = asWireRoom(this.getRoom());
    if (!room) return;
    this.sendTransformFrame(tokenObjectId(this.selfId), {
      position: boardToWorld(this.lastSelf.x, this.lastSelf.y),
      rotation: { ...IDENTITY_ROTATION },
      scale: { ...UNIT_SCALE },
    });
  }

  /* ------------------------------ uzaktan gelen ------------------------------ */

  private wireRemote(room: WireRoom): void {
    room.onMessage('objectSpawn', (message: unknown) => {
      const def = (message as { object?: ObjectDef } | null)?.object;
      if (def) this.applyTokenDef(def);
    });
    room.onMessage('tableResync', (message: unknown) => {
      const objects = (message as { objects?: ObjectDef[] } | null)?.objects;
      if (!Array.isArray(objects)) return;
      for (const def of objects) this.applyTokenDef(def);
    });
    room.onMessage('objectRemove', (message: unknown) => {
      const objectId = (message as { objectId?: unknown } | null)?.objectId;
      if (typeof objectId !== 'string') return;
      const playerId = playerIdFromObjectId(objectId, TOKEN_ID_PREFIX);
      if (!playerId || playerId === this.selfId) return;
      this.interpolator.reset(tokenObjectId(playerId));
      this.onRemoteTokenGone?.(playerId);
    });
    room.onMessage(TRANSFORM_JSON_MESSAGE, (message: unknown) => {
      const frame = message as {
        id?: unknown;
        transform?: Transform;
        velocity?: { x: number; y: number; z: number };
        seq?: unknown;
        t?: unknown;
      } | null;
      if (!frame || typeof frame.id !== 'string') return;
      if (!frame.id.startsWith(TOKEN_ID_PREFIX) || frame.id === tokenObjectId(this.selfId)) return;
      const transform = frame.transform;
      if (!transform || typeof transform !== 'object' || !transform.position || !transform.rotation) return;
      const playerId = frame.id.slice(TOKEN_ID_PREFIX.length);
      this.interpolator.push(frame.id, {
        seq: typeof frame.seq === 'number' ? frame.seq : 0,
        t: typeof frame.t === 'number' ? frame.t : Date.now(),
        pos: transform.position,
        rot: transform.rotation,
        vel: frame.velocity,
      });
      // İlk kare: piyon henüz tanınmıyorsa (spawn mesajını kaçırdıysak) doğsun.
      this.onRemoteToken?.({ playerId, ...worldToBoard(transform.position) });
    });
    room.onMessage('dieResult', (message: unknown) => {
      const parsed = this.parseDie(message);
      if (!parsed) return;
      const raw = message as { objectId?: unknown; playerId?: unknown };
      if (typeof raw.objectId === 'string' && raw.objectId === dieObjectId(this.selfId)) return;
      const playerId =
        typeof raw.playerId === 'string' ? raw.playerId : playerIdFromObjectId(String(raw.objectId ?? ''), DIE_ID_PREFIX);
      this.onDieResult?.({ playerId, value: parsed.value });
    });
  }

  private parseDie(message: unknown): { value: number } | null {
    if (typeof message !== 'object' || message === null) return null;
    const value = (message as { value?: unknown }).value;
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    return { value };
  }

  private applyTokenDef(def: ObjectDef): void {
    const playerId = tokenPlayerId(def);
    if (!playerId || playerId === this.selfId) return;
    this.interpolator.reset(tokenObjectId(playerId));
    this.onRemoteToken?.({ playerId, ...worldToBoard(def.transform.position) });
  }

  /* --------------------------------- zar ------------------------------------ */

  /** Sonucu odaya raporla (sunucu yetkili; sahiplik + faces doğrular). */
  reportDieValue(value: number): void {
    this.emitter.emit('dieResult', { id: dieObjectId(this.selfId), value });
  }

  dispose(): void {
    for (const off of this.offLocal) off();
    this.offLocal.length = 0;
    this.wiredRoom = null;
  }
}
