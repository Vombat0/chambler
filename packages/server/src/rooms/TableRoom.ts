/**
 * TableRoom — lobby + object sync (B1/B2).
 */
import { ErrorCode, Room, ServerError, logger, matchMaker } from 'colyseus';
import type { Client } from 'colyseus';
import type { DieResultMessage, StateChannelMessage } from '@chambler/shared';
import {
  MAX_RECORDS_PER_PACKET,
  TRANSFORM_BATCH_MESSAGE,
  TRANSFORM_JSON_MESSAGE,
  TRANSFORM_RATE_HZ,
  TRANSFORM_RECORD_BYTES,
  TransformCodecError,
  TransformIdTable,
  decodeTransformBatch,
  encodeTransformBatch,
  isNewerSeq,
  type ObjectDef,
  type Transform,
  type TransformChannelMessage,
  type WireTransformFrame,
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
import { BandwidthBudget } from './BandwidthBudget.js';
import { dieFaceCount, validateDieResult, type DieResultEpoch } from './dieResult.js';

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

/**
 * Normalises the transport payload of a binary message. Colyseus/msgpack hands
 * `bin` values over as Uint8Array (or Buffer); plain arrays are tolerated for
 * hand-written test clients.
 */
function toBytes(payload: unknown): Uint8Array | null {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload) && payload.every((v) => typeof v === 'number')) {
    return Uint8Array.from(payload as number[]);
  }
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const data = (payload as { data?: unknown }).data;
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
  }
  return null;
}

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
const TRANSFORM_INTERVAL_MS = 1000 / TRANSFORM_RATE_HZ;
/**
 * Server-side floor between two accepted frames of the same object. Slightly
 * below the client's 20 Hz so network jitter does not eat legitimate frames,
 * while still capping a client that ignores the sampling contract.
 */
const MIN_OBJECT_INTERVAL_MS = TRANSFORM_INTERVAL_MS * 0.8;
/** Max objects buffered between two flush ticks. */
const MAX_PENDING_TRANSFORMS = 512;

/** Room-level counters used by the bandwidth measurement script and ops. */
export interface TableRoomMetrics {
  /** Outbound application bytes accepted for broadcast (payload x recipients). */
  transformBytesSent: number;
  transformFramesAccepted: number;
  transformFramesDropped: number;
  /** Binary packets sent (one per client per flush chunk). */
  transformBatchesSent: number;
  transformBytesDropped: number;
  budgetRejections: number;
  legacyJsonFrames: number;
  dieResultsAccepted: number;
  dieResultsRejected: number;
  flushTicks: number;
}

export class TableRoom extends Room<TableState, TableRoomMetadata, unknown, TableAuthData> {
  private config: ServerConfig = loadConfig();
  private readonly chatLimiter = new ChatRateLimiter();
  private readonly startedAt = Date.now();
  private readonly ownership = new Map<string, ObjectOwnership>();
  private readonly objectLastSeq = new Map<string, number>();
  private budget: BandwidthBudget = new BandwidthBudget({ roomBytesPerSecond: 64 * 1024, players: 8 });
  private readonly idTable = new TransformIdTable();
  private readonly pendingTransforms = new Map<string, WireTransformFrame>();
  private readonly dieEpochs = new Map<string, DieResultEpoch>();
  private readonly budgetWarned = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly metrics: TableRoomMetrics = {
    transformBytesSent: 0,
    transformFramesAccepted: 0,
    transformFramesDropped: 0,
    transformBatchesSent: 0,
    transformBytesDropped: 0,
    budgetRejections: 0,
    legacyJsonFrames: 0,
    dieResultsAccepted: 0,
    dieResultsRejected: 0,
    flushTicks: 0,
  };
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

    this.budget = new BandwidthBudget({
      roomBytesPerSecond: this.config.transformBudgetBytesPerSec,
      players: this.maxClients,
    });
    this.registerMessageHandlers();
    this.flushTimer = setInterval(() => this.flushTransforms(), this.config.transformFlushMs);
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

    this.budget.setPlayers(this.maxClients);

    this.broadcast('join', { type: 'join', player: toPlayerInfo(player) } satisfies StateChannelMessage, { except: client });
    this.replayDieResults(client);
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
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.pendingTransforms.clear();
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
    this.onMessage(TRANSFORM_BATCH_MESSAGE, (client, payload) => this.handleTransformBatch(client, payload));
    this.onMessage(TRANSFORM_JSON_MESSAGE, (client, payload) => this.handleTransformUpdate(client, payload));
    this.onMessage('dieResult', (client, payload) => this.handleDieResult(client, payload));

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
      netIndex: s.netIndex,
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
    os.netIndex = this.idTable.indexOf(obj.id);
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
      netIndex: os.netIndex,
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
    this.pendingTransforms.delete(objectId);
    this.idTable.delete(objectId);
    this.dieEpochs.delete(objectId);
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

