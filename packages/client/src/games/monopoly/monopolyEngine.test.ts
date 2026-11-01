import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  JAIL_FINE,
  JAIL_INDEX,
  STARTING_CASH,
  buildHouse,
  buyProperty,
  calculateRent,
  createGame,
  currentPlayer,
  declinePurchase,
  dismissCard,
  endTurn,
  isGameOver,
  mortgageProperty,
  payJailFine,
  playerById,
  rollForJailWithDice,
  rollWithDice,
  sellHouse,
  unmortgageProperty,
  useJailCard,
  type MonopolyPlayer,
  type MonopolyState,
  type PropertyHolding,
} from './monopolyEngine.js';

/* ------------------------------ test yardımcıları ------------------------------ */

const CHANCE_MONEY = 'chance-02'; // +100
const CHANCE_GO = 'chance-01'; // Başlangıç'a dön + maaş
const CHANCE_JAIL = 'chance-04'; // Karantina
const CHANCE_EXTRA = 'chance-13';
const CHANCE_SKIP = 'chance-14';
const COMMUNITY_COLLECT = 'community-08'; // herkesten 25
const COMMUNITY_PAY = 'community-09'; // herkese 25
const COMMUNITY_MONEY = 'community-01'; // +50

const CHANCE_ALL = [
  CHANCE_MONEY,
  'chance-03',
  'chance-05',
  'chance-06',
  'chance-07',
  'chance-08',
  'chance-09',
  'chance-10',
  'chance-11',
  'chance-12',
  'chance-13',
  'chance-14',
  'chance-15',
  'chance-16',
  'chance-01',
  'chance-04',
];

const COMMUNITY_ALL = [
  COMMUNITY_MONEY,
  'community-02',
  'community-03',
  'community-04',
  'community-05',
  'community-06',
  'community-07',
  'community-08',
  'community-09',
  'community-10',
  'community-11',
  'community-12',
  'community-13',
  'community-14',
  'community-15',
  'community-16',
];

function reorder(first: string, all: readonly string[]): string[] {
  return [first, ...all.filter((id) => id !== first)];
}

function game(names: string[] = ['Ada', 'Bora'], chanceFirst = CHANCE_MONEY, communityFirst = COMMUNITY_MONEY): MonopolyState {
  return createGame(
    names.map((name) => ({ name })),
    {
      chanceOrder: reorder(chanceFirst, CHANCE_ALL),
      communityOrder: reorder(communityFirst, COMMUNITY_ALL),
    },
  );
}

function edit(state: MonopolyState, fn: (draft: MonopolyState) => void): MonopolyState {
  const draft = structuredClone(state);
  fn(draft);
  return draft;
}

function give(player: MonopolyPlayer, cellIndex: number, extra: Partial<PropertyHolding> = {}): void {
  player.properties[String(cellIndex)] = { mortgaged: false, houses: 0, ...extra };
}

function place(state: MonopolyState, playerIndex: number, position: number): MonopolyState {
  return edit(state, (draft) => {
    const player = draft.players[playerIndex];
    if (!player) throw new Error('oyuncu yok');
    player.position = position;
  });
}

/* ---------------------------------- testler --------------------------------- */

describe('monopolyEngine — kurulum ve temel durum', () => {
  it('40 hücreli tahtada 1500 ₡ ile başlar', () => {
    const state = game();
    expect(BOARD_SIZE).toBe(40);
    expect(state.players).toHaveLength(2);
    expect(state.players[0]!.cash).toBe(STARTING_CASH);
    expect(state.players[0]!.position).toBe(0);
    expect(state.phase).toBe('ROLL');
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.winnerId).toBeNull();
  });

  it('en az 2, en fazla 6 oyuncu kabul eder', () => {
    expect(() => createGame([{ name: 'Tek' }])).toThrow();
    expect(() => createGame(Array.from({ length: 7 }, (_, i) => ({ name: `O${i}` })))).toThrow();
    expect(createGame(Array.from({ length: 6 }, (_, i) => ({ name: `O${i}` }))).players).toHaveLength(6);
  });

  it('her oyuncuya farklı renk ve kimlik atanır', () => {
    const state = game(['A', 'B', 'C']);
    expect(new Set(state.players.map((p) => p.color)).size).toBe(3);
    expect(new Set(state.players.map((p) => p.id)).size).toBe(3);
  });
});

