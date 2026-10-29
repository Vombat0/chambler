/**
 * TableRoom — lobby + object sync (B1/B2).
 */
import { ErrorCode, Room, ServerError, logger, matchMaker } from 'colyseus';
import type { Client } from 'colyseus';
import type { DieResultMessage, StateChannelMessage, TableResyncMessage } from '@chambler/shared';
import {
  MAX_RECORDS_PER_PACKET,
  SNAPSHOT_SCHEMA_VERSION,
  TRANSFORM_BATCH_MESSAGE,
  TRANSFORM_JSON_MESSAGE,
  TRANSFORM_RATE_HZ,
  TRANSFORM_RECORD_BYTES,
  TransformCodecError,
  TransformIdTable,
  decodeTransformBatch,
  encodeTransformBatch,
  isNewerSeq,
  sanitizeObjectForSnapshot,
  type DieValueSnapshot,
  type ObjectDef,
  type ObjectSnapshotData,
  type PlayerSnapshot,
  type TableSnapshot,
  type Transform,
  type TransformChannelMessage,
  type WireTransformFrame,
} from '@chambler/shared';
import { loadConfig, type ServerConfig } from '../config.js';
import { ChatRateLimiter, validateChatText } from '../lobby/chat.js';
import { uniquePlayerName, validatePlayerName } from '../lobby/names.js';
import { generateUniqueRoomCode, normalizeRoomCode } from '../lobby/roomCode.js';
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
import { filterHandForClient, sanitizeObjectForClient } from '../lobby/secrets.js';
import { BandwidthBudget } from './BandwidthBudget.js';
import { dieFaceCount, validateDieResult, type DieResultEpoch } from './dieResult.js';
import { getSnapshotStore, type SnapshotSaveResult } from '../persist/SnapshotStore.js';

export const TABLE_ROOM_NAME = 'table';

