import { describe, expect, test } from 'vitest';
import { ScoreError, Scoreboard, type ScoreErrorCode } from './score.js';

const expectScoreError = (fn: () => unknown, code: ScoreErrorCode): void => {
  try {
    fn();
    throw new Error('expected a ScoreError');
  } catch (error) {
    expect(error).toBeInstanceOf(ScoreError);
    expect((error as ScoreError).code).toBe(code);
  }
};

describe('Scoreboard scoring', () => {
  test('starts everyone at zero', () => {
    const board = new Scoreboard({ players: ['ann', 'ben', 'cat'] });
    expect(board.playerIds).toEqual(['ann', 'ben', 'cat']);
    expect(board.scoreOf('ann')).toBe(0);
    expect(board.round).toBe(1);
  });

  test('adds points per player', () => {
    const board = new Scoreboard({ players: ['ann', 'ben'] });
    board.add('ann', 10, { round: 1, reason: 'trick' });
    board.add('ben', 4, { round: 1 });
    expect(board.scoreOf('ann')).toBe(10);
    expect(board.scoreOf('ben')).toBe(4);
  });

  test('applies minimum and maximum limits', () => {
    const board = new Scoreboard({ players: ['ann'], min: 0, max: 20 });
    expect(board.add('ann', 15)).toBe(15);
    expect(board.add('ann', 15)).toBe(5);
    expect(board.scoreOf('ann')).toBe(20);
    expect(board.add('ann', -50)).toBe(-20);
    expect(board.scoreOf('ann')).toBe(0);
  });

  test('set assigns an absolute clamped score', () => {
    const board = new Scoreboard({ players: ['ann'], min: 0, max: 10 });
    expect(board.set('ann', 7)).toBe(7);
    expect(board.set('ann', 99)).toBe(3);
    expect(board.scoreOf('ann')).toBe(10);
  });

  test('tracks per-round deltas including untouched players', () => {
    const board = new Scoreboard({ players: ['ann', 'ben'] });
    board.add('ann', 5, { round: 1 });
    board.add('ben', 2, { round: 1 });
    board.add('ann', -1, { round: 2 });
    expect(board.deltasForRound(1)).toEqual({ ann: 5, ben: 2 });
    expect(board.deltasForRound(2)).toEqual({ ann: -1, ben: 0 });
    expect(board.deltasForRound(3)).toEqual({ ann: 0, ben: 0 });
    expect(board.round).toBe(2);
  });

  test('clamped deltas are recorded as actually applied', () => {
    const board = new Scoreboard({ players: ['ann'], max: 5 });
    board.add('ann', 10, { round: 3 });
    expect(board.deltasForRound(3)).toEqual({ ann: 5 });
  });
});

describe('Scoreboard undo', () => {
  test('undo reverts only the last change', () => {
    const board = new Scoreboard({ players: ['ann', 'ben'] });
    board.add('ann', 10, { round: 1 });
    board.add('ben', 4, { round: 1 });
    board.add('ann', 3, { round: 2 });

    expect(board.undo()).toBe(true);
    expect(board.scoreOf('ann')).toBe(10);
    expect(board.scoreOf('ben')).toBe(4);
    expect(board.round).toBe(1);
    expect(board.deltasForRound(2)).toEqual({ ann: 0, ben: 0 });

    expect(board.undo()).toBe(true);
    expect(board.scoreOf('ben')).toBe(0);
    expect(board.undo()).toBe(true);
    expect(board.scoreOf('ann')).toBe(0);
    expect(board.undo()).toBe(false);
  });

  test('undo restores set operations too', () => {
    const board = new Scoreboard({ players: ['ann'] });
    board.add('ann', 5);
    board.set('ann', 12);
    board.undo();
    expect(board.scoreOf('ann')).toBe(5);
  });
});

describe('Scoreboard ranking', () => {
  test('ranks players by score', () => {
    const board = new Scoreboard({ players: ['ann', 'ben', 'cat'] });
    board.add('ann', 5);
    board.add('ben', 12);
    board.add('cat', 7);
    expect(board.ranking().map((entry) => [entry.player, entry.rank])).toEqual([
      ['ben', 1],
      ['cat', 2],
      ['ann', 3],
    ]);
  });

  test('ties share a rank and are marked', () => {
    const board = new Scoreboard({ players: ['ann', 'ben', 'cat', 'dan'] });
    board.add('ann', 10);
    board.add('ben', 10);
    board.add('cat', 5);
    board.add('dan', 10);
    expect(board.ranking()).toEqual([
      { player: 'ann', score: 10, rank: 1, tied: true },
      { player: 'ben', score: 10, rank: 1, tied: true },
      { player: 'dan', score: 10, rank: 1, tied: true },
      { player: 'cat', score: 5, rank: 4, tied: false },
    ]);
  });
});

describe('Scoreboard determinism and serialization', () => {
  test('the same operation sequence yields the same board', () => {
    const run = (): Scoreboard => {
      const board = new Scoreboard({ players: ['ann', 'ben'], min: 0, max: 50 });
      board.add('ann', 10, { round: 1 });
      board.add('ben', 3, { round: 1 });
      board.add('ann', 7, { round: 2 });
      board.add('ben', 12, { round: 2 });
      return board;
    };
    expect(run().toJSON()).toEqual(run().toJSON());
  });

  test('serializes and restores scores, deltas and limits', () => {
    const board = new Scoreboard({ players: ['ann', 'ben'], min: 0, max: 100 });
    board.add('ann', 10, { round: 1 });
    board.add('ben', 25, { round: 2 });
    const restored = Scoreboard.fromJSON(JSON.parse(JSON.stringify(board.toJSON())));

    expect(restored.toJSON()).toEqual(board.toJSON());
    expect(restored.ranking()).toEqual(board.ranking());
    expect(restored.deltasForRound(2)).toEqual({ ann: 0, ben: 25 });
    expect(restored.scoreOf('ann')).toBe(10);
  });
});

describe('Scoreboard validation', () => {
  test('rejects unknown players', () => {
    const board = new Scoreboard({ players: ['ann'] });
    expectScoreError(() => board.add('zoe', 1), 'UNKNOWN_PLAYER');
    expectScoreError(() => board.scoreOf('zoe'), 'UNKNOWN_PLAYER');
  });

  test('rejects fractional deltas and scores', () => {
    const board = new Scoreboard({ players: ['ann'] });
    expectScoreError(() => board.add('ann', 1.5), 'INVALID_DELTA');
    expectScoreError(() => board.set('ann', 2.5), 'INVALID_VALUE');
  });

  test('rejects duplicate players and impossible limits', () => {
    expectScoreError(() => new Scoreboard({ players: ['ann', 'ann'] }), 'DUPLICATE_PLAYER');
    expectScoreError(() => new Scoreboard({ players: ['ann'], min: 10, max: 5 }), 'INVALID_LIMIT');
    expectScoreError(() => new Scoreboard({ players: [] }), 'INVALID_STATE');
  });
});
