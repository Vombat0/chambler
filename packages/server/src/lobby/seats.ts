/**
 * Seats and colours.
 *
 * Every player owns one seat (0..maxSeats-1) and one colour from a fixed
 * palette. Both are unique inside a room and released when the player leaves.
 */

/** Fixed palette; index order is the default preference order. */
export const PLAYER_COLORS = [
  '#e63946', // red
  '#2a9d8f', // teal
  '#e9c46a', // yellow
  '#457b9d', // blue
  '#9b5de5', // purple
  '#f4a261', // orange
  '#8ac926', // green
  '#ff70a6', // pink
] as const;

export const MAX_SEATS = PLAYER_COLORS.length;

export type PlayerColor = (typeof PLAYER_COLORS)[number];

/** Normalises a requested colour to the canonical palette entry, or `null`. */
export function normalizePlayerColor(input: unknown): PlayerColor | null {
  if (typeof input !== 'string') {
    return null;
  }
  const value = input.trim().toLowerCase();
  for (const color of PLAYER_COLORS) {
    if (color === value) {
      return color;
    }
  }
  return null;
}

/** True when `input` names a palette colour. */
export function isPlayerColor(input: unknown): input is PlayerColor {
  return normalizePlayerColor(input) !== null;
}

/** First free seat index, or `null` when all seats are taken. */
export function firstFreeSeat(occupiedSeats: Iterable<number>, maxSeats: number = MAX_SEATS): number | null {
  const occupied = new Set<number>(occupiedSeats);
  for (let seat = 0; seat < maxSeats; seat += 1) {
    if (!occupied.has(seat)) {
      return seat;
    }
  }
  return null;
}

/** First palette colour not in use, or `null` when the palette is exhausted. */
export function firstFreeColor(usedColors: Iterable<string>): PlayerColor | null {
  const used = new Set<string>();
  for (const color of usedColors) {
    used.add(color.toLowerCase());
  }
  for (const color of PLAYER_COLORS) {
    if (!used.has(color)) {
      return color;
    }
  }
  return null;
}

/** Validates a requested seat index. */
export function isValidSeat(value: unknown, maxSeats: number = MAX_SEATS): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < maxSeats;
}
