/**
 * Deterministic scoreboard: per-player scores, per-round deltas, limits,
 * ranking with ties, and single-step undo. Fully JSON serializable.
 */

export type ScoreErrorCode =
  | 'UNKNOWN_PLAYER'
  | 'DUPLICATE_PLAYER'
  | 'INVALID_PLAYER'
  | 'INVALID_DELTA'
  | 'INVALID_VALUE'
  | 'INVALID_LIMIT'
  | 'INVALID_ROUND'
  | 'INVALID_STATE';

export class ScoreError extends Error {
  readonly code: ScoreErrorCode;

  constructor(code: ScoreErrorCode, message: string) {
    super(message);
    this.name = 'ScoreError';
    this.code = code;
  }
}

export interface ScoreboardOptions {
  players: readonly string[];
  min?: number | null;
  max?: number | null;
}

export interface ScoreChangeOptions {
  /** Round the change belongs to; defaults to the current round. */
  round?: number;
  reason?: string;
}

export interface RankEntry {
  player: string;
  score: number;
  /** Competition rank: 1, 1, 3 for a two-way tie at the top. */
  rank: number;
  tied: boolean;
}

export interface RoundDelta {
  round: number;
  player: string;
  delta: number;
}

export interface ScoreboardJSON {
  players: string[];
  scores: Array<[string, number]>;
  deltas: RoundDelta[];
  min: number | null;
  max: number | null;
  round: number;
}

interface Snapshot {
  scores: Array<[string, number]>;
  deltas: RoundDelta[];
  round: number;
}

function clamp(value: number, min: number | null, max: number | null): number {
  let result = value;
  if (min !== null && result < min) result = min;
  if (max !== null && result > max) result = max;
  return result;
}

function assertInteger(
  value: number,
  code: 'INVALID_DELTA' | 'INVALID_VALUE' | 'INVALID_LIMIT' | 'INVALID_ROUND' | 'INVALID_STATE',
  label: string,
): void {
  if (!Number.isSafeInteger(value)) {
    throw new ScoreError(code, `${label} must be a safe integer, got ${String(value)}`);
  }
}

export class Scoreboard {
  readonly min: number | null;
  readonly max: number | null;

  private readonly players: string[];
  private readonly scores = new Map<string, number>();
  private deltas: RoundDelta[] = [];
  private history: Snapshot[] = [];
  private currentRound = 1;

  constructor(options: ScoreboardOptions) {
    const players = [...options.players];
    if (players.length === 0) {
      throw new ScoreError('INVALID_STATE', 'Scoreboard needs at least one player');
    }
    const seen = new Set<string>();
    for (const player of players) {
      if (typeof player !== 'string' || player.trim().length === 0) {
        throw new ScoreError('INVALID_PLAYER', 'Player id must be a non-empty string');
      }
      if (seen.has(player)) {
        throw new ScoreError('DUPLICATE_PLAYER', `Duplicate player "${player}"`);
      }
      seen.add(player);
    }

    const min = options.min ?? null;
    const max = options.max ?? null;
    if (min !== null) assertInteger(min, 'INVALID_LIMIT', 'Minimum');
    if (max !== null) assertInteger(max, 'INVALID_LIMIT', 'Maximum');
    if (min !== null && max !== null && min > max) {
      throw new ScoreError('INVALID_LIMIT', `Minimum ${min} exceeds maximum ${max}`);
    }

    this.players = players;
    this.min = min;
    this.max = max;
    for (const player of players) this.scores.set(player, 0);
  }

  get round(): number {
    return this.currentRound;
  }

  get playerIds(): readonly string[] {
    return this.players;
  }

  scoreOf(player: string): number {
    this.requirePlayer(player);
    return this.scores.get(player) ?? 0;
  }

  /** Adds `delta` (clamped to the limits) and returns the delta actually applied. */
  add(player: string, delta: number, options: ScoreChangeOptions = {}): number {
    this.requirePlayer(player);
    assertInteger(delta, 'INVALID_DELTA', 'Delta');
    return this.apply(player, this.scoreOf(player) + delta, delta, options);
  }

