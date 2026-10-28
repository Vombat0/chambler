import { describe, expect, test } from 'vitest';
import {
  DiceError,
  createRng,
  parseNotation,
  roll,
  rollParsed,
  secureSeed,
  type ParsedNotation,
} from './dice.js';

const expectDiceError = (fn: () => unknown, code: string): void => {
  try {
    fn();
    throw new Error('expected a DiceError');
  } catch (error) {
    expect(error).toBeInstanceOf(DiceError);
    expect((error as DiceError).code).toBe(code);
    expect((error as DiceError).message.length).toBeGreaterThan(0);
  }
};

describe('parseNotation', () => {
  test('parses a plain pool', () => {
    const parsed = parseNotation('1d6');
    expect(parsed).toMatchObject({ count: 1, sides: 6, modifier: 0, mult: 1, table: false });
  });

  test('parses count, sides and modifier', () => {
    expect(parseNotation('2d6+1')).toMatchObject({ count: 2, sides: 6, modifier: 1 });
  });

  test('parses keep-highest', () => {
    expect(parseNotation('4d6kh3')).toMatchObject({
      count: 4,
      sides: 6,
      keep: { mode: 'highest', n: 3 },
    });
  });

  test('parses keep-lowest', () => {
    expect(parseNotation('2d20kl1')).toMatchObject({
      count: 2,
      sides: 20,
      keep: { mode: 'lowest', n: 1 },
    });
  });

  test('parses a negative modifier', () => {
    expect(parseNotation('3d8-2')).toMatchObject({ count: 3, sides: 8, modifier: -2 });
  });

  test('parses a multiplier', () => {
    expect(parseNotation('1d6x3')).toMatchObject({ count: 1, sides: 6, mult: 3 });
  });

  test('normalizes case and whitespace', () => {
    expect(parseNotation('  2D6+1 ').notation).toBe('2d6+1');
  });

  test('d66 is the two-d6 hundreds table', () => {
    expect(parseNotation('d66')).toMatchObject({ count: 2, sides: 6, table: true });
  });

  test('1d66 is a normal 66-sided die', () => {
    expect(parseNotation('1d66')).toMatchObject({ count: 1, sides: 66, table: false });
  });

  test('rejects garbage notation', () => {
    expectDiceError(() => parseNotation('banana'), 'INVALID_NOTATION');
    expectDiceError(() => parseNotation('d'), 'INVALID_NOTATION');
    expectDiceError(() => parseNotation('2d6kh'), 'INVALID_NOTATION');
    expectDiceError(() => parseNotation(''), 'INVALID_NOTATION');
  });

  test('rejects out-of-range counts and sides', () => {
    expectDiceError(() => parseNotation('0d6'), 'COUNT_RANGE');
    expectDiceError(() => parseNotation('101d6'), 'COUNT_RANGE');
    expectDiceError(() => parseNotation('1d0'), 'SIDES_RANGE');
    expectDiceError(() => parseNotation('1d1001'), 'SIDES_RANGE');
  });

  test('rejects keep counts outside the pool', () => {
    expectDiceError(() => parseNotation('2d6kh0'), 'KEEP_RANGE');
    expectDiceError(() => parseNotation('2d6kh3'), 'KEEP_RANGE');
  });

  test('rejects out-of-range modifier and multiplier', () => {
    expectDiceError(() => parseNotation('1d6+10001'), 'MODIFIER_RANGE');
    expectDiceError(() => parseNotation('1d6x0'), 'MULT_RANGE');
    expectDiceError(() => parseNotation('1d6x1001'), 'MULT_RANGE');
  });

  test('rejects keep/modifier on the d66 table', () => {
    expectDiceError(() => parseNotation('d66kh1'), 'INVALID_NOTATION');
    expectDiceError(() => parseNotation('d66+1'), 'INVALID_NOTATION');
  });
});