describe('monopolyEngine — piyon hareketi (başa dönme hatasının kanıtı)', () => {
  it('4 + 3 = 7 atışında piyon 7. hücreye gider, 0’a dönmez', () => {
    const state = rollWithDice(game(), 4, 3);
    expect(state.players[0]!.position).toBe(7);
    expect(state.players[0]!.position).not.toBe(0);
  });

  it('art arda zarlarda konum birikir (her atışta sıfırlanmaz)', () => {
    let state = game();
    state = rollWithDice(state, 1, 2); // A → 3
    state = declinePurchase(state);
    state = endTurn(state);
    state = rollWithDice(state, 1, 2); // B → 3
    state = declinePurchase(state);
    state = endTurn(state);
    state = rollWithDice(state, 1, 2); // A → 6
    expect(state.players[0]!.position).toBe(6);
  });

  it('zar sonucu konumu modulo 40 içinde tutar', () => {
    const state = place(game(), 0, 38);
    const next = rollWithDice(state, 4, 3); // 38 + 7 = 45 → 5
    expect(next.players[0]!.position).toBe(5);
  });

  it('başlangıçtan geçince 200 ₡ maaş ödenir', () => {
    const state = place(game(), 0, 35);
    const next = rollWithDice(state, 4, 3); // 35 + 7 = 42 → 2
    expect(next.players[0]!.position).toBe(2);
    expect(next.players[0]!.cash).toBe(STARTING_CASH + 200 + 50); // +50 topluluk kartı
    expect(next.lastEvents.some((event) => event.type === 'salary')).toBe(true);
  });

  it('başlangıç hücresine tam basınca da maaş alınır', () => {
    const state = place(game(), 0, 37);
    const next = rollWithDice(state, 1, 2); // 37 + 3 = 40 → 0
    expect(next.players[0]!.position).toBe(0);
    expect(next.players[0]!.cash).toBe(STARTING_CASH + 200);
  });

  it('başlangıcı geçmeyen kısa hareket maaş ödemez', () => {
    const state = place(game(), 0, 5);
    const next = rollWithDice(state, 1, 2); // 8
    expect(next.players[0]!.position).toBe(8);
    expect(next.players[0]!.cash).toBe(STARTING_CASH);
    expect(next.lastEvents.some((event) => event.type === 'salary')).toBe(false);
  });

  it('hareket olayı adım adım yol (path) üretir; atlama yok', () => {
    const next = rollWithDice(place(game(), 0, 2), 2, 3); // 2 → 7
    const move = next.lastEvents.find((event) => event.type === 'move');
    expect(move).toBeDefined();
    if (move && move.type === 'move') {
      expect(move.from).toBe(2);
      expect(move.to).toBe(7);
      expect(move.path).toEqual([3, 4, 5, 6, 7]);
    }
  });
});

describe('monopolyEngine — satın alma', () => {
  it('sahipsiz mülke gelince satın alma teklifi açılır', () => {
    const state = rollWithDice(place(game(), 0, 0), 1, 2); // 3 → Kiremit-2
    expect(state.pendingPurchase).toBe(3);
    expect(state.phase).toBe('ACTION');
    expect(state.lastEvents.some((event) => event.type === 'purchase-offer')).toBe(true);
  });

  it('satın alma parayı düşer ve tapuyu oyuncuya yazar', () => {
    const state = buyProperty(rollWithDice(place(game(), 0, 0), 1, 2));
    expect(state.players[0]!.cash).toBe(STARTING_CASH - 60);
    expect(state.players[0]!.properties['3']).toMatchObject({ mortgaged: false, houses: 0 });
    expect(state.pendingPurchase).toBeNull();
    expect(state.phase).toBe('TURN_END');
  });

  it('pas geçmek mülkü sahipsiz bırakır', () => {
    const state = declinePurchase(rollWithDice(place(game(), 0, 0), 1, 2));
    expect(state.players[0]!.properties['3']).toBeUndefined();
    expect(state.players[0]!.cash).toBe(STARTING_CASH);
    expect(state.phase).toBe('TURN_END');
  });

  it('nakit yetersizse satın alma gerçekleşmez', () => {
    const broke = edit(game(), (draft) => {
      draft.players[0]!.cash = 10;
    });
    const offered = rollWithDice(place(broke, 0, 0), 1, 2);
    expect(offered.pendingPurchase).toBe(3);
    const after = buyProperty(offered);
    expect(after.players[0]!.cash).toBe(10);
    expect(after.players[0]!.properties['3']).toBeUndefined();
  });
});

