/**
 * Synchronised room state for a table (lobby only).
 *
 * SCOPE (B1): players + room metadata. No objects, no transforms (B2), no
 * persisted saves (B4). The client receives the full state on join and
 * incremental patches afterwards.
 */
import { MapSchema, Schema, type } from '@colyseus/schema';
import type { PlayerInfo } from '@chambler/shared';

/** One seated player. Mirrors @chambler/shared `PlayerInfo` plus host/connection flags. */
export class PlayerState extends Schema {
  @type('string') id = '';
  @type('string') name = '';
  @type('string') color = '';
  @type('uint8') seat = 0;
  @type('boolean') isHost = false;
  @type('boolean') connected = true;
  /** Server clock (ms) when the player took their seat; used for host hand-over. */
  @type('uint64') joinedAt = 0;
}

/** Room-level metadata shared with every client. */
export class TableState extends Schema {
  /** The 5-character room code; identical to the Colyseus roomId. */
  @type('string') code = '';
  /** sessionId of the current host. */
  @type('string') hostId = '';
  @type('uint8') maxPlayers = 8;
  @type('uint64') createdAt = 0;
  /** sessionId -> player. */
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}

/** Shared-protocol view of a player (`join`/`leave` messages, HTTP lobby lookup). */
export function toPlayerInfo(player: PlayerState): PlayerInfo {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    seat: player.seat,
  };
}
