import { describe, expect, it } from 'vitest';
import {
  BOARD_JSON,
  CHANCE_DECK,
  COMMUNITY_DECK,
  GROUPS_JSON,
  cardText,
  cellAccent,
  cellName,
} from './boardData.js';

describe('boardData — paket verisi sağlamaları', () => {
  it('Mülk Tycoon tahtasında 40 hücre ve 11×11 ızgara vardır', () => {
    expect(BOARD_JSON.cells).toHaveLength(40);
    expect(BOARD_JSON.grid).toMatchObject({ cols: 11, rows: 11 });
  });

  it('her hücre kenar + slot taşır (geometri türetilebilir)', () => {
    for (const cell of BOARD_JSON.cells) {
      expect(['bottom', 'left', 'top', 'right']).toContain(cell.side);
      expect(cell.slot).toBeGreaterThanOrEqual(0);
      expect(cell.slot).toBeLessThanOrEqual(10);
    }
  });

  it('grup renkleri çözülür; grup bilmeyen hücre tip rengine düşer', () => {
    const property = BOARD_JSON.cells.find((cell) => cell.type === 'property')!;
    expect(cellAccent(property)).toMatch(/^#[0-9a-fA-F]{6}$/);
    const chance = BOARD_JSON.cells.find((cell) => cell.type === 'chance')!;
    expect(cellAccent(chance).toLowerCase()).toBe('#c2456b');
    expect(GROUPS_JSON.length).toBeGreaterThan(5);
  });

  it('hücre adları her iki dilde çözülür (i18n fallback tr)', () => {
    const jail = BOARD_JSON.cells[10]!;
    expect(cellName(jail, 'tr')).toBe('Misafirhane');
    expect(cellName(jail, 'en').length).toBeGreaterThan(3);
  });

  it('destelerde 16+16 kart var ve metin anahtarları çözülüyor', () => {
    expect(CHANCE_DECK.cards).toHaveLength(16);
    expect(COMMUNITY_DECK.cards).toHaveLength(16);
    const card = CHANCE_DECK.cards[0]!;
    const { title, text } = cardText(card, 'tr');
    expect(title).toBe('Meydan Turu');
    expect(text.length).toBeGreaterThan(10);
  });
});