describe('monopolyEngine — kira hesabı', () => {
  it('tek mülkte temel kira ödenir', () => {
    const state = edit(game(), (draft) => give(draft.players[1]!, 3));
    expect(calculateRent(state, 3)).toBe(4);
  });

  it('tam grupta kira iki katına çıkar', () => {
    const state = edit(game(), (draft) => {
      give(draft.players[1]!, 1);
      give(draft.players[1]!, 3);
    });
    expect(calculateRent(state, 3)).toBe(8);
  });

  it('1 ev ve otel kiraları paket tablosundan okunur', () => {
    const oneHouse = edit(game(), (draft) => give(draft.players[1]!, 1, { houses: 1 }));
    expect(calculateRent(oneHouse, 1)).toBe(10);
    const hotel = edit(game(), (draft) => give(draft.players[1]!, 1, { houses: 5 }));
    expect(calculateRent(hotel, 1)).toBe(250);
  });

  it('liman kirası sahip olunan liman sayısına göre 25/50/100/200 olur', () => {
    for (const [count, rent] of [[1, 25], [2, 50], [3, 100], [4, 200]] as const) {
      const state = edit(game(), (draft) => {
        for (const index of [5, 15, 25, 35].slice(0, count)) give(draft.players[1]!, index);
      });
      expect(calculateRent(state, 5)).toBe(rent);
    }
  });

  it('enerji kirası tek mülkte 4×, iki mülkte 10× zar toplamıdır', () => {
    const single = edit(game(), (draft) => give(draft.players[1]!, 12));
    expect(calculateRent(single, 12, 7)).toBe(28);
    const both = edit(game(), (draft) => {
      give(draft.players[1]!, 12);
      give(draft.players[1]!, 28);
    });
    expect(calculateRent(both, 12, 7)).toBe(70);
  });

  it('ipotekli mülk kira getirmez', () => {
    const state = edit(game(), (draft) => give(draft.players[1]!, 3, { mortgaged: true }));
    expect(calculateRent(state, 3)).toBe(0);
  });

  it('kirayı gerçekten sahibine transfer eder', () => {
    const state = edit(place(game(), 0, 0), (draft) => {
      give(draft.players[1]!, 3);
      give(draft.players[1]!, 1);
    });
    const next = rollWithDice(state, 1, 2);
    expect(next.players[0]!.cash).toBe(STARTING_CASH - 8);
    expect(next.players[1]!.cash).toBe(STARTING_CASH + 8);
  });
});

describe('monopolyEngine — vergi, hapis ve özel hücreler', () => {
  it('belediye harcı otomatik kesilir', () => {
    const next = rollWithDice(place(game(), 0, 1), 1, 2); // 4 → vergi 200
    expect(next.players[0]!.cash).toBe(STARTING_CASH - 200);
    expect(next.lastEvents.some((event) => event.type === 'tax')).toBe(true);
  });

  it('Karantina hücresi oyuncuyu 10’a ışınlar ve hapse atar', () => {
    const next = rollWithDice(place(game(), 0, 27), 1, 2); // 30 → git hapse
    expect(next.players[0]!.position).toBe(JAIL_INDEX);
    expect(next.players[0]!.inJail).toBe(true);
    expect(next.phase).toBe('TURN_END');
  });

  it('kefalet ödeyince hapisten çıkar ve zar atabilir', () => {
    const state = edit(game(), (draft) => {
      const p = draft.players[0]!;
      p.position = JAIL_INDEX;
      p.inJail = true;
      draft.phase = 'JAIL_DECISION';
    });
    const next = payJailFine(state);
    expect(next.players[0]!.inJail).toBe(false);
    expect(next.players[0]!.cash).toBe(STARTING_CASH - JAIL_FINE);
    expect(next.phase).toBe('ROLL');
  });

  it('çıkış kartı hapisten bedava çıkarır', () => {
    const state = edit(game(), (draft) => {
      const p = draft.players[0]!;
      p.position = JAIL_INDEX;
      p.inJail = true;
      p.getOutOfJailCards = 1;
      draft.phase = 'JAIL_DECISION';
    });
    const next = useJailCard(state);
    expect(next.players[0]!.inJail).toBe(false);
    expect(next.players[0]!.getOutOfJailCards).toBe(0);
    expect(next.phase).toBe('ROLL');
  });

  it('hapishanede çift zar çıkış sağlar ve piyon ilerler', () => {
    const state = edit(game(), (draft) => {
      const p = draft.players[0]!;
      p.position = JAIL_INDEX;
      p.inJail = true;
      draft.phase = 'JAIL_DECISION';
    });
    const next = rollForJailWithDice(state, 3, 3);
    expect(next.players[0]!.inJail).toBe(false);
    expect(next.players[0]!.position).toBe(16);
  });

  it('üç başarısız denemede kefalet ödenir ve piyon ilerler', () => {
    const state = edit(game(), (draft) => {
      const p = draft.players[0]!;
      p.position = JAIL_INDEX;
      p.inJail = true;
      p.jailTurns = 2;
      draft.phase = 'JAIL_DECISION';
    });
    const next = rollForJailWithDice(state, 1, 2);
    expect(next.players[0]!.inJail).toBe(false);
    expect(next.players[0]!.cash).toBe(STARTING_CASH - JAIL_FINE);
    expect(next.players[0]!.position).toBe(13);
  });
});

