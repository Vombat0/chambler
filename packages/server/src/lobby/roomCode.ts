/**
 * Room codes: 5 characters, uppercase, drawn from an alphabet without the
 * easily confused characters `0/O` and `1/I/L`.
 *
 * Randomness comes from `node:crypto` (`randomInt`) — never `Math.random` —
 * because a guessable code lets strangers join a private table.
 */
import { randomInt } from 'node:crypto';

export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
/** Characters deliberately excluded from generated codes. */
export const AMBIGUOUS_CHARACTERS = '01OIL';
export const MAX_CODE_ATTEMPTS = 64;

/** Generates one random room code (not checked for uniqueness). */
export function generateRoomCode(): string {
  let code = '';
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET.charAt(randomInt(ROOM_CODE_ALPHABET.length));
  }
  return code;
}

/**
 * Normalises user input to a room code, or returns `null` when it cannot be
 * a valid code (wrong length or a character outside the alphabet).
 */
export function normalizeRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const code = input.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) {
    return null;
  }
  for (const character of code) {
    if (!ROOM_CODE_ALPHABET.includes(character)) {
      return null;
    }
  }
  return code;
}

/** True when `input` is a syntactically valid room code. */
export function isRoomCode(input: unknown): boolean {
  return normalizeRoomCode(input) !== null;
}

/**
 * Generates a code that `isTaken` reports as free.
 *
 * @throws when no free code was found within `MAX_CODE_ATTEMPTS` tries; with a
 * 28.6M-code space this only happens if the caller's `isTaken` is broken.
 */
export function generateUniqueRoomCode(isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const code = generateRoomCode();
    if (!isTaken(code)) {
      return code;
    }
  }
  throw new Error('room_code_exhausted');
}
