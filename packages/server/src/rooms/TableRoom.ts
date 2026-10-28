/**
 * TableRoom — lobby infrastructure (B1).
 *
 * Responsibilities:
 *  - room code (5 chars, unambiguous alphabet), used as the Colyseus roomId
 *  - player seats (0..7) + unique colours from a fixed palette
 *  - host = first player; hand-over to the oldest remaining player on leave
 *  - chat with length + rate limits
 *  - strict validation of every client message; unknown messages are logged and ignored
 *  - 30 s reconnection window (full reconnect flow is B4)
 *
 * NOT in scope: object state / transforms (B2), secret-hand filtering (B3),
 * persistence (B4).
 */
import { ErrorCode, Room, ServerError, logger, matchMaker } from 'colyseus';
import type { Client } from 'colyseus';
import type { StateChannelMessage } from '@chambler/shared';
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

export const TABLE_ROOM_NAME = 'table';

/** Data returned by `onAuth` and handed to `onJoin` as `client.auth`. */
export interface TableAuthData {
  name: string;
}

/** Room metadata exposed through matchmaking listings. */
export interface TableRoomMetadata {
  code: string;
  createdAt: number;
  maxPlayers: number;
  hostId: string;
}

/**
 * Codes currently being created in this process. The matchmaking driver only
 * knows about rooms after `onCreate`, so this closes the race between two
 * simultaneous creates.
 */
const codesInCreation = new Set<string>();

let defaultServerConfig: ServerConfig | null = null;

/** Called once by `createChamblerServer`; client options can never override it. */
export function configureTableRoom(config: ServerConfig): void {
  defaultServerConfig = config;
}

export class TableRoom extends Room<TableState, TableRoomMetadata, unknown, TableAuthData> {
  private config: ServerConfig = loadConfig();
  private readonly chatLimiter = new ChatRateLimiter();
  private readonly startedAt = Date.now();

  override async onCreate(): Promise<void> {
    this.config = defaultServerConfig ?? loadConfig();
    this.maxClients = this.config.maxPlayers;
    // Empty rooms close by themselves (Colyseus `autoDispose`).
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

    void this.setMetadata({
      code,
      createdAt: this.startedAt,
      maxPlayers: this.maxClients,
      hostId: '',
    });

    this.registerMessageHandlers();
    logger.info(`[table:${code}] created (max ${this.maxClients} players)`);
  }

  /** Room code generation is collision-free within this process and the driver. */
  private async claimRoomCode(): Promise<string> {
    const existing = new Set<string>();
    try {
      // Codes are never reused while a room is alive; the driver knows every
      // room of this process, `codesInCreation` covers concurrent creates.
      for (const room of await matchMaker.query({ name: TABLE_ROOM_NAME })) {
        existing.add(room.roomId);
      }
    } catch {
      // The driver may not be ready during tests; the in-process set still guards us.
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
    const seat = firstFreeSeat(
      players.map((player) => player.seat),
      this.maxClients,
    );
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

    this.broadcast(
      'join',
      { type: 'join', player: toPlayerInfo(player) } satisfies StateChannelMessage,
      { except: client },
    );
    logger.info(`[table:${this.roomId}] ${player.name} joined (seat ${player.seat})`);
  }

  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
    this.chatLimiter.reset(client.sessionId);

    // Reconnection window: only worth keeping a seat while somebody else is
    // still at the table. Full reconnect flow (tokens, state re-sync) is B4.
    if (!consented && this.config.reconnectionSeconds > 0 && this.hasOtherPlayers(client.sessionId)) {
      player.connected = false;
      try {
        const reconnected = await this.allowReconnection(client, this.config.reconnectionSeconds);
        const current = this.state.players.get(client.sessionId);
        if (current) {
          if (reconnected.sessionId !== current.id) {
            this.state.players.delete(current.id);
            current.id = reconnected.sessionId;
            this.state.players.set(reconnected.sessionId, current);
            if (this.state.hostId === client.sessionId) {
              this.state.hostId = current.id;
            }
          }
          current.connected = true;
        }
        return;
      } catch {
        // Window elapsed: fall through and release the seat.
      }
    }

    this.removePlayer(client.sessionId);
  }

  override onDispose(): void {
    codesInCreation.delete(this.state.code);
    this.chatLimiter.clear();
    logger.info(`[table:${this.roomId}] disposed`);
  }

  /* ------------------------------------------------------------------ */
  /* Messages                                                            */
  /* ------------------------------------------------------------------ */

  private registerMessageHandlers(): void {
    this.onMessage('chat', (client, payload) => this.handleChat(client, payload));
    this.onMessage('seat', (client, payload) => this.handleSeatChange(client, payload));
    this.onMessage('color', (client, payload) => this.handleColorChange(client, payload));

    // Anything not registered above is ignored on purpose (never trusted).
    this.onMessage('*', (client, type) => {
      logger.warn(
        `[table:${this.roomId}] ignoring unknown message "${describeMessageType(type)}" from ${client.sessionId}`,
      );
    });
  }

  private handleChat(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
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
    if (!player) {
      return;
    }
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
    player.seat = seat;
  }

  private handleColorChange(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }
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

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  private hasOtherPlayers(sessionId: string): boolean {
    for (const client of this.clients) {
      if (client.sessionId !== sessionId) {
        return true;
      }
    }
    return false;
  }

  /** Removes a player, frees their seat/colour and hands the host role over. */
  private removePlayer(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) {
      return;
    }
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

    this.broadcast('leave', {
      type: 'leave',
      playerId: player.id,
    } satisfies StateChannelMessage);
    logger.info(`[table:${this.roomId}] ${player.name} left (seat ${player.seat})`);
  }

  /** Oldest player by join time (ties broken by seat) — the host successor. */
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

  private sendError(client: Client, code: string, message: string): void {
    this.send(client, 'error', { code, message });
  }
}

/** Seat count available in a table (also the palette size). */
export const TABLE_MAX_SEATS = MAX_SEATS;