describe('roll', () => {
  test('same seed and notation produce the same result', () => {
    const a = roll('4d6kh3+2', { seed: 'replay-42' });
    const b = roll('4d6kh3+2', { seed: 'replay-42' });
    expect(a).toEqual(b);
  });

  test('different seeds diverge across a sequence', () => {
    const first = Array.from({ length: 20 }, () => roll('2d20kl1', { seed: 7 }));
    const second = Array.from({ length: 20 }, () => roll('2d20kl1', { seed: 8 }));
    expect(first).not.toEqual(second);
  });

  test('numeric and string seeds are both deterministic', () => {
    expect(roll('1d6', { seed: 99 })).toEqual(roll('1d6', { seed: 99 }));
    expect(roll('1d6', { seed: 'abc' })).toEqual(roll('1d6', { seed: 'abc' }));
  });

  test('kh keeps exactly the highest dice', () => {
    const result = roll('4d6kh3', { seed: 'keep-high' });
    expect(result.dice).toHaveLength(4);
    expect(result.dice.filter((die) => die.kept)).toHaveLength(3);
    const kept = result.dice.filter((die) => die.kept).map((die) => die.value);
    const dropped = result.dice.filter((die) => !die.kept).map((die) => die.value);
    expect(dropped).toHaveLength(1);
    expect(Math.min(...kept)).toBeGreaterThanOrEqual(Math.max(...dropped));
    expect(result.total).toBe(kept.reduce((sum, value) => sum + value, 0));
  });

  test('kl keeps exactly the lowest dice', () => {
    const result = roll('2d20kl1', { seed: 'keep-low' });
    const kept = result.dice.filter((die) => die.kept);
    const dropped = result.dice.filter((die) => !die.kept);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(1);
    expect(kept[0]!.value).toBeLessThanOrEqual(dropped[0]!.value);
    expect(result.total).toBe(kept[0]!.value);
  });

  test('applies modifier then multiplier', () => {
    const result = roll('3d8-2x3', { seed: 'math' });
    const sum = result.dice.reduce((acc, die) => acc + die.value, 0);
    expect(result.total).toBe((sum - 2) * 3);
    expect(result.modifier).toBe(-2);
    expect(result.mult).toBe(3);
  });

  test('d66 yields a two-digit table result', () => {
    for (let i = 0; i < 100; i += 1) {
      const result = roll('d66', { seed: i });
      expect(result.total).toBeGreaterThanOrEqual(11);
      expect(result.total).toBeLessThanOrEqual(66);
      expect(result.total % 10).toBeGreaterThanOrEqual(1);
      expect(result.total % 10).toBeLessThanOrEqual(6);
      expect(Math.floor(result.total / 10)).toBeGreaterThanOrEqual(1);
      expect(Math.floor(result.total / 10)).toBeLessThanOrEqual(6);
      expect(result.dice).toHaveLength(2);
    }
  });

  test('a one-sided die always shows 1', () => {
    const result = roll('5d1', { seed: 'ones' });
    expect(result.dice.every((die) => die.value === 1)).toBe(true);
    expect(result.total).toBe(5);
  });

  test('results survive JSON serialization', () => {
    const result = roll('4d6kh3+2', { seed: 'json' });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  test('rollParsed is replayable from a parsed notation', () => {
    const parsed: ParsedNotation = parseNotation('2d6+1');
    const first = rollParsed(parsed, createRng('replay'));
    const second = rollParsed(parsed, createRng('replay'));
    expect(first).toEqual(second);
  });

  test('secureSeed returns a 32-bit integer', () => {
    const seed = secureSeed();
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });

  test('rejects an invalid seed', () => {
    expectDiceError(() => createRng(Number.NaN), 'SEED_INVALID');
    expectDiceError(() => createRng(''), 'SEED_INVALID');
  });

  test(
    '1d6 is fair: 600k rolls keep every face at 16.67% ±1%',
    () => {
      const parsed = parseNotation('1d6');
      const rng = createRng('fairness-600k');
      const counts = [0, 0, 0, 0, 0, 0];
      const rolls = 600_000;
      for (let i = 0; i < rolls; i += 1) {
        const result = rollParsed(parsed, rng);
        counts[result.dice[0]!.value - 1]! += 1;
      }
      for (const count of counts) {
        const ratio = count / rolls;
        expect(ratio).toBeGreaterThanOrEqual(0.1567);
        expect(ratio).toBeLessThanOrEqual(0.1767);
      }
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(rolls);
    },
    30_000,
  );
});
