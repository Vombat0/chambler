/**
 * Deterministic turn order: clockwise/counter-clockwise, skip, extra turn,
 * elimination and round counting. Up to 8 players.
 */

export type TurnErrorCode =
  | 'NO_PLAYERS'
  | 'TOO_MANY_PLAYERS'
  | 'DUPLICATE_PLAYER'
  | 'INVALID_PLAYER'
  | 'UNKNOWN_PLAYER'
  | 'PLAYER_ELIMINATED'
  | 'GAME_OVER'
  | 'INVALID_STATE';

export class TurnError extends Error {
  readonly code: TurnErrorCode;

  constructor(code: TurnErrorCode, message: string) {
    super(message);
    this.name = 'TurnError';
    this.code = code;
  }
}

export type Direction = 1 | -1;

export interface TurnOrderOptions {
  players: readonly string[];
  direction?: Direction;
}

export interface TurnOrderJSON {
  players: string[];
  eliminated: string[];
  currentIndex: number;
  direction: Direction;
  round: number;
  skipNext: string[];
  extraPending: boolean;
}

export const MAX_TURN_PLAYERS = 8;

export class TurnOrder {
  private readonly players: string[];
  private readonly eliminated = new Set<string>();
  private currentIndex = 0;
  private dir: Direction;
  private roundNumber = 1;
  private readonly skipNext = new Set<string>();
  private extraPending = false;

  constructor(options: TurnOrderOptions) {
    const players = [...options.players];
    if (players.length === 0) {
      throw new TurnError('NO_PLAYERS', 'Turn order needs at least one player');
    }
    if (players.length > MAX_TURN_PLAYERS) {
      throw new TurnError(
        'TOO_MANY_PLAYERS',
        `Turn order supports at most ${MAX_TURN_PLAYERS} players, got ${players.length}`,
      );
    }
    const seen = new Set<string>();
    for (const player of players) {
      if (typeof player !== 'string' || player.trim().length === 0) {
        throw new TurnError('INVALID_PLAYER', 'Player id must be a non-empty string');
      }
      if (seen.has(player)) {
        throw new TurnError('DUPLICATE_PLAYER', `Duplicate player "${player}"`);
      }
      seen.add(player);
    }
    this.players = players;
    this.dir = options.direction ?? 1;
    if (this.dir !== 1 && this.dir !== -1) {
      throw new TurnError('INVALID_STATE', `Direction must be 1 or -1, got ${String(this.dir)}`);
    }
  }

  get direction(): Direction {
    return this.dir;
  }

  get round(): number {
    return this.roundNumber;
  }

  get allPlayers(): readonly string[] {
    return this.players;
  }

  activePlayers(): string[] {
    return this.players.filter((player) => !this.eliminated.has(player));
  }

  isEliminated(player: string): boolean {
    this.requirePlayer(player);
    return this.eliminated.has(player);
  }

  current(): string {
    const player = this.players[this.currentIndex];
    if (player === undefined || this.eliminated.has(player)) {
      throw new TurnError('GAME_OVER', 'No active player to act');
    }
    return player;
  }

  /** Advances to the next active, non-skipped player. Wrapping increments the round. */
  next(): string {
    if (this.activePlayers().length === 0) {
      throw new TurnError('GAME_OVER', 'All players are eliminated');
    }
    if (this.extraPending) {
      this.extraPending = false;
      return this.current();
    }
    this.currentIndex = this.findNextIndex();
    return this.current();
  }

  /**
   * Marks a player to lose their next turn. Defaults to the current player;
   * the flag is consumed when the turn order reaches them.
   */
  skip(playerId?: string): void {
    const player = playerId ?? this.current();
    this.requirePlayer(player);
    if (this.eliminated.has(player)) {
      throw new TurnError('PLAYER_ELIMINATED', `Player "${player}" is eliminated`);
    }
    this.skipNext.add(player);
  }

  /** Grants the current player one extra turn; `next()` returns them again once. */
  extra(): void {
    this.current();
    this.extraPending = true;
  }

  /** Removes a player from the rotation; advances if it was their turn. */
  eliminate(playerId: string): void {
    this.requirePlayer(playerId);
    if (this.eliminated.has(playerId)) return;
    this.eliminated.add(playerId);
    this.skipNext.delete(playerId);
    if (this.players[this.currentIndex] === playerId && this.activePlayers().length > 0) {
      this.currentIndex = this.findNextIndex();
    }
  }

  /** Flips the direction of play. */
  reverse(): void {
    this.dir = this.dir === 1 ? -1 : 1;
  }

  toJSON(): TurnOrderJSON {
    return {
      players: [...this.players],
      eliminated: [...this.eliminated],
      currentIndex: this.currentIndex,
      direction: this.dir,
      round: this.roundNumber,
      skipNext: [...this.skipNext],
      extraPending: this.extraPending,
    };
  }

  static fromJSON(json: TurnOrderJSON): TurnOrder {
    if (!json || !Array.isArray(json.players)) {
      throw new TurnError('INVALID_STATE', 'Invalid turn order JSON');
    }
    const order = new TurnOrder({ players: json.players, direction: json.direction });
    for (const player of json.eliminated ?? []) {
      if (!order.players.includes(player)) {
        throw new TurnError('INVALID_STATE', `Unknown eliminated player "${player}"`);
      }
      order.eliminated.add(player);
    }
    if (!Number.isSafeInteger(json.currentIndex) || json.currentIndex < 0 || json.currentIndex >= order.players.length) {
      throw new TurnError('INVALID_STATE', 'Invalid currentIndex');
    }
    order.currentIndex = json.currentIndex;
    if (!Number.isSafeInteger(json.round) || json.round < 1) {
      throw new TurnError('INVALID_STATE', 'Invalid round');
    }
    order.roundNumber = json.round;
    for (const player of json.skipNext ?? []) order.skipNext.add(player);
    order.extraPending = Boolean(json.extraPending);
    return order;
  }

  private findNextIndex(): number {
    const size = this.players.length;
    const guard = size * (this.skipNext.size + 2) + size;
    let index = this.currentIndex;
    for (let step = 0; step < guard; step += 1) {
      index += this.dir;
      let wrapped = false;
      if (index >= size) {
        index = 0;
        wrapped = true;
      } else if (index < 0) {
        index = size - 1;
        wrapped = true;
      }
      if (wrapped) this.roundNumber += 1;
      const player = this.players[index];
      if (player === undefined) continue;
      if (this.eliminated.has(player)) continue;
      if (this.skipNext.has(player)) {
        this.skipNext.delete(player);
        continue;
      }
      return index;
    }
    throw new TurnError('GAME_OVER', 'No reachable active player');
  }

  private requirePlayer(player: string): void {
    if (!this.players.includes(player)) {
      throw new TurnError('UNKNOWN_PLAYER', `Unknown player "${player}"`);
    }
  }
}
