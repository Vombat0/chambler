import { describe, expect, it } from 'vitest';
import {
  PLAYER_COLORS,
  firstFreeColor,
  firstFreeSeat,
  isPlayerColor,
  isValidSeat,
  normalizePlayerColor,
} from './seats.js';

describe('seats and colours', () => {
  it('picks the lowest free seat', () => {
    expect(firstFreeSeat([])).toBe(0);
    expect(firstFreeSeat([0])).toBe(1);
    expect(firstFreeSeat([0, 1, 3])).toBe(2);
    expect(firstFreeSeat([0, 1, 2, 3, 4, 5, 6])).toBe(7);
    expect(firstFreeSeat([0, 1, 2, 3, 4, 5, 6, 7])).toBeNull();
  });

  it('returns a free seat when a player leaves (seat released)', () => {
    expect(firstFreeSeat([1, 2])).toBe(0);
  });

  it('assigns a unique colour from the palette', () => {
    expect(firstFreeColor([])).toBe(PLAYER_COLORS[0]);
    expect(firstFreeColor([PLAYER_COLORS[0]])).toBe(PLAYER_COLORS[1]);
    expect(firstFreeColor([...PLAYER_COLORS])).toBeNull();
  });

  it('normalises requested colours and rejects colours outside the palette', () => {
    expect(normalizePlayerColor('#E63946')).toBe('#e63946');
    expect(normalizePlayerColor(' #2a9d8f ')).toBe('#2a9d8f');
    expect(normalizePlayerColor('#123456')).toBeNull();
    expect(normalizePlayerColor('red')).toBeNull();
    expect(normalizePlayerColor(12)).toBeNull();
    expect(isPlayerColor('#f4a261')).toBe(true);
  });

  it('validates seat indices', () => {
    expect(isValidSeat(0)).toBe(true);
    expect(isValidSeat(7)).toBe(true);
    expect(isValidSeat(8)).toBe(false);
    expect(isValidSeat(-1)).toBe(false);
    expect(isValidSeat(1.5)).toBe(false);
    expect(isValidSeat('1')).toBe(false);
  });
});
