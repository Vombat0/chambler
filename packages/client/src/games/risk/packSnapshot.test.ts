/**
 * R2 — Anlık görüntü ↔ kanonik paket dosyası tutarlılık testi.
 * packSnapshot.ts, packs/territory-wars altındaki dosyaların birebir kopyası
 * olmalıdır; bir taraf değişir de diğeri değişmezse bu test kırmızıya döner.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOARD_JSON, CONTINENTS_JSON, TERRITORY_JSON, TR_I18N_JSON } from './packSnapshot';

function disk(rel: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../../../../${rel}`, import.meta.url), 'utf8'));
}

describe('paket anlık görüntüsü — kanonik kaynakla birebir', () => {
  it('board.json', () => {
    expect(JSON.parse(BOARD_JSON)).toEqual(disk('packs/territory-wars/board/board.json'));
  });
  it('continents.json', () => {
    expect(JSON.parse(CONTINENTS_JSON)).toEqual(disk('packs/territory-wars/board/continents.json'));
  });
  it('territory.json (kart destesi)', () => {
    expect(JSON.parse(TERRITORY_JSON)).toEqual(disk('packs/territory-wars/cards/territory.json'));
  });
  it('tr.json (i18n)', () => {
    expect(JSON.parse(TR_I18N_JSON)).toEqual(disk('packs/territory-wars/i18n/tr.json'));
  });
  it('harita öz-tutarlı: 28 bölge, simetrik komşuluk, 5 kıta, 30 kart', () => {
    const board = JSON.parse(BOARD_JSON) as {
      regions: { id: string; neighbors: string[]; continent: string }[];
    };
    const conts = JSON.parse(CONTINENTS_JSON) as {
      continents: { id: string; members: string[]; bonus: number }[];
    };
    const cards = JSON.parse(TERRITORY_JSON) as { cards: unknown[] };
    expect(board.regions).toHaveLength(28);
    expect(conts.continents).toHaveLength(5);
    expect(cards.cards).toHaveLength(30);
    for (const r of board.regions) {
      for (const n of r.neighbors) {
        const other = board.regions.find((x) => x.id === n);
        expect(other?.neighbors).toContain(r.id);
      }
      expect(conts.continents.some((c) => c.id === r.continent && c.members.includes(r.id))).toBe(
        true,
      );
    }
    const allMembers = conts.continents.flatMap((c) => c.members);
    expect(new Set(allMembers).size).toBe(28);
    expect(conts.continents.reduce((s, c) => s + c.bonus, 0)).toBe(22);
  });
});
