import { describe, expect, it } from 'vitest';
import { dieFaceCount, validateDieResult, type DieResultContext } from './dieResult.js';

function ctx(overrides: Partial<DieResultContext> = {}): DieResultContext {
  return {
    kind: 'die',
    faces: 6,
    value: 4,
    isOwner: true,
    claimToken: 'claim_1',
    previous: null,
    now: 10_000,
    ...overrides,
  };
}

describe('dieFaceCount', () => {
  it('defaults to a d6', () => {
    expect(dieFaceCount({})).toBe(6);
    expect(dieFaceCount(null)).toBe(6);
  });

  it('reads faces / sides / diceFaces, including numeric strings', () => {
    expect(dieFaceCount({ faces: 20 })).toBe(20);
    expect(dieFaceCount({ sides: 12 })).toBe(12);
    expect(dieFaceCount({ diceFaces: 8 })).toBe(8);
    expect(dieFaceCount({ faces: '10' })).toBe(10);
  });

  it('rejects nonsense face counts', () => {
    expect(dieFaceCount({ faces: 1 })).toBe(6);
    expect(dieFaceCount({ faces: 5000 })).toBe(6);
    expect(dieFaceCount({ faces: 6.5 })).toBe(6);
    expect(dieFaceCount({ faces: 'many' })).toBe(6);
  });
});

describe('validateDieResult', () => {
  it('accepts a valid result', () => {
    expect(validateDieResult(ctx())).toEqual({ ok: true, value: 4, faces: 6 });
  });

  it('accepts both bounds of a d20', () => {
    expect(validateDieResult(ctx({ faces: 20, value: 1 })).ok).toBe(true);
    expect(validateDieResult(ctx({ faces: 20, value: 20 })).ok).toBe(true);
  });

  it('rejects an object that is not a die', () => {
    const verdict = validateDieResult(ctx({ kind: 'card' }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DIE_NOT_DIE');
  });

  it('rejects a report from a player who does not own the die', () => {
    const verdict = validateDieResult(ctx({ isOwner: false }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DIE_FORBIDDEN');
  });

  it('rejects out-of-range, fractional and non-numeric values', () => {
    for (const value of [0, 7, -1, 3.5, '4', null, undefined, Number.NaN]) {
      const verdict = validateDieResult(ctx({ value }));
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe('DIE_RESULT_INVALID');
    }
  });

  it('rejects a contradictory re-report inside the same throw', () => {
    const verdict = validateDieResult(
      ctx({ value: 1, previous: { value: 5, claimToken: 'claim_1', at: 9_800 } }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('DIE_RESULT_CONFLICT');
  });

  it('accepts the same value again (idempotent re-report)', () => {
    const verdict = validateDieResult(
      ctx({ value: 5, previous: { value: 5, claimToken: 'claim_1', at: 9_800 } }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('accepts a different value in a new claim epoch (die was picked up)', () => {
    const verdict = validateDieResult(
      ctx({ value: 2, claimToken: 'claim_2', previous: { value: 5, claimToken: 'claim_1', at: 9_900 } }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('accepts a different value after the conflict window', () => {
    const verdict = validateDieResult(
      ctx({ value: 2, previous: { value: 5, claimToken: 'claim_1', at: 1_000 } }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('respects a custom conflict window', () => {
    const verdict = validateDieResult(
      ctx({
        value: 2,
        previous: { value: 5, claimToken: 'claim_1', at: 9_000 },
        conflictWindowMs: 200,
      }),
    );
    expect(verdict.ok).toBe(true);
  });
});
