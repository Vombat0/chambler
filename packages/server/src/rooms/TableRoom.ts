/**
 * TableRoom — lobby + object sync (B1/B2).
 */
import { ErrorCode, Room, ServerError, logger, matchMaker } from 'colyseus';
import type { Client } from 'colyseus';
import type { StateChannelMessage } from '@chambler/shared';
import {
  TRANSFORM_RATE_HZ,
  type ObjectDef,
  type Transform,
  type TransformChannelMessage,
} from '@chambler/shared';
import { loadConfig, type ServerConfig } from '../config.js';
import { ChatRateLimiter, validateChatText } from '../lobby/chat.js';
import { uniquePlayerName, validatePlayerName } from '../lobby/names.js';
import { generateUniqueRoomCode } from '../lobby/roomCode.js';
import {
  MAX_SEATS,
  firstFreeColor,
  firstFreeSeat,
  isValidSeat,
  normalizePlayerColor,
} from '../lobby/seats.js';
import { describeMessageType, readField } from '../lobby/validation.js';
import { PlayerState, TableState, toPlayerInfo } from './TableState.js';
import { ObjectState, ownerIdOrNull, ownerIdToSchema } from './ObjectState.js';
import { filterHandForClient } from '../lobby/secrets.js';

export const TABLE_ROOM_NAME = 'table';

export interface TableAuthData {
  name: string;
}

export interface TableRoomMetadata {
  code: string;
  createdAt: number;
  maxPlayers: number;
  hostId: string;
}

const codesInCreation = new Set<string>();

let defaultServerConfig: ServerConfig | null = null;

export function configureTableRoom(config: ServerConfig): void {
  defaultServerConfig = config;
}

interface ObjectOwnership {
  ownerId: string | null;
  claimToken: string | null;
  seq: number;
  lastUpdate: number;
  lastBroadcast: number;
}

const INACTIVITY_RELEASE_MS = 30_000;
const BANDWIDTH_BUDGET_BYTES_PER_SEC = 200_000;
const TRANSFORM_INTERVAL_MS = 1000 / TRANSFORM_RATE_HZ;

export class TableRoom extends Room<TableState, TableRoomMetadata, unknown, TableAuthData> {
  private config: ServerConfig = loadConfig();
  private readonly chatLimiter = new ChatRateLimiter();
  private readonly startedAt = Date.now();
  private readonly ownership = new Map<string, ObjectOwnership>();
  private readonly objectLastSeq = new Map<string, number>();
  private bandwidthWindowStart = Date.now();
  private bandwidthBytes = 0;
  private inactivityTimer: NodeJS.Timeout | null = null;

  override async onCreate(): Promise<void> {
    this.config = defaultServerConfig ?? loadConfig();
    this.maxClients = this.config.maxPlayers;
    this.autoDispose = true;

    const code = await this.claimRoomCode();
    try {
      this.roomId = code;
      const state = new TableState();
      state.code = code;
      state.maxPlayers = this.maxClients;
      state.createdAt = Date.now();
      this.setState(state);
    } catch (error) {
      codesInCreation.delete(code);
      throw error;
    }

    void this.setMetadata({ code, createdAt: this.startedAt, maxPlayers: this.maxClients, hostId: '' });

    this.registerMessageHandlers();
    this.inactivityTimer = setInterval(() => this.sweepInactivity(), 5000);
    logger.info(`[table:${code}] created (max ${this.maxClients} players)`);
  }

  private async claimRoomCode(): Promise<string> {
    const existing = new Set<string>();
    try {
      for (const room of await matchMaker.query({ name: TABLE_ROOM_NAME })) {
        existing.add(room.roomId);
      }
    } catch {
      // ignore
    }
    const code = generateUniqueRoomCode(
      (candidate) => existing.has(candidate) || codesInCreation.has(candidate),
    );
    codesInCreation.add(code);
    return code;
  }

  override onAuth(_client: Client, options: unknown): TableAuthData {
    const validation = validatePlayerName(readField(options, 'name'));
    if (!validation.ok) {
      throw new ServerError(ErrorCode.INVALID_PAYLOAD, `${validation.code}: ${validation.message}`);
    }
    const takenNames = [...this.state.players.values()].map((player) => player.name);
    return { name: uniquePlayerName(validation.name, takenNames) };
  }