const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { w: 1, x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isTransformShape(v: unknown): v is Transform {
  return (
    typeof v === 'object' &&
    v !== null &&
    'position' in v &&
    'rotation' in v &&
    'scale' in v
  );
}

/**
 * Clamps any client-supplied transform into a finite, persistable one.
 * `null` yields the identity. Used for the last-known transform map and the
 * snapshot path — the wire channel keeps its own binary codec.
 */
export function sanitizeTransform(input: Partial<Transform> | null | undefined): Transform {
  if (!input) return { position: { ...IDENTITY_TRANSFORM.position }, rotation: { ...IDENTITY_TRANSFORM.rotation }, scale: { ...IDENTITY_TRANSFORM.scale } };
  const position = input.position;
  const rotation = input.rotation;
  const scale = input.scale;
  return {
    position: {
      x: finiteOr(position?.x, 0),
      y: finiteOr(position?.y, 0),
      z: finiteOr(position?.z, 0),
    },
    rotation: {
      w: finiteOr(rotation?.w, 1),
      x: finiteOr(rotation?.x, 0),
      y: finiteOr(rotation?.y, 0),
      z: finiteOr(rotation?.z, 0),
    },
    scale: {
      x: finiteOr(scale?.x, 1),
      y: finiteOr(scale?.y, 1),
      z: finiteOr(scale?.z, 1),
    },
  };
}

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
  /**
   * B4: set while the owning player's connection is gone but still inside the
   * reconnection window (ownership "pending"). Cleared on reconnect; if the
   * window expires the ownership is released and broadcast to everyone.
   */
  ownerGoneSince: number | null;
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
/** Max characters of object meta persisted/restored (mirrors the spawn limit). */
const MAX_META_JSON = 4096;
/** Chat messages kept for players joining later (ring buffer size). */
const MAX_RECENT_CHATS = 50;

/**
 * Chat entry kept in the recent-history ring buffer. Same wire shape as the
 * `chat` broadcast plus the sender's display name, so a late joiner sees who
 * wrote what even if the sender has already left the table.
 */
export interface ChatHistoryEntry {
  playerId: string;
  playerName: string;
  text: string;
  sentAt: number;
}

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
  /* ---------------- B4: persistence + reconnection state ---------------- */
  /** Last-known transform per object (transforms never enter the schema). */
  private readonly lastTransforms = new Map<string, Transform>();
  /** Seat/colour remembered per player name (B4 restore + returning players). */
  private readonly rememberedSeats = new Map<string, { seat: number; color: string }>();
  private saveTimer: NodeJS.Timeout | null = null;
  private scheduledSaveAt = 0;
  private lastSaveAt = 0;
  private dirty = false;
  private everHadPlayers = false;
  private restoredFrom: TableSnapshot | null = null;
  /** FIX-MULTIPLAYER-1: last MAX_RECENT_CHATS chat messages for late joiners. */
  private readonly recentChats: ChatHistoryEntry[] = [];

  override async onCreate(options?: unknown): Promise<void> {
    this.config = defaultServerConfig ?? loadConfig();
    this.maxClients = this.config.maxPlayers;
    this.autoDispose = true;
    this.lastSaveAt = this.startedAt;

    const restoreCode = normalizeRoomCode(readField(options, 'restoreCode'));
    let code: string;
    let restored: TableSnapshot | null = null;
    if (restoreCode && !(await this.isRoomCodeLive(restoreCode))) {
      const load = getSnapshotStore().load(restoreCode);
      if (load.status === 'ok') {
        restored = load.snapshot;
        code = restoreCode;
        codesInCreation.add(code);
        logger.info(`[table:${code}] reopening from snapshot (saved ${new Date(load.snapshot.savedAt).toISOString()})`);
      } else {
        code = await this.claimRoomCode();
      }
    } else {
      code = await this.claimRoomCode();
    }

    try {
      this.roomId = code;
      const state = new TableState();
      state.code = code;
      state.maxPlayers = this.maxClients;
      state.createdAt = restored ? restored.createdAt : Date.now();
      this.setState(state);
      if (restored) {
        this.restoreFromSnapshot(restored);
      }
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
    logger.info(`[table:${code}] created (max ${this.maxClients} players${restored ? ', restored' : ''})`);
  }

  /** True when a live room already uses `code` (restore collision check). */
  private async isRoomCodeLive(code: string): Promise<boolean> {
    try {
      for (const room of await matchMaker.query({ name: TABLE_ROOM_NAME })) {
        if (room.roomId === code) return true;
      }
    } catch {
      // ignore
    }
    return codesInCreation.has(code);
  }

  /** Rebuilds objects, die results and remembered seats from a snapshot. */
  private restoreFromSnapshot(snapshot: TableSnapshot): void {
    for (const object of snapshot.objects) {
      if (this.state.objects.has(object.id)) continue;
      let metaJson = '{}';
      try {
        metaJson = JSON.stringify(object.meta ?? {});
      } catch {
        metaJson = '{}';
      }
      if (metaJson.length > MAX_META_JSON) {
        logger.warn(`[table:${this.roomId}] object ${object.id} meta too large, dropped on restore`);
        metaJson = '{}';
      }
      const os = new ObjectState();
      os.id = object.id;
      os.kind = object.kind;
      // After a restart nobody is connected: every object starts free.
      os.ownerId = ownerIdToSchema(null);
      os.locked = object.locked;
      os.faceUp = object.faceUp;
      os.metaJson = metaJson;
      os.assetRef = object.assetRef;
      os.netIndex = this.idTable.indexOf(object.id);
      const die = snapshot.dieValues[object.id];
      if (die && die.value > 0) {
        os.dieValue = die.value;
        os.dieRolledBy = die.rolledBy;
        os.dieRolledAt = die.rolledAt;
      }
      this.state.objects.set(object.id, os);
      this.ownership.set(object.id, {
        ownerId: null,
        claimToken: null,
        seq: 0,
        lastUpdate: Date.now(),
        lastBroadcast: 0,
        ownerGoneSince: null,
      });
      this.lastTransforms.set(object.id, sanitizeTransform(object.transform));
    }
    for (const player of snapshot.players) {
      this.rememberedSeats.set(player.name, { seat: player.seat, color: player.color });
    }
    this.restoredFrom = snapshot;
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
    const name = auth?.name ?? uniquePlayerName('Player', players.map((entry) => entry.name));
    let seat = firstFreeSeat(players.map((player) => player.seat), this.maxClients);
    let color = firstFreeColor(players.map((player) => player.color));
    // B4: a player returning to a restored table finds their old seat/colour.
    const remembered = this.rememberedSeats.get(name);
    if (remembered) {
      const seatFree = seat !== null && !players.some((p) => p.seat === remembered.seat);
      const colorFree = color !== null && !players.some((p) => p.color === remembered.color);
      if (remembered.seat >= 0 && remembered.seat < this.maxClients && seatFree) seat = remembered.seat;
      if (colorFree) color = remembered.color as typeof color;
    }
    if (seat === null || color === null) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, 'ROOM_FULL: no seat or colour left.');
    }

    const isFirstPlayer = this.state.players.size === 0;
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = name;
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
    this.everHadPlayers = true;
    this.rememberSeat(player.name, player.seat, player.color);

    this.broadcast('join', { type: 'join', player: toPlayerInfo(player) } satisfies StateChannelMessage, { except: client });
    this.replayDieResults(client);
    // B4: full state for fresh joins and reconnects — object list with
    // last-known transforms, so the client can reset interpolation cleanly.
    this.sendTableResync(client);
    // FIX-MULTIPLAYER-1: chat written before this player joined.
    this.sendChatHistory(client);
    this.markDirty();
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
      // B4: ownership goes "pending" while the reconnection window is open.
      this.markOwnershipGone(oldId);
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
        // Back within the window: the player keeps everything they owned.
        this.clearOwnershipGone(reconnected.sessionId);
        this.markDirty();
        return;
      } catch {
        // Window expired: fall through and release the pending ownership.
      }
    }

    this.releaseOwnershipOf(client.sessionId);
    this.removePlayer(client.sessionId);
    this.markDirty();
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
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    codesInCreation.delete(this.state.code);
    this.chatLimiter.clear();
    // B4: forced save — the table survives the room (and the process).
    if (this.state.objects.size > 0 || this.everHadPlayers) {
      this.persistNow();
    }
    logger.info(`[table:${this.roomId}] disposed`);
  }

  private registerMessageHandlers(): void {
    this.onMessage('chat', (client, payload) => this.handleChat(client, payload));
    this.onMessage('seat', (client, payload) => this.handleSeatChange(client, payload));
    this.onMessage('color', (client, payload) => this.handleColorChange(client, payload));
    this.onMessage('tableStart', (client) => this.handleTableStart(client));

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
    this.rememberChat({
      playerId: player.id,
      playerName: player.name,
      text: validation.text,
      sentAt: message.sentAt,
    });
  }

  /**
   * FIX-MULTIPLAYER-1: host starts the table. Flips the synchronised
   * `started` flag so every connected client — and everyone joining later —
   * enters the table screen together. Non-host attempts are rejected.
   */
  private handleTableStart(client: Client): void {
    if (!this.state.players.has(client.sessionId)) return;
    if (!this.isHost(client)) {
      this.sendError(client, 'HOST_ONLY', 'Only the host can start the table.');
      return;
    }
    if (this.state.started) return; // idempotent: already started
    this.state.started = true;
    logger.info(`[table:${this.roomId}] table started by ${client.sessionId}`);
  }

  /** Keeps the last MAX_RECENT_CHATS chat messages (bounded insertion order). */
  private rememberChat(entry: ChatHistoryEntry): void {
    this.recentChats.push(entry);
    if (this.recentChats.length > MAX_RECENT_CHATS) {
      this.recentChats.splice(0, this.recentChats.length - MAX_RECENT_CHATS);
    }
  }

  /** Sends the recent chat history to a fresh / reconnecting client. */
  private sendChatHistory(client: Client): void {
    if (this.recentChats.length === 0) return;
    client.send('chatHistory', { messages: this.recentChats.map((entry) => ({ ...entry })) });
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
    this.rememberSeat(player.name, player.seat, player.color);
    this.markDirty();
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
    this.rememberSeat(player.name, player.seat, player.color);
    this.markDirty();
  }

  // ---------- object handlers ----------

  private isHost(client: Client): boolean {
    return this.state.hostId === client.sessionId;
  }

  /** Full ObjectDef view of an ObjectState, with the last-known transform. */
  private objectDefFromState(os: ObjectState): ObjectDef {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(os.metaJson || '{}');
    } catch {
      meta = {};
    }
    return {
      id: os.id,
      kind: os.kind as ObjectDef['kind'],
      assetRef: os.assetRef,
      transform: this.lastTransforms.get(os.id) ?? sanitizeTransform(null),
      ownerId: ownerIdOrNull(os.ownerId),
      locked: os.locked,
      faceUp: os.faceUp,
      meta,
      netIndex: os.netIndex,
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

    this.lastTransforms.set(obj.id, sanitizeTransform(obj.transform));

    this.ownership.set(obj.id, {
      ownerId,
      claimToken: null,
      seq: 0,
      lastUpdate: Date.now(),
      lastBroadcast: 0,
      ownerGoneSince: null,
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
    this.markDirty();
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
    this.lastTransforms.delete(objectId);
    this.idTable.delete(objectId);
    this.dieEpochs.delete(objectId);
    this.broadcast('objectRemove', { type: 'objectRemove', objectId } satisfies StateChannelMessage);
    this.markDirty();
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
    this.markDirty();
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
    this.markDirty();
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
    this.markDirty();
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
    this.markDirty();
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
    this.markDirty();
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
      this.rememberTransform(id, frame.position, frame.rotation);
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
    this.markDirty();
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
    const transform = msg.transform;
    if (transform && isTransformShape(transform)) {
      this.rememberTransform(id, transform.position, transform.rotation);
    }
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
    this.markDirty();

    this.broadcast(TRANSFORM_JSON_MESSAGE, msg, { except: client });
  }

  /**
   * Charges the room budget; trims silently when exceeded.
   *
   * FIX-PLAYABILITY-1: trimming is an internal flow-control detail — the
   * client is never notified. The old `TRANSFORM_BUDGET` error frame made the
   * UI flash a red "something went wrong" toast during ordinary token moves.
   * Only the server-side debug log remains.
   */
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
    this.markDirty();
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

  // ---------- B4: persistence ----------

  /**
   * Debounced autosave trigger (classic debounce + max interval).
   *
   * The save runs `snapshotDebounceMs` after the last change — unless changes
   * keep arriving, in which case it fires at the latest `snapshotMaxIntervalMs`
   * after the previous save, so a continuously moving object (20 Hz dirty
   * marks) still produces at most one write per interval and never starves.
   */
  private markDirty(): void {
    this.dirty = true;
    const now = Date.now();
    const desired = Math.min(
      now + this.config.snapshotDebounceMs,
      this.lastSaveAt + this.config.snapshotMaxIntervalMs,
    );
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.scheduledSaveAt = desired;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistNow();
    }, Math.max(0, desired - now));
  }

  /**
   * Writes the table to disk immediately (host request, debounce fire or
   * room disposal). Synchronous on purpose: `onDispose` must not race the
   * process shutdown. Returns the store result for the HTTP endpoint.
   */
  persistNow(): SnapshotSaveResult {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = false;
    this.lastSaveAt = Date.now();
    const result = getSnapshotStore().save(this.buildSnapshot());
    if (!result.ok) {
      logger.warn(`[table:${this.roomId}] save rejected: ${result.code}: ${result.message}`);
    }
    return result;
  }

  /** True when a change is still waiting for its debounced save. */
  isDirty(): boolean {
    return this.dirty;
  }

  /** Remembers a name -> seat/colour mapping (bounded, insertion order). */
  private rememberSeat(name: string, seat: number, color: string): void {
    this.rememberedSeats.delete(name);
    this.rememberedSeats.set(name, { seat, color });
    if (this.rememberedSeats.size > 64) {
      const oldest = this.rememberedSeats.keys().next();
      if (!oldest.done) this.rememberedSeats.delete(oldest.value);
    }
  }

  /** Builds the durable state of this table (sanitised — no card faces). */
  buildSnapshot(): TableSnapshot {
    const objects: ObjectSnapshotData[] = [];
    const dieValues: Record<string, DieValueSnapshot> = {};
    for (const os of this.state.objects.values()) {
      objects.push(sanitizeObjectForSnapshot(this.objectDefFromState(os)));
      if (os.dieValue > 0) {
        dieValues[os.id] = {
          value: os.dieValue,
          rolledBy: os.dieRolledBy,
          rolledAt: Number(os.dieRolledAt),
        };
      }
    }
    // Players are remembered by name (live state + departed players whose
    // seat a returning player should find again).
    const liveByName = new Map<string, PlayerState>();
    for (const player of this.state.players.values()) liveByName.set(player.name, player);
    const players: PlayerSnapshot[] = [...this.rememberedSeats.entries()].map(([name, seat]) => ({
      name,
      color: seat.color,
      seat: seat.seat,
      isHost: liveByName.get(name)?.isHost ?? false,
    }));
    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      roomCode: this.state.code,
      createdAt: Number(this.state.createdAt),
      savedAt: Date.now(),
      objects,
      players,
      dieValues,
    };
  }

  /** Full state for a fresh join or reconnect (secret-hand filtered). */
  private sendTableResync(client: Client): void {
    const objects: ObjectDef[] = [];
    for (const os of this.state.objects.values()) {
      objects.push(sanitizeObjectForClient(this.objectDefFromState(os), client.sessionId));
    }
    client.send('tableResync', {
      type: 'tableResync',
      roomCode: this.state.code,
      objects,
      serverTime: Date.now(),
    } satisfies TableResyncMessage);
  }

  /** Merges an accepted transform frame into the last-known transform. */
  private rememberTransform(id: string, position: unknown, rotation: unknown): void {
    const current = this.lastTransforms.get(id) ?? sanitizeTransform(null);
    this.lastTransforms.set(id, sanitizeTransform({ ...current, position, rotation } as Partial<Transform>));
  }

  // ---------- B4: pending ownership across reconnection ----------

  /** Marks every object owned by `playerId` as pending (owner gone). */
  private markOwnershipGone(playerId: string): void {
    const now = Date.now();
    for (const own of this.ownership.values()) {
      if (own.ownerId === playerId) own.ownerGoneSince = now;
    }
  }

  /** Clears the pending flag after a successful reconnect. */
  private clearOwnershipGone(playerId: string): void {
    for (const own of this.ownership.values()) {
      if (own.ownerId === playerId) own.ownerGoneSince = null;
    }
  }

  /**
   * Releases every object owned by `playerId` (reconnection window expired or
   * consented leave) and broadcasts the release to everyone.
   */
  private releaseOwnershipOf(playerId: string): void {
    for (const [objectId, own] of this.ownership.entries()) {
      if (own.ownerId !== playerId) continue;
      own.ownerId = null;
      own.claimToken = null;
      own.ownerGoneSince = null;
      const os = this.state.objects.get(objectId);
      if (os) os.ownerId = ownerIdToSchema(null);
      this.broadcast('objectRelease', {
        type: 'objectRelease',
        objectId,
        playerId,
      } satisfies StateChannelMessage);
      logger.info(`[table:${this.roomId}] released ${objectId} (owner ${playerId} gone)`);
    }
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
