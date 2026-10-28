import { describe, expect, it } from 'vitest';
import { PLAYER_NAME_MAX_LENGTH, uniquePlayerName, validatePlayerName } from './names.js';

describe('player names', () => {
  it('trims and collapses whitespace', () => {
    expect(validatePlayerName('  Ada   Lovelace  ')).toEqual({ ok: true, name: 'Ada Lovelace' });
  });

  it('rejects empty, non-string and whitespace-only names', () => {
    expect(validatePlayerName('   ')).toMatchObject({ ok: false, code: 'NAME_REQUIRED' });
    expect(validatePlayerName('')).toMatchObject({ ok: false, code: 'NAME_REQUIRED' });
    expect(validatePlayerName(undefined)).toMatchObject({ ok: false, code: 'NAME_REQUIRED' });
    expect(validatePlayerName(7)).toMatchObject({ ok: false, code: 'NAME_REQUIRED' });
  });

  it('rejects control characters (log spoofing / invisible text)', () => {
    expect(validatePlayerName('Ada\u0000')).toMatchObject({ ok: false, code: 'NAME_INVALID' });
    expect(validatePlayerName('Ada\u202Eevil')).toMatchObject({ ok: false, code: 'NAME_INVALID' });
    expect(validatePlayerName('Ada\u200B')).toMatchObject({ ok: false, code: 'NAME_INVALID' });
  });

  it('enforces the maximum length', () => {
    expect(validatePlayerName('a'.repeat(PLAYER_NAME_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(validatePlayerName('a'.repeat(PLAYER_NAME_MAX_LENGTH + 1))).toMatchObject({
      ok: false,
      code: 'NAME_TOO_LONG',
    });
  });

  it('appends a numeric suffix when a name is taken (case-insensitive)', () => {
    expect(uniquePlayerName('Alice', [])).toBe('Alice');
    expect(uniquePlayerName('Alice', ['Alice'])).toBe('Alice 2');
    expect(uniquePlayerName('Alice', ['alice', 'Alice 2'])).toBe('Alice 3');
  });

  it('keeps suffixed names within the maximum length', () => {
    const base = 'a'.repeat(PLAYER_NAME_MAX_LENGTH);
    const unique = uniquePlayerName(base, [base]);
    expect(unique.length).toBeLessThanOrEqual(PLAYER_NAME_MAX_LENGTH);
    expect(unique.endsWith(' 2')).toBe(true);
  });
});