  /** Sets an absolute score (clamped) and returns the delta actually applied. */
  set(player: string, value: number, options: ScoreChangeOptions = {}): number {
    this.requirePlayer(player);
    assertInteger(value, 'INVALID_VALUE', 'Score');
    const current = this.scoreOf(player);
    return this.apply(player, value, value - current, options);
  }

  /** Reverts the most recent change. Returns false when there is nothing to undo. */
  undo(): boolean {
    const snapshot = this.history.pop();
    if (!snapshot) return false;
    this.scores.clear();
    for (const [player, score] of snapshot.scores) this.scores.set(player, score);
    this.deltas = snapshot.deltas;
    this.currentRound = snapshot.round;
    return true;
  }

  /** Net delta per player for one round, with every player present (0 when untouched). */
  deltasForRound(round: number): Record<string, number> {
    assertInteger(round, 'INVALID_ROUND', 'Round');
    const result: Record<string, number> = {};
    for (const player of this.players) result[player] = 0;
    for (const delta of this.deltas) {
      if (delta.round === round) result[delta.player] = (result[delta.player] ?? 0) + delta.delta;
    }
    return result;
  }

  /** Ranking, highest first. Ties share a rank (competition ranking). */
  ranking(): RankEntry[] {
    const ordered = this.players
      .map((player, index) => ({ player, score: this.scores.get(player) ?? 0, index }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    const result: RankEntry[] = [];
    for (let i = 0; i < ordered.length; i += 1) {
      const entry = ordered[i];
      if (!entry) continue;
      const previous = ordered[i - 1];
      const rank = previous && previous.score === entry.score ? (result[i - 1]?.rank ?? i + 1) : i + 1;
      const next = ordered[i + 1];
      const tied = Boolean(
        (previous && previous.score === entry.score) || (next && next.score === entry.score),
      );
      result.push({ player: entry.player, score: entry.score, rank, tied });
    }
    return result;
  }

  toJSON(): ScoreboardJSON {
    return {
      players: [...this.players],
      scores: this.players.map((player) => [player, this.scores.get(player) ?? 0]),
      deltas: this.deltas.map((delta) => ({ ...delta })),
      min: this.min,
      max: this.max,
      round: this.currentRound,
    };
  }

  static fromJSON(json: ScoreboardJSON): Scoreboard {
    if (!json || !Array.isArray(json.players) || !Array.isArray(json.scores)) {
      throw new ScoreError('INVALID_STATE', 'Invalid scoreboard JSON');
    }
    const board = new Scoreboard({ players: json.players, min: json.min, max: json.max });
    for (const [player, score] of json.scores) {
      if (!board.scores.has(player)) {
        throw new ScoreError('INVALID_STATE', `Scoreboard JSON references unknown player "${player}"`);
      }
      assertInteger(score, 'INVALID_STATE', 'Score');
      board.scores.set(player, clamp(score, board.min, board.max));
    }
    board.deltas = (json.deltas ?? []).map((delta) => ({ ...delta }));
    board.currentRound = json.round ?? 1;
    board.history = [];
    return board;
  }

  private apply(
    player: string,
    rawValue: number,
    _requestedDelta: number,
    options: ScoreChangeOptions,
  ): number {
    const round = options.round ?? this.currentRound;
    assertInteger(round, 'INVALID_ROUND', 'Round');
    if (round < 1) throw new ScoreError('INVALID_ROUND', `Round must be >= 1, got ${round}`);

    this.history.push({
      scores: this.players.map((id) => [id, this.scores.get(id) ?? 0]),
      deltas: this.deltas.map((delta) => ({ ...delta })),
      round: this.currentRound,
    });

    const before = this.scoreOf(player);
    const after = clamp(rawValue, this.min, this.max);
    this.scores.set(player, after);
    this.deltas.push({ round, player, delta: after - before });
    if (round > this.currentRound) this.currentRound = round;
    return after - before;
  }

  private requirePlayer(player: string): void {
    if (!this.scores.has(player)) {
      throw new ScoreError('UNKNOWN_PLAYER', `Unknown player "${player}"`);
    }
  }
}
