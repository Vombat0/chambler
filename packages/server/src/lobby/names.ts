/**
 * Player-name validation. Client input is never trusted: names are checked for
 * type, emptiness, control characters and length, then made unique per room.
 */

export const PLAYER_NAME_MIN_LENGTH = 1;
export const PLAYER_NAME_MAX_LENGTH = 24;

/**
 * C0/C1 controls, zero-width characters, bidi overrides and line separators.
 * These can spoof other players or break logs/UI, so they are rejected.
 */
const CONTROL_CHARACTERS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/;

const WHITESPACE_RUN = /\s+/g;

export type NameErrorCode = 'NAME_REQUIRED' | 'NAME_INVALID' | 'NAME_TOO_LONG';

export type NameValidation =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly code: NameErrorCode; readonly message: string };

/** Collapses whitespace and trims; returns '' when nothing is left. */
export function cleanPlayerName(raw: string): string {
  return raw.replace(WHITESPACE_RUN, ' ').trim();
}

/** Validates a raw (untrusted) player name. */
export function validatePlayerName(
  raw: unknown,
  maxLength: number = PLAYER_NAME_MAX_LENGTH,
): NameValidation {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'NAME_REQUIRED', message: 'A player name is required.' };
  }
  if (CONTROL_CHARACTERS.test(raw)) {
    return {
      ok: false,
      code: 'NAME_INVALID',
      message: 'The player name contains control characters.',
    };
  }
  const name = cleanPlayerName(raw);
  if (name.length < PLAYER_NAME_MIN_LENGTH) {
    return { ok: false, code: 'NAME_REQUIRED', message: 'A player name is required.' };
  }
  if (name.length > maxLength) {
    return {
      ok: false,
      code: 'NAME_TOO_LONG',
      message: `The player name may be at most ${maxLength} characters.`,
    };
  }
  return { ok: true, name };
}

/**
 * Returns `base`, or `base 2`, `base 3`, … when that name is already used.
 * Comparison is case-insensitive; the result always fits `maxLength`.
 */
export function uniquePlayerName(
  base: string,
  takenNames: Iterable<string>,
  maxLength: number = PLAYER_NAME_MAX_LENGTH,
): string {
  const taken = new Set<string>();
  for (const name of takenNames) {
    taken.add(name.toLowerCase());
  }
  if (!taken.has(base.toLowerCase())) {
    return base;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const suffixText = ` ${suffix}`;
    const head = base.slice(0, Math.max(1, maxLength - suffixText.length));
    const candidate = `${head}${suffixText}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  // Practically unreachable; keeps the return type total.
  return `${base.slice(0, Math.max(1, maxLength - 4))} x${Date.now() % 1000}`;
}