  /**
   * Binary transform batch (B3, preferred path).
   *
   * Wire: `transformBatch` with a `Uint8Array` payload (see transformCodec).
   * Every frame is checked for ownership, staleness and the room bandwidth
   * budget before it is queued; the queue is flushed once per tick as one
   * packet per 255 objects instead of one message per object.
   */
  private handleTransformBatch(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const bytes = toBytes(payload);
    if (!bytes) {
      this.sendError(client, 'TRANSFORM_MALFORMED', 'transformBatch expects a binary payload.');
      return;
    }

    let frames: WireTransformFrame[];
    try {
      frames = decodeTransformBatch(bytes).frames;
    } catch (error) {
      const code = error instanceof TransformCodecError ? error.code : 'DECODE_FAILED';
      this.metrics.transformFramesDropped += 1;
      this.sendError(client, 'TRANSFORM_MALFORMED', `Rejected transform batch (${code}).`);
      return;
    }

    const now = Date.now();
    // The owner is excluded from the fan-out, so the cost is (clients - 1).
    const recipients = Math.max(1, this.clients.length - 1);
    for (const frame of frames) {
      const id = this.idTable.idOf(frame.index);
      if (!id) {
        this.metrics.transformFramesDropped += 1;
        continue;
      }
      const own = this.ownership.get(id);
      if (!own || own.ownerId !== client.sessionId) {
        this.metrics.transformFramesDropped += 1;
        this.sendError(client, 'TRANSFORM_FORBIDDEN', 'Only the owner can move this object.');
        continue;
      }
      if (this.objectLastSeq.has(id) && !isNewerSeq(frame.seq, this.objectLastSeq.get(id) ?? 0)) {
        this.metrics.transformFramesDropped += 1; // stale / duplicate seq
        continue;
      }
      if (now - own.lastBroadcast < MIN_OBJECT_INTERVAL_MS) {
        this.metrics.transformFramesDropped += 1; // per-object frequency cap
        continue;
      }
      if (!this.spendTransformBudget(client, TRANSFORM_RECORD_BYTES * recipients, now)) {
        this.metrics.transformFramesDropped += 1;
        continue;
      }

      own.lastBroadcast = now;
      own.lastUpdate = now;
      own.seq = frame.seq;
      this.objectLastSeq.set(id, frame.seq);
      this.pendingTransforms.delete(id); // newer data supersedes the queued frame
      this.pendingTransforms.set(id, frame);
      if (this.pendingTransforms.size > MAX_PENDING_TRANSFORMS) {
        const oldest = this.pendingTransforms.keys().next();
        if (!oldest.done) {
          this.pendingTransforms.delete(oldest.value);
          this.metrics.transformFramesDropped += 1;
        }
      }
      this.metrics.transformFramesAccepted += 1;
    }
  }

  /**
   * Flushes queued transforms as binary packets.
   *
   * The owner of an object never receives its own frame (it is authoritative
   * locally), so each client gets a packet filtered to the objects it does not
   * own. Packets are chunked at 255 records (uint8 count) and the filtering
   * costs one encode per client per tick, which is cheaper than the ~12% of
   * egress an unconditional broadcast would waste.
   */
  private flushTransforms(): void {
    this.metrics.flushTicks += 1;
    if (this.pendingTransforms.size === 0) return;
    const queued = [...this.pendingTransforms.entries()];
    this.pendingTransforms.clear();
    const clients = [...this.clients];
    if (clients.length === 0) return;

    for (let offset = 0; offset < queued.length; offset += MAX_RECORDS_PER_PACKET) {
      const chunk = queued.slice(offset, offset + MAX_RECORDS_PER_PACKET);
      for (const client of clients) {
        const frames: WireTransformFrame[] = [];
        for (const [id, frame] of chunk) {
          if (this.ownership.get(id)?.ownerId === client.sessionId) continue;
          frames.push(frame);
        }
        if (frames.length === 0) continue;
        let packet: Uint8Array;
        try {
          packet = encodeTransformBatch(frames);
        } catch (error) {
          logger.warn(`[table:${this.roomId}] could not encode transform batch: ${String(error)}`);
          continue;
        }
        this.metrics.transformBatchesSent += 1;
        this.metrics.transformBytesSent += packet.byteLength;
        client.send(TRANSFORM_BATCH_MESSAGE, packet);
      }
    }
  }

  /**
   * Legacy JSON transform frame (B2 wire format). Kept so old clients and the
   * bandwidth baseline still work; new clients use `transformBatch`.
   */
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
    const lastSeq = this.objectLastSeq.get(id);
    if (lastSeq !== undefined && seq < lastSeq) {
      return; // stale seq dropped
    }

