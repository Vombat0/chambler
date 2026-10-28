import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_CHARACTERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  generateUniqueRoomCode,
  isRoomCode,
  normalizeRoomCode,
} from './roomCode.js';

describe('roomCode', () => {
  it('generates 5-character codes from an unambiguous alphabet', () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const character of code) {
        expect(ROOM_CODE_ALPHABET).toContain(character);
        expect(AMBIGUOUS_CHARACTERS).not.toContain(character);
      }
    }
  });

  it('is collision-free in practice', () => {
    const codes = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      codes.add(generateRoomCode());
    }
    // 31^5 ≈ 28.6M combinations; 500 draws should almost never collide.
    expect(codes.size).toBeGreaterThan(495);
  });

  it('normalises user input (trim + uppercase) and rejects bad codes', () => {
    expect(normalizeRoomCode(' ab2cd ')).toBe('AB2CD');
    expect(normalizeRoomCode('AB2C')).toBeNull();
    expect(normalizeRoomCode('AB2CDE')).toBeNull();
    expect(normalizeRoomCode('AB0CD')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeRoomCode('ABICD')).toBeNull(); // I is not in the alphabet
    expect(normalizeRoomCode(42)).toBeNull();
    expect(normalizeRoomCode(undefined)).toBeNull();
    expect(isRoomCode('ab2cd')).toBe(true);
  });

  it('skips codes the caller reports as taken', () => {
    const taken = new Set(['AAAAA', 'BBBBB', 'CCCCC']);
    const code = generateUniqueRoomCode((candidate) => taken.has(candidate));
    expect(taken.has(code)).toBe(false);
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
  });

  it('throws when the code space is exhausted', () => {
    expect(() => generateUniqueRoomCode(() => true)).toThrow(/room_code_exhausted/);
  });
});