describe('monopolyEngine — şans ve topluluk kartları', () => {
  it('para kartı anında uygulanır (+100)', () => {
    const next = rollWithDice(place(game(), 0, 4), 1, 2); // 7 → Fırsat
    expect(next.players[0]!.cash).toBe(STARTING_CASH + 100);
    expect(next.pendingCard?.cardId).toBe(CHANCE_MONEY);
    expect(next.pendingCard?.title.length).toBeGreaterThan(2);
  });

  it('başlangıca dön kartı maaşla birlikte uygulanır', () => {
    const next = rollWithDice(place(game(undefined, CHANCE_GO), 0, 4), 1, 2);
    expect(next.players[0]!.position).toBe(0);
    expect(next.players[0]!.cash).toBe(STARTING_CASH + 200);
  });

  it('hapishane kartı oyuncuyu Karantina’ya gönderir', () => {
    const next = rollWithDice(place(game(undefined, CHANCE_JAIL), 0, 4), 1, 2);
    expect(next.players[0]!.position).toBe(JAIL_INDEX);
    expect(next.players[0]!.inJail).toBe(true);
  });

  it('her oyuncudan tahsil kartı tüm bakiyelere işler', () => {
    const next = rollWithDice(place(game(['A', 'B', 'C'], CHANCE_MONEY, COMMUNITY_COLLECT), 0, 0), 1, 1);
    expect(next.players[0]!.cash).toBe(STARTING_CASH + 50);
    expect(next.players[1]!.cash).toBe(STARTING_CASH - 25);
    expect(next.players[2]!.cash).toBe(STARTING_CASH - 25);
  });

  it('herkese ödeme kartı oyuncudan para çıkarır', () => {
    const next = rollWithDice(place(game(['A', 'B', 'C'], CHANCE_MONEY, COMMUNITY_PAY), 0, 0), 1, 1);
    expect(next.players[0]!.cash).toBe(STARTING_CASH - 50);
    expect(next.players[1]!.cash).toBe(STARTING_CASH + 25);
  });

  it('ek tur kartı kapatıldıktan sonra zar fazına döner', () => {
    const state = rollWithDice(place(game(undefined, CHANCE_EXTRA), 0, 4), 1, 2);
    expect(state.pendingCard?.cardId).toBe(CHANCE_EXTRA);
    const next = dismissCard(state);
    expect(next.phase).toBe('ROLL');
    expect(next.currentPlayerIndex).toBe(0);
  });

  it('tur atlama kartı oyuncuya bir tur kaybettirir', () => {
    const state = rollWithDice(place(game(['A', 'B', 'C'], CHANCE_SKIP), 0, 4), 1, 2);
    expect(state.players[0]!.skipTurns).toBe(1);
    let next = endTurn(dismissCard(state));
    expect(next.currentPlayerIndex).toBe(1);
    next = endTurn(edit(next, (draft) => { draft.phase = 'TURN_END'; }));
    expect(next.currentPlayerIndex).toBe(2);
    next = endTurn(edit(next, (draft) => { draft.phase = 'TURN_END'; }));
    expect(next.currentPlayerIndex).toBe(1); // A atlandı, B yeniden oynar
    expect(next.players[0]!.skipTurns).toBe(0);
  });
});

