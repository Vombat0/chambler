import { describe, expect, it } from 'vitest';
import { availableColors, availableSeats, isColorTaken, sortPlayers } from './lobby.js';
import type { LobbyPlayerLike } from './lobby.js';

function player(overrides: Partial<LobbyPlayerLike>): LobbyPlayerLike {
  return { id: 'p', name: 'N', color: '#e63946', seat: 0, isHost: false, connected: true, ...overrides };
}

describe('lobby helpers (D1)', () => {
  const red = '#e63946';
  const teal = '#2a9d8f';

  it(' alınan renk devre dışı kalır (kendine ait olan dahil değil)', () => {
    const players = [player({ id: 'me', color: red }), player({ id: 'other', color: teal })];
    expect(isColorTaken(red, players, 'me')).toBe(false);
    expect(isColorTaken(red, players, 'other')).toBe(true);
    expect(isColorTaken(teal, players, 'me')).toBe(true);
  });

  it(' availableColors başkasının renklerini filtreler, kendi rengi kalır', () => {
    const players = [player({ id: 'me', color: red }), player({ id: 'other', color: teal })];
    const colors = availableColors(players, 'me');
    expect(colors).toContain(red);
    expect(colors).not.toContain(teal);
    expect(colors.length).toBe(7);
  });

  it(' availableSeats dolu koltukları kırpar', () => {
    const players = [player({ id: 'other', seat: 0 }), player({ id: 'other2', seat: 2 })];
    expect(availableSeats(players, 'me', 8)).toEqual([1, 3, 4, 5, 6, 7]);
  });

  it(' kendi koltuğu uygun koltuk listesinde kalır (değişim hedefi olabilir)', () => {
    const players = [player({ id: 'me', seat: 3 }), player({ id: 'other', seat: 0 })];
    expect(availableSeats(players, 'me', 8)).toContain(3);
  });

  it(' sortPlayers kararlı ve id bazlı sıralar', () => {
    const sorted = sortPlayers([player({ id: 'zz' }), player({ id: 'aa' }), player({ id: 'mm' })]);
    expect(sorted.map((p) => p.id)).toEqual(['aa', 'mm', 'zz']);
  });
});