  override onJoin(client: Client, _options?: unknown, auth?: TableAuthData): void {
    const players = [...this.state.players.values()];
    const seat = firstFreeSeat(players.map((player) => player.seat), this.maxClients);
    const color = firstFreeColor(players.map((player) => player.color));
    if (seat === null || color === null) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, 'ROOM_FULL: no seat or colour left.');
    }

    const isFirstPlayer = this.state.players.size === 0;
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = auth?.name ?? uniquePlayerName('Player', players.map((entry) => entry.name));
    player.color = color;
    player.seat = seat;
    player.isHost = isFirstPlayer;
    player.connected = true;
    player.joinedAt = Date.now();
    this.state.players.set(client.sessionId, player);

    if (isFirstPlayer) {
      this.state.hostId = player.id;
      void this.setMetadata({ hostId: player.id });
    }

    this.broadcast('join', { type: 'join', player: toPlayerInfo(player) } satisfies StateChannelMessage, { except: client });
    logger.info(`[table:${this.roomId}] ${player.name} joined (seat ${player.seat})`);
  }

  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    this.chatLimiter.reset(client.sessionId);

    if (!consented && this.config.reconnectionSeconds > 0 && this.hasOtherPlayers(client.sessionId)) {
      player.connected = false;
      const oldId = client.sessionId;
      try {
        const reconnected = await this.allowReconnection(client, this.config.reconnectionSeconds);
        const current = this.state.players.get(oldId);
        if (current) {
          if (reconnected.sessionId !== current.id) {
            this.state.players.delete(current.id);
            current.id = reconnected.sessionId;
            this.state.players.set(reconnected.sessionId, current);
            if (this.state.hostId === oldId) {
              this.state.hostId = current.id;
            }
            this.transferOwnership(oldId, reconnected.sessionId);
          }
          current.connected = true;
        }
        return;
      } catch {
        // fall through
      }
    }

    this.removePlayer(client.sessionId);
  }

  override onDispose(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    codesInCreation.delete(this.state.code);
    this.chatLimiter.clear();
    logger.info(`[table:${this.roomId}] disposed`);
  }

  private registerMessageHandlers(): void {
    this.onMessage('chat', (client, payload) => this.handleChat(client, payload));
    this.onMessage('seat', (client, payload) => this.handleSeatChange(client, payload));
    this.onMessage('color', (client, payload) => this.handleColorChange(client, payload));

    this.onMessage('objectSpawn', (client, payload) => this.handleObjectSpawn(client, payload));
    this.onMessage('objectRemove', (client, payload) => this.handleObjectRemove(client, payload));
    this.onMessage('objectClaim', (client, payload) => this.handleObjectClaim(client, payload));
    this.onMessage('objectRelease', (client, payload) => this.handleObjectRelease(client, payload));
    this.onMessage('objectLock', (client, payload) => this.handleObjectLock(client, payload));
    this.onMessage('flip', (client, payload) => this.handleFlip(client, payload));
    this.onMessage('deckShuffle', (client, payload) => this.handleDeckShuffle(client, payload));
    this.onMessage('transformUpdate', (client, payload) => this.handleTransformUpdate(client, payload));

    this.onMessage('*', (client, type) => {
      logger.warn(`[table:${this.roomId}] ignoring unknown message "${describeMessageType(type)}" from ${client.sessionId}`);
    });
  }

  // ---------- lobby handlers (existing) ----------

  private handleChat(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const validation = validateChatText(readField(payload, 'text'), this.config.chatMaxLength);
    if (!validation.ok) {
      this.sendError(client, validation.code, validation.message);
      return;
    }
    if (!this.chatLimiter.allow(client.sessionId)) {
      this.sendError(client, 'CHAT_RATE_LIMITED', 'You are sending messages too quickly.');
      return;
    }
    const message: StateChannelMessage = {
      type: 'chat',
      playerId: player.id,
      text: validation.text,
      sentAt: Date.now(),
    };
    this.broadcast('chat', message);
  }

  private handleSeatChange(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const seat = readField(payload, 'seat');
    if (!isValidSeat(seat, this.maxClients)) {
      this.sendError(client, 'SEAT_INVALID', `Seat must be an integer between 0 and ${this.maxClients - 1}.`);
      return;
    }
    for (const other of this.state.players.values()) {
      if (other.id !== player.id && other.seat === seat) {
        this.sendError(client, 'SEAT_TAKEN', `Seat ${seat} is already taken.`);
        return;
      }
    }
    player.seat = seat as number;
  }

  private handleColorChange(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const color = normalizePlayerColor(readField(payload, 'color'));
    if (color === null) {
      this.sendError(client, 'COLOR_INVALID', 'Pick a colour from the table palette.');
      return;
    }
    for (const other of this.state.players.values()) {
      if (other.id !== player.id && other.color === color) {
        this.sendError(client, 'COLOR_TAKEN', `Colour ${color} is already taken.`);
        return;
      }
    }
    player.color = color;
  }

  // ---------- object handlers ----------

  private isHost(client: Client): boolean {
    return this.state.hostId === client.sessionId;
  }

  private getObjectDefFromState(id: string): ObjectDef | null {
    const s = this.state.objects.get(id);
    if (!s) return null;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(s.metaJson || '{}');
    } catch {
      meta = {};
    }
    return {
      id: s.id,
      kind: s.kind as ObjectDef['kind'],
      assetRef: s.assetRef,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      ownerId: ownerIdOrNull(s.ownerId),
      locked: s.locked,
      faceUp: s.faceUp,
      meta,
    };
  }

  private handleObjectSpawn(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const obj = (readField(payload, 'object') ?? payload) as Partial<ObjectDef>;
    if (typeof obj?.id !== 'string' || obj.id.length === 0) {
      this.sendError(client, 'OBJECT_INVALID', 'Object id is required.');
      return;
    }
    if (this.state.objects.has(obj.id)) {
      this.sendError(client, 'OBJECT_EXISTS', `Object ${obj.id} already exists.`);
      return;
    }
    const kind = (obj.kind ?? 'custom') as ObjectDef['kind'];
    const ownerId = obj.ownerId === client.sessionId ? client.sessionId : null;
    const meta = obj.meta && typeof obj.meta === 'object' ? (obj.meta as Record<string, unknown>) : {};
    const metaJson = JSON.stringify(meta);
    if (metaJson.length > 4096) {
      this.sendError(client, 'OBJECT_META_TOO_LARGE', 'Object meta exceeds limit.');
      return;
    }

    const os = new ObjectState();
    os.id = obj.id;
    os.kind = kind;
    os.ownerId = ownerIdToSchema(ownerId);
    os.locked = !!obj.locked;
    os.faceUp = obj.faceUp !== false;
    os.metaJson = metaJson;
    os.assetRef = typeof obj.assetRef === 'string' ? obj.assetRef : '';
    this.state.objects.set(obj.id, os);

    this.ownership.set(obj.id, {
      ownerId,
      claimToken: null,
      seq: 0,
      lastUpdate: Date.now(),
      lastBroadcast: 0,
    });

    const def: ObjectDef = {
      id: os.id,
      kind: kind,
      assetRef: os.assetRef,
      transform: obj.transform
        ? (obj.transform as Transform)
        : { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      ownerId,
      locked: os.locked,
      faceUp: os.faceUp,
      meta,
    };

    this.broadcast('objectSpawn', { type: 'objectSpawn', object: def } satisfies StateChannelMessage);
    logger.info(`[table:${this.roomId}] object ${obj.id} spawned by ${client.sessionId}`);
  }

  private handleObjectRemove(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const objectId = String(readField(payload, 'objectId') ?? readField(payload, 'id') ?? '');
    if (!objectId || !this.state.objects.has(objectId)) {
      this.sendError(client, 'OBJECT_NOT_FOUND', `Object ${objectId} not found.`);
      return;
    }
    const own = this.ownership.get(objectId);
    const isOwner = own?.ownerId === client.sessionId;
    if (!isOwner && !this.isHost(client)) {
      this.sendError(client, 'OBJECT_NOT_OWNER', 'Only the owner or host can remove this object.');
      return;
    }
    this.state.objects.delete(objectId);
    this.ownership.delete(objectId);
    this.broadcast('objectRemove', { type: 'objectRemove', objectId } satisfies StateChannelMessage);
  }

  private handleObjectClaim(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const objectId = String(readField(payload, 'objectId') ?? readField(payload, 'id') ?? '');
    if (!objectId || !this.state.objects.has(objectId)) {
      this.sendError(client, 'OBJECT_NOT_FOUND', `Object ${objectId} not found.`);
      return;
    }
    const own = this.ownership.get(objectId)!;
    if (own.ownerId !== null && own.ownerId !== client.sessionId) {
      this.sendError(client, 'OBJECT_CLAIMED', `Object ${objectId} is already claimed.`);
      return;
    }
    const claimToken = `claim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    own.ownerId = client.sessionId;
    own.claimToken = claimToken;
    own.seq = 0;
    own.lastUpdate = Date.now();

    const os = this.state.objects.get(objectId)!;
    os.ownerId = ownerIdToSchema(client.sessionId);

    this.broadcast('objectClaim', {
      type: 'objectClaim',
      objectId,
      playerId: client.sessionId,
      claimToken,
    } satisfies StateChannelMessage);
  }

  private handleObjectRelease(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const objectId = String(readField(payload, 'objectId') ?? readField(payload, 'id') ?? '');
    if (!objectId || !this.state.objects.has(objectId)) {
      this.sendError(client, 'OBJECT_NOT_FOUND', `Object ${objectId} not found.`);
      return;
    }
    const own = this.ownership.get(objectId)!;
    if (own.ownerId !== client.sessionId) {
      this.sendError(client, 'OBJECT_NOT_OWNER', 'Only the owner can release this object.');
      return;
    }
    own.ownerId = null;
    own.claimToken = null;
    own.lastUpdate = Date.now();

    const os = this.state.objects.get(objectId)!;
    os.ownerId = ownerIdToSchema(null);

    this.broadcast('objectRelease', {
      type: 'objectRelease',
      objectId,
      playerId: client.sessionId,
    } satisfies StateChannelMessage);
  }

  private handleObjectLock(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const objectId = String(readField(payload, 'objectId') ?? readField(payload, 'id') ?? '');
    if (!objectId || !this.state.objects.has(objectId)) {
      this.sendError(client, 'OBJECT_NOT_FOUND', `Object ${objectId} not found.`);
      return;
    }
    const own = this.ownership.get(objectId)!;
    if (own.ownerId !== null && own.ownerId !== client.sessionId && !this.isHost(client)) {
      this.sendError(client, 'OBJECT_NOT_OWNER', 'Only the owner or host can lock this object.');
      return;
    }
    const locked = !!readField(payload, 'locked');
    const os = this.state.objects.get(objectId)!;
    os.locked = locked;
    this.broadcast('objectLock', {
      type: 'objectLock',
      objectId,
      playerId: readField(payload, 'playerId') !== undefined ? (readField(payload, 'playerId') as string | null) : client.sessionId,
      locked,
    } satisfies StateChannelMessage);
  }

  private handleFlip(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const objectId = String(readField(payload, 'objectId') ?? readField(payload, 'id') ?? '');
    if (!objectId || !this.state.objects.has(objectId)) {
      this.sendError(client, 'OBJECT_NOT_FOUND', `Object ${objectId} not found.`);
      return;
    }
    const own = this.ownership.get(objectId)!;
    if (own.ownerId !== null && own.ownerId !== client.sessionId) {
      this.sendError(client, 'FLIP_FORBIDDEN', 'Only the owner can flip this object.');
      return;
    }
    const faceUp = typeof readField(payload, 'faceUp') === 'boolean'
      ? (readField(payload, 'faceUp') as boolean)
      : !(this.state.objects.get(objectId)!.faceUp);
    const os = this.state.objects.get(objectId)!;
    os.faceUp = faceUp;
    this.broadcast('flip', { type: 'flip', objectId, faceUp } satisfies StateChannelMessage);
  }

  private handleDeckShuffle(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const deckId = String(readField(payload, 'deckId') ?? readField(payload, 'id') ?? '');
    if (!deckId || !this.state.objects.has(deckId)) {
      this.sendError(client, 'OBJECT_NOT_FOUND', `Object ${deckId} not found.`);
      return;
    }
    const own = this.ownership.get(deckId)!;
    if (own.ownerId !== null && own.ownerId !== client.sessionId && !this.isHost(client)) {
      this.sendError(client, 'SHUFFLE_FORBIDDEN', 'Only the owner or host can shuffle this deck.');
      return;
    }
    this.broadcast('deckShuffle', { type: 'deckShuffle', deckId } satisfies StateChannelMessage);
  }

  private handleTransformUpdate(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const id = String(readField(payload, 'id') ?? readField(payload, 'objectId') ?? '');
    if (!id || !this.state.objects.has(id)) {
      return;
    }
    const own = this.ownership.get(id);
    if (!own || own.ownerId !== client.sessionId) {
      this.sendError(client, 'TRANSFORM_FORBIDDEN', 'Only the owner can move this object.');
      return;
    }

    const seqRaw = readField(payload, 'seq');
    const seq = typeof seqRaw === 'number' ? seqRaw : own.seq;
    if (seq < (this.objectLastSeq.get(id) ?? 0)) {
      return; // stale seq dropped
    }

    const now = Date.now();
    if (now - own.lastBroadcast < TRANSFORM_INTERVAL_MS) {
      return; // frequency limit
    }

    // bandwidth budget
    const msg: TransformChannelMessage = {
      type: 'transformUpdate',
      id,
      transform: readField(payload, 'transform') as Transform,
      velocity: readField(payload, 'velocity') as TransformChannelMessage['velocity'],
      seq,
      t: typeof readField(payload, 't') === 'number' ? (readField(payload, 't') as number) : now,
    };
    let size = 0;
    try {
      size = Buffer.byteLength(JSON.stringify(msg), 'utf8');
    } catch {
      size = 256;
    }
    if (now - this.bandwidthWindowStart >= 1000) {
      this.bandwidthWindowStart = now;
      this.bandwidthBytes = 0;
    }
    if (this.bandwidthBytes + size > BANDWIDTH_BUDGET_BYTES_PER_SEC) {
      logger.warn(`[table:${this.roomId}] bandwidth budget exceeded, dropping transform for ${id}`);
      return;
    }
    this.bandwidthBytes += size;

    own.lastBroadcast = now;
    own.lastUpdate = now;
    own.seq = seq;
    this.objectLastSeq.set(id, seq);

    this.broadcast('transformUpdate', msg, { except: client });
  }

  // ---------- helpers ----------

  private transferOwnership(oldId: string, newId: string): void {
    for (const [objectId, own] of this.ownership.entries()) {
      if (own.ownerId === oldId) {
        own.ownerId = newId;
        const os = this.state.objects.get(objectId);
        if (os) os.ownerId = ownerIdToSchema(newId);
      }
    }
  }

  private sweepInactivity(): void {
    const now = Date.now();
    for (const [objectId, own] of this.ownership.entries()) {
      if (own.ownerId !== null && now - own.lastUpdate > INACTIVITY_RELEASE_MS) {
        const ownerId = own.ownerId;
        own.ownerId = null;
        own.claimToken = null;
        const os = this.state.objects.get(objectId);
        if (os) os.ownerId = ownerIdToSchema(null);
        this.broadcast('objectRelease', {
          type: 'objectRelease',
          objectId,
          playerId: ownerId,
        } satisfies StateChannelMessage);
        logger.info(`[table:${this.roomId}] auto-released ${objectId} after inactivity`);
      }
    }
  }

  private hasOtherPlayers(sessionId: string): boolean {
    for (const client of this.clients) {
      if (client.sessionId !== sessionId) return true;
    }
    return false;
  }

  private removePlayer(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    this.state.players.delete(sessionId);
    this.chatLimiter.reset(sessionId);

    if (this.state.hostId === player.id || this.state.hostId === sessionId) {
      const nextHost = this.oldestPlayer();
      this.state.hostId = nextHost?.id ?? '';
      void this.setMetadata({ hostId: this.state.hostId });
    }
    for (const other of this.state.players.values()) {
      other.isHost = other.id === this.state.hostId;
    }

    this.broadcast('leave', { type: 'leave', playerId: player.id } satisfies StateChannelMessage);
    logger.info(`[table:${this.roomId}] ${player.name} left (seat ${player.seat})`);
  }

  private oldestPlayer(): PlayerState | null {
    let oldest: PlayerState | null = null;
    for (const player of this.state.players.values()) {
      if (
        oldest === null ||
        player.joinedAt < oldest.joinedAt ||
        (player.joinedAt === oldest.joinedAt && player.seat < oldest.seat)
      ) {
        oldest = player;
      }
    }
    return oldest;
  }

  public sendHand(client: Client, hand: { ownerId: string; cardIds: string[] }): void {
    const filtered = filterHandForClient(hand, client.sessionId);
    if (!filtered) return;
    this.send(client, 'hand', { type: 'hand', hand: filtered } satisfies StateChannelMessage);
  }

  private sendError(client: Client, code: string, message: string): void {
    this.send(client, 'error', { code, message });
  }
}

export const TABLE_MAX_SEATS = MAX_SEATS;