describe('monopolyEngine — tur döngüsü, çift zar ve iflas', () => {
  it('çift zar ek zar hakkı verir', () => {
    let state = rollWithDice(place(game(), 0, 0), 3, 3); // 6 → sahipsiz
    expect(state.phase).toBe('ACTION');
    state = declinePurchase(state);
    expect(state.phase).toBe('ROLL');
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.dice.doublesCount).toBe(1);
  });

  it('üçüncü çift zar oyuncuyu hapse gönderir', () => {
    const state = edit(game(), (draft) => {
      draft.dice.doublesCount = 2;
    });
    const next = rollWithDice(state, 2, 2);
    expect(next.players[0]!.position).toBe(JAIL_INDEX);
    expect(next.players[0]!.inJail).toBe(true);
    expect(next.phase).toBe('TURN_END');
  });

  it('endTurn sırayı sonraki iflas etmemiş oyuncuya geçirir', () => {
    const state = edit(game(['A', 'B', 'C']), (draft) => {
      draft.phase = 'TURN_END';
      draft.players[1]!.bankrupt = true;
    });
    const next = endTurn(state);
    expect(next.currentPlayerIndex).toBe(2);
    expect(next.phase).toBe('ROLL');
  });

  it('iflas eden oyuncunun tapuları alacaklıya geçer ve oyun biter', () => {
    const state = edit(place(game(['A', 'B']), 0, 4), (draft) => {
      give(draft.players[0]!, 3); // A'nın tapusu var
      give(draft.players[1]!, 6, { houses: 5 }); // B'nin oteli: 550 ₡ kira
      draft.players[0]!.cash = 100;
    });
    const result = rollWithDice(state, 1, 1); // 4 + 2 = 6 (B'nin oteli)
    expect(result.players[0]!.bankrupt).toBe(true);
    expect(result.players[1]!.properties['3']).toBeDefined();
    expect(result.winnerId).toBe(result.players[1]!.id);
    expect(isGameOver(result)).toBe(true);
  });

  it('inşaat tam grup ve eşit dağılım ister', () => {
    let state = edit(game(), (draft) => {
      give(draft.players[0]!, 1);
      give(draft.players[0]!, 3);
    });
    state = buildHouse(state, 1);
    expect(state.players[0]!.properties['1']!.houses).toBe(1);
    expect(state.players[0]!.cash).toBe(STARTING_CASH - 50);
    state = buildHouse(state, 3);
    expect(state.players[0]!.properties['3']!.houses).toBe(1);
    state = buildHouse(state, 1);
    expect(state.players[0]!.properties['1']!.houses).toBe(2);
  });

  it('tam grup olmadan inşaat yapılamaz', () => {
    const state = edit(game(), (draft) => give(draft.players[0]!, 1));
    const next = buildHouse(state, 1);
    expect(next.players[0]!.properties['1']!.houses).toBe(0);
  });

  it('ev satışı yarı fiyat iade eder', () => {
    const state = edit(game(), (draft) => {
      give(draft.players[0]!, 1, { houses: 2 });
      give(draft.players[0]!, 3, { houses: 2 });
    });
    const next = sellHouse(state, 1);
    expect(next.players[0]!.properties['1']!.houses).toBe(1);
    expect(next.players[0]!.cash).toBe(STARTING_CASH + 25);
  });

  it('ipotek para verir, kaldırma %10 fazlasına mal olur', () => {
    const state = edit(game(), (draft) => give(draft.players[0]!, 1));
    const mortgaged = mortgageProperty(state, 1);
    expect(mortgaged.players[0]!.properties['1']!.mortgaged).toBe(true);
    expect(mortgaged.players[0]!.cash).toBe(STARTING_CASH + 30);
    const restored = unmortgageProperty(mortgaged, 1);
    expect(restored.players[0]!.properties['1']!.mortgaged).toBe(false);
    expect(restored.players[0]!.cash).toBe(STARTING_CASH + 30 - 33);
  });

  it('pendingPurchase varken endTurn sırayı değiştirmez', () => {
    const state = rollWithDice(place(game(), 0, 0), 1, 2);
    expect(state.phase).toBe('ACTION');
    const next = endTurn(state);
    expect(next.currentPlayerIndex).toBe(0);
  });

  it('currentPlayer ve playerById yardımcıları doğru oyuncuyu verir', () => {
    const state = game(['Ada', 'Bora']);
    expect(currentPlayer(state).name).toBe('Ada');
    expect(playerById(state, 'p2')?.name).toBe('Bora');
  });
});
