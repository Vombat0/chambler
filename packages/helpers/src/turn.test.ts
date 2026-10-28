import { describe, expect, test } from 'vitest';
import { MAX_TURN_PLAYERS, TurnError, TurnOrder, type TurnErrorCode } from './turn.js';

const expectTurnError = (fn: () => unknown, code: TurnErrorCode): void => {
  try {
    fn();
    throw new Error('expected a TurnError');
  } catch (error) {
    expect(error).toBeInstanceOf(TurnError);
    expect((error as TurnError).code).toBe(code);
  }
};

describe('TurnOrder basic cycle', () => {
  test('starts on the first player in round 1', () => {
    const order = new TurnOrder({ players: ['ann', 'ben', 'cat'] });
    expect(order.current()).toBe('ann');
    expect(order.round).toBe(1);
    expect(order.direction).toBe(1);
  });

  test('cycles through players and increments the round on wrap', () => {
    const order = new TurnOrder({ players: ['ann', 'ben', 'cat'] });
    expect(order.next()).toBe('ben');
    expect(order.round).toBe(1);
    expect(order.next()).toBe('cat');
    expect(order.round).toBe(1);
    expect(order.next()).toBe('ann');
    expect(order.round).toBe(2);
    expect(order.next()).toBe('ben');
    expect(order.round).toBe(2);
  });

  test('supports up to eight players', () => {
    const eight = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const order = new TurnOrder({ players: eight });
    expect(order.activePlayers()).toHaveLength(MAX_TURN_PLAYERS);
    for (const player of eight.slice(1)) expect(order.next()).toBe(player);
  });

  test('rejects nine players, duplicates and empty input', () => {
    const nine = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'];
    expectTurnError(() => new TurnOrder({ players: nine }), 'TOO_MANY_PLAYERS');
    expectTurnError(() => new TurnOrder({ players: ['ann', 'ann'] }), 'DUPLICATE_PLAYER');
    expectTurnError(() => new TurnOrder({ players: [] }), 'NO_PLAYERS');
  });
});

describe('TurnOrder direction', () => {
  test('reverse makes play counter-clockwise', () => {
    const order = new TurnOrder({ players: ['ann', 'ben', 'cat'] });
    order.next();
    expect(order.current()).toBe('ben');
    order.reverse();
    expect(order.direction).toBe(-1);
    expect(order.next()).toBe('ann');
    expect(order.round).toBe(1);
  });

  test('reversing at the first player wraps backwards', () => {
    const order = new TurnOrder({ players: ['ann', 'ben', 'cat'] });
    order.reverse();
    expect(order.next()).toBe('cat');
    expect(order.round).toBe(2);
    expect(order.next()).toBe('ben');
    expect(order.round).toBe(2);
  });
});

describe('TurnOrder skip and extra turn', () => {
  test('skip removes the marked player from the upcoming cycle', () => {
    const order = new TurnOrder({ players: ['ann', 'ben', 'cat'] });
    order.skip('ben');
    expect(order.next()).toBe('cat');
    expect(order.round).toBe(1);
    expect(order.next()).toBe('ann');
    expect(order.round).toBe(2);
    expect(order.next()).toBe('ben');
  });

  test('skip defaults to the current player', () => {
    const order = new TurnOrder({ players: ['ann', 'ben', 'cat'] });
    order.skip();
    expect(order.next()).toBe('ben');
    expect(order.next()).toBe('cat');
    expect(order.next()).toBe('ben');
    expect(order.round).toBe(2);
  });

  test('extra turn repeats the current player exactly once', () => {
    const order = new TurnOrder({ players: ['ann', 'ben'] });
    order.extra();
    expect(order.next()).toBe('ann');
    expect(order.round).toBe(1);
    expect(order.next()).toBe('ben');
    expect(order.next()).toBe('ann');
    expect(order.round).toBe(2);
  });

  test('extra turn cannot be stacked', () => {
    const order = new TurnOrder({ players: ['ann', 'ben'] });
    order.extra();
    order.extra();
    expect(order.next()).toBe('ann');
    expect(order.next()).toBe('ben');
  });

  test('skip rejects unknown and eliminated players', () => {
    const order = new TurnOrder({ players: ['ann', 'ben'] });
    expectTurnError(() => order.skip('zoe'), 'UNKNOWN_PLAYER');
    order.eliminate('ben');
    expectTurnError(() => order.skip('ben'), 'PLAYER_ELIMINATED');
  });
});

describe('TurnOrder elimination', () => {
  test('eliminating a non-current player keeps the order intact', () => {
    const order = new TurnOrder({ players: ['ann', 'ben', 'cat', 'dan'] });
    order.eliminate('cat');
    expect(order.activePlayers()).toEqual(['ann', 'ben', 'dan']);
    expect(order.next()).toBe('ben');
    expect(order.next()).toBe('dan');
    expect(order.next()).toBe('ann');
    expect(order.round).toBe(2);
  });

  test('eliminating the current player advances correctly', () => {
    const order = new TurnOrder({ players: ['ann', 'ben', 'cat', 'dan'] });
    order.next();
    expect(order.current()).toBe('ben');
    order.eliminate('ben');
    expect(order.current()).toBe('cat');
    expect(order.round).toBe(1);
    order.eliminate('cat');
    expect(order.current()).toBe('dan');
    order.next();
    expect(order.current()).toBe('ann');
    expect(order.round).toBe(2);
  });

  test('the last remaining player keeps playing and the round advances', () => {
    const order = new TurnOrder({ players: ['ann', 'ben', 'cat'] });
    order.eliminate('ben');
    order.eliminate('cat');
    expect(order.activePlayers()).toEqual(['ann']);
    expect(order.current()).toBe('ann');
    expect(order.next()).toBe('ann');
    expect(order.round).toBe(2);
  });

  test('eliminating everyone ends the game', () => {
    const order = new TurnOrder({ players: ['ann', 'ben'] });
    order.eliminate('ann');
    order.eliminate('ben');
    expect(order.activePlayers()).toEqual([]);
    expectTurnError(() => order.next(), 'GAME_OVER');
    expectTurnError(() => order.current(), 'GAME_OVER');
  });

  test('elimination is idempotent', () => {
    const order = new TurnOrder({ players: ['ann', 'ben'] });
    order.eliminate('ben');
    order.eliminate('ben');
    expect(order.activePlayers()).toEqual(['ann']);
    expect(order.isEliminated('ben')).toBe(true);
  });
});

describe('TurnOrder determinism and serialization', () => {
  test('the same operation sequence yields the same order', () => {
    const run = (): string[] => {
      const order = new TurnOrder({ players: ['ann', 'ben', 'cat', 'dan'] });
      const seen: string[] = [order.current()];
      order.skip('cat');
      order.extra();
      seen.push(order.next());
      seen.push(order.next());
      order.reverse();
      order.eliminate('ben');
      seen.push(order.next());
      seen.push(order.next());
      return seen;
    };
    expect(run()).toEqual(run());
  });

  test('serializes and restores the rotation', () => {
    const order = new TurnOrder({ players: ['ann', 'ben', 'cat'] });
    order.next();
    order.skip('ann');
    order.extra();
    const restored = TurnOrder.fromJSON(JSON.parse(JSON.stringify(order.toJSON())));

    expect(restored.toJSON()).toEqual(order.toJSON());
    expect(restored.next()).toBe(order.next());
    expect(restored.round).toBe(order.round);
    expect(restored.direction).toBe(order.direction);
  });
});