    const now = Date.now();
    if (now - own.lastBroadcast < TRANSFORM_INTERVAL_MS) {
      return; // frequency limit
    }

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
    const recipients = Math.max(1, this.clients.length - 1);
    if (!this.spendTransformBudget(client, size * recipients, now)) {
      return;
    }

    own.lastBroadcast = now;
    own.lastUpdate = now;
    own.seq = seq;
    this.objectLastSeq.set(id, seq);
    this.metrics.legacyJsonFrames += 1;
    this.metrics.transformFramesAccepted += 1;
    this.metrics.transformBytesSent += size * recipients;

    this.broadcast(TRANSFORM_JSON_MESSAGE, msg, { except: client });
  }

  /** Charges the room budget; trims (and warns once per window) when exceeded. */
  private spendTransformBudget(client: Client, bytes: number, now: number): boolean {
    const decision = this.budget.tryConsume(client.sessionId, bytes, now);
    if (decision.allowed) {
      // Bytes are only counted when the packet is really broadcast; charging
      // here as well would double count (see broadcastTransformPacket).
      this.budgetWarned.delete(client.sessionId);
      return true;
    }
    this.metrics.budgetRejections += 1;
    this.metrics.transformBytesDropped += bytes;
    if (!this.budgetWarned.has(client.sessionId)) {
      this.budgetWarned.add(client.sessionId);
      logger.warn(
        `[table:${this.roomId}] transform budget ${decision.reason} exceeded by ${client.sessionId}; trimming frames (session kept)`,
      );
      this.sendError(
        client,
        'TRANSFORM_BUDGET',
        `Transform budget exceeded (${decision.reason}); frames are being trimmed.`,
      );
    }
    return false;
  }

  /**
   * Authoritative die result (B3).
   *
   * The owner reads the face and reports it; the server validates the value
   * against the die's face count, refuses a contradictory re-report inside the
   * same throw, persists the value in room state (so late joiners and
   * reconnecting clients see it) and broadcasts it to everyone.
   */
  private handleDieResult(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    const objectId = String(readField(payload, 'objectId') ?? readField(payload, 'id') ?? '');
    const os = objectId ? this.state.objects.get(objectId) : undefined;
    if (!objectId || !os) {
      this.sendError(client, 'OBJECT_NOT_FOUND', `Object ${objectId} not found.`);
      return;
    }

    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(os.metaJson || '{}');
    } catch {
      meta = {};
    }
    const own = this.ownership.get(objectId);
    const verdict = validateDieResult({
      kind: os.kind,
      faces: dieFaceCount(meta),
      value: readField(payload, 'value'),
      isOwner: own?.ownerId === client.sessionId,
      claimToken: own?.claimToken ?? null,
      previous: this.dieEpochs.get(objectId) ?? null,
      now: Date.now(),
    });

    if (!verdict.ok) {
      this.metrics.dieResultsRejected += 1;
      this.sendError(client, verdict.code, verdict.message);
      return;
    }

    const at = Date.now();
    this.dieEpochs.set(objectId, { value: verdict.value, claimToken: own?.claimToken ?? null, at });
    os.dieValue = verdict.value;
    os.dieRolledBy = client.sessionId;
    os.dieRolledAt = at;
    this.metrics.dieResultsAccepted += 1;

    const message: DieResultMessage = {
      type: 'dieResult',
      objectId,
      playerId: client.sessionId,
      value: verdict.value,
      faces: verdict.faces,
      at,
    };
    this.broadcast('dieResult', message satisfies StateChannelMessage);
    logger.info(`[table:${this.roomId}] die ${objectId} -> ${verdict.value} (d${verdict.faces}) by ${player.name}`);
  }

  /** Sends the persisted die results to a fresh / reconnecting client. */
  private replayDieResults(client: Client): void {
    for (const os of this.state.objects.values()) {
      if (os.dieValue <= 0) continue;
      client.send('dieResult', {
        type: 'dieResult',
        objectId: os.id,
        playerId: os.dieRolledBy,
        value: os.dieValue,
        faces: dieFaceCount(this.parseMeta(os)),
        at: Number(os.dieRolledAt),
      } satisfies StateChannelMessage);
    }
  }

  private parseMeta(os: ObjectState): Record<string, unknown> {
    try {
      return JSON.parse(os.metaJson || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /** Live counters for the bandwidth script and operational dashboards. */
  public getMetrics(): TableRoomMetrics & { budget: ReturnType<BandwidthBudget['stats']>; players: number; objects: number } {
    return {
      ...this.metrics,
      budget: this.budget.stats(),
      players: this.clients.length,
      objects: this.state.objects.size,
    };
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
    client.send('hand', { type: 'hand', hand: filtered } satisfies StateChannelMessage);
  }

  private sendError(client: Client, code: string, message: string): void {
    client.send('error', { code, message });
  }
}

export const TABLE_MAX_SEATS = MAX_SEATS;
