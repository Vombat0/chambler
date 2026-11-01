/**
 * R2 — Risk kural motoru testleri.
 * Zarlar dahil her şey sahte (deterministik) RNG ile test edilir.
 */

import { describe, expect, it } from 'vitest';
import { CARD_DECK, NEIGHBORS, REGION_IDS } from './boardData';
import {
  type RiskCard,
  type RiskState,
  type Territory,
  areConnected,
  attack,
  canAttack,
  canDeploy,
  canFortify,
  computeDeployPool,
  continentBonus,
  continentOwner,
  confirmCapture,
  createInitialState,
  deploy,
  endTurn,
  findTradeSet,
  fortify,
  goToAttack,
  goToFortify,
  isValidSet,
  ownedTerritories,
  rollDice,
  trade,
  tradeValue,
} from './riskEngine';

// ---------------------------------------------------------------------------
// Test kurucuları
// ---------------------------------------------------------------------------

const BASE_CARDS: RiskCard[] = CARD_DECK.map((c) => ({
  id: c.id,
  regionId: c.regionId,
  kind: c.kind,
  wild: c.wild,
}));

function cardsFor(...ids: string[]): RiskCard[] {
  return ids.map((id) => BASE_CARDS.find((c) => c.id === id)!);
}

function mk(over: Partial<RiskState> = {}): RiskState {
  const territories: Record<string, Territory> = {};
  for (const id of REGION_IDS) territories[id] = { ownerId: 'p1', armies: 1 };
  return {
    territories,
    players: [
      { id: 'p1', name: 'Atakan', color: '#f00', cards: [], eliminated: false, ai: false },
      { id: 'p2', name: 'Berk', color: '#00f', cards: [], eliminated: false, ai: false },
    ],
    current: 0,
    phase: 'DEPLOY',
    deployPool: 3,
    deck: [...BASE_CARDS],
    discard: [],
    conqueredThisTurn: false,
    fortifyUsed: false,
    tradesDone: 0,
    pendingCapture: null,
    winnerId: null,
    turn: 1,
    log: [],
    ...over,
  };
}

/** Bölge sahipliğini/askerini düzenler. */
function own(state: RiskState, ownerId: string, ids: string[], armies = 1): RiskState {
  const territories = { ...state.territories };
  for (const id of ids) territories[id] = { ownerId, armies };
  return { ...state, territories };
}

/** İki oyunculu denge haritası: ilk 14 bölge p1, kalanı p2. */
function splitState(over: Partial<RiskState> = {}): RiskState {
  let s = mk({ deployPool: 0, phase: 'ATTACK' });
  const t = { ...s.territories };
  REGION_IDS.forEach((id, i) => {
    t[id] = { ownerId: i < 14 ? 'p1' : 'p2', armies: 1 };
  });
  s = { ...s, territories: t };
  return { ...s, ...over };
}

/** Sabit zar sequencesi tüketen RNG (sonra 0.5'e düşer). */
function mockRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = i < values.length ? values[i++]! : 0.5;
    return (v - 1) / 6 + 0.0001; // rollDice: 1 + floor(rng*6) → v döner
  };
}

// ---------------------------------------------------------------------------
// 1) Takviye havuzu ve kıta bonusları
// ---------------------------------------------------------------------------

describe('takviye havuzu', () => {
  it('bölge sayısının üçte birine göre hesaplanır (12 bölge → 4)', () => {
    let s = mk({ deployPool: 0 });
    // p1'e 12, p2'ye kalan 16 ver; hiçbir kıta tam olmasın.
    const p1ids = [
      'fangreach', 'stormfell', 'aldermoor', 'hollowbridge', 'mistral-basin', 'larkspur',
      'glassholt', 'sunspire', 'amber-steppe', 'ashen-quay', 'pyre-key', 'coral-reach',
    ];
    s = own(s, 'p1', p1ids);
    s = own(s, 'p2', REGION_IDS.filter((id) => !p1ids.includes(id)));
    expect(computeDeployPool(s, 'p1')).toBe(4);
  });

  it('havuz en az 3 olur (10 dağınık bölge, bonus yok)', () => {
    let s = mk({ deployPool: 0 });
    const p1ids = [
      'fangreach', 'stormfell', 'aldermoor', 'hollowbridge', 'mistral-basin',
      'larkspur', 'sunspire', 'amber-steppe', 'ashen-quay', 'pyre-key',
    ];
    s = own(s, 'p1', p1ids);
    s = own(s, 'p2', REGION_IDS.filter((id) => !p1ids.includes(id)));
    expect(computeDeployPool(s, 'p1')).toBe(3);
  });

  it('tam kıta bonusu eklenir: Drakemoor (5 bölge) → 3 + 5 = 8', () => {
    let s = mk({ deployPool: 0 });
    const drakemoor = ['fangreach', 'stormfell', 'ironfrost', 'whitmane', 'grimhold'];
    s = own(s, 'p1', drakemoor);
    s = own(s, 'p2', REGION_IDS.filter((id) => !drakemoor.includes(id)));
    expect(continentBonus(s, 'p1')).toBe(5);
    expect(computeDeployPool(s, 'p1')).toBe(8);
  });

  it('kıta eksikse bonus verilmez', () => {
    let s = mk({ deployPool: 0 });
    const drakemoor = ['fangreach', 'stormfell', 'ironfrost', 'whitmane']; // grimhold yok
    s = own(s, 'p1', drakemoor);
    s = own(s, 'p2', REGION_IDS.filter((id) => !drakemoor.includes(id)));
    expect(continentBonus(s, 'p1')).toBe(0);
    expect(continentOwner(s, 'drakemoor')).toBeNull();
  });

  it('Koros tam sahip → +7 bonusu, kıta sahibi doğru', () => {
    let s = mk({ deployPool: 0 });
    const koros = ['aldermoor', 'hollowbridge', 'mistral-basin', 'kestrel-down', 'sundergate', 'emberwatch', 'loamfield', 'reedmarsh'];
    s = own(s, 'p1', koros);
    s = own(s, 'p2', REGION_IDS.filter((id) => !koros.includes(id)));
    expect(continentOwner(s, 'koros')).toBe('p1');
    expect(continentBonus(s, 'p1')).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 2) Takviye eylemi
// ---------------------------------------------------------------------------

describe('takviye (deploy)', () => {
  it('kendi bölgesine +1 asker, havuzdan -1', () => {
    const s = mk({ deployPool: 4 });
    const n = deploy(s, 'fangreach', 1);
    expect(n.territories.fangreach!.armies).toBe(s.territories.fangreach!.armies + 1);
    expect(n.deployPool).toBe(3);
  });

  it('havuzdan fazla dağıtamaz', () => {
    const s = mk({ deployPool: 2 });
    const n = deploy(s, 'fangreach', 10);
    expect(n.deployPool).toBe(0);
    expect(n.territories.fangreach!.armies).toBe(3);
  });

  it('düşman bölgeye takviye reddedilir', () => {
    let s = own(mk(), 'p2', ['stormfell']);
    s = { ...s, deployPool: 5 };
    expect(canDeploy(s, 'stormfell')).toBe(false);
    expect(deploy(s, 'stormfell', 1)).toBe(s);
  });

  it('saldırı fazında takviye yapılamaz', () => {
    const s = mk({ phase: 'ATTACK', deployPool: 5 });
    expect(canDeploy(s, 'fangreach')).toBe(false);
  });

  it('havuz 0 iken dağıtılamaz', () => {
    const s = mk({ deployPool: 0 });
    expect(canDeploy(s, 'fangreach')).toBe(false);
  });

  it('takviye bitmeden saldırı fazına geçilemez', () => {
    let s = mk({ deployPool: 1 });
    expect(goToAttack(s)).toBe(s);
    s = { ...s, deployPool: 0 };
    expect(goToAttack(s).phase).toBe('ATTACK');
  });
});

// ---------------------------------------------------------------------------
// 3) Saldırı doğrulama
// ---------------------------------------------------------------------------

describe('saldırı doğrulama', () => {
  it('komşu olmayan bölgeler saldıramaz', () => {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], 3);
    expect(canAttack(s, 'fangreach', 'sunspire')).toContain('komşu');
  });

  it('kendi bölgesine saldırılamaz', () => {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], 3);
    expect(canAttack(s, 'fangreach', 'stormfell')).toContain('Kendi');
  });

  it('1 askerle saldırı reddedilir', () => {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], 1);
    s = own(s, 'p2', ['stormfell'], 1);
    expect(canAttack(s, 'fangreach', 'stormfell')).toContain('2 asker');
  });

  it('sıradaki oyuncuya ait olmayan bölge saldıramaz', () => {
    let s = splitState();
    s = own(s, 'p1', ['grimhold'], 5);
    s = own(s, 'p2', ['ashen-quay'], 1);
    // grimhold p1'in ama sıra p2'de olsun
    s = { ...s, current: 1 };
    expect(canAttack(s, 'grimhold', 'ashen-quay')).toContain('sana ait değil');
  });

  it('DEPLOY fazında saldırı reddedilir', () => {
    let s = splitState({ phase: 'DEPLOY' });
    s = own(s, 'p1', ['fangreach'], 3);
    s = own(s, 'p2', ['stormfell'], 1);
    expect(canAttack(s, 'fangreach', 'stormfell')).toContain('fazında');
  });

  it('geçerli saldırı onaylanır (≥2 asker, komşu, düşman)', () => {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], 3);
    s = own(s, 'p2', ['stormfell'], 2);
    expect(canAttack(s, 'fangreach', 'stormfell')).toBeNull();
  });

  it('motor reddettiğinde zar atılmaz, state aynen döner', () => {
    const s = splitState();
    const out = attack(s, 'fangreach', 'glassholt', mockRng([6, 6, 6]));
    expect(out.state).toBe(s);
    expect(out.attackerDice).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4) Zar çatışması
// ---------------------------------------------------------------------------

describe('zar çatışması', () => {
  it('zarlar büyükten küçüğe sıralanır ve 1..6 aralığındadır', () => {
    const dice = rollDice(3, mockRng([2, 6, 4]));
    expect(dice).toEqual([6, 4, 2]);
    const all = rollDice(10, () => 0.999999);
    expect(all.every((d) => d >= 1 && d <= 6)).toBe(true);
  });

  it('saldıran zar sayısı: ordusu 2 → 1, 3 → 2, ≥4 → 3', () => {
    for (const [armies, diceN] of [[2, 1], [3, 2], [4, 3], [9, 3]] as const) {
      let s = splitState();
      s = own(s, 'p1', ['fangreach'], armies);
      s = own(s, 'p2', ['stormfell'], 2);
      const out = attack(s, 'fangreach', 'stormfell', mockRng([3, 3, 3, 2, 2]));
      expect(out.attackerDice).toHaveLength(diceN);
      expect(out.defenderDice).toHaveLength(2);
    }
  });

  it('savunan zar sayısı: 1 asker → 1 zar', () => {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], 5);
    s = own(s, 'p2', ['stormfell'], 1);
    const out = attack(s, 'fangreach', 'stormfell', mockRng([3, 3, 3, 2]));
    expect(out.defenderDice).toHaveLength(1);
  });

  it('eşitlikte SAVUNAN kazanır (1v1 beşler)', () => {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], 2);
    s = own(s, 'p2', ['stormfell'], 1);
    const out = attack(s, 'fangreach', 'stormfell', mockRng([5, 5]));
    expect(out.attackerLosses).toBe(1);
    expect(out.defenderLosses).toBe(0);
    expect(out.state.territories.fangreach!.armies).toBe(1);
    expect(out.state.territories.stormfell!.armies).toBe(1);
  });

  it('zarlar sıralanıp eşleşir: 4,4 vs 4,3 → karşılıklı 1 kayıp', () => {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], 3);
    s = own(s, 'p2', ['stormfell'], 2);
    const out = attack(s, 'fangreach', 'stormfell', mockRng([4, 4, 3, 4]));
    // saldıran [4,4], savunan [4,3] → 1. çift eşit (savunan kazanır), 2. saldıran kazanır
    expect(out.attackerLosses).toBe(1);
    expect(out.defenderLosses).toBe(1);
  });

  it('3v2 tam baskın: saldıran 0, savunan 2 kayıp', () => {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], 5);
    s = own(s, 'p2', ['stormfell'], 3);
    const out = attack(s, 'fangreach', 'stormfell', mockRng([6, 5, 4, 3, 2]));
    expect(out.attackerLosses).toBe(0);
    expect(out.defenderLosses).toBe(2);
    expect(out.state.territories.stormfell!.armies).toBe(1);
  });

  it('3v2 tam yenilgi: saldıran 2, savunan 0 kayıp', () => {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], 5);
    s = own(s, 'p2', ['stormfell'], 3);
    const out = attack(s, 'fangreach', 'stormfell', mockRng([1, 1, 1, 6, 6]));
    expect(out.attackerLosses).toBe(2);
    expect(out.defenderLosses).toBe(0);
    expect(out.state.territories.fangreach!.armies).toBe(3);
  });

  it('eşitlik kuralı 2. çiftte de geçerli: 6,3,2 vs 6,6 → saldıran 2 kayıp', () => {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], 4);
    s = own(s, 'p2', ['stormfell'], 2);
    const out = attack(s, 'fangreach', 'stormfell', mockRng([6, 3, 2, 6, 6]));
    expect(out.attackerLosses).toBe(2);
    expect(out.defenderLosses).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5) Fetih ve asker aktarımı
// ---------------------------------------------------------------------------

describe('fetih', () => {
  function captureState(attArmies: number, defArmies: number) {
    let s = splitState();
    s = own(s, 'p1', ['fangreach'], attArmies);
    s = own(s, 'p2', ['stormfell'], defArmies);
    return s;
  }

  it('savunan 0’a inince bölge ele geçirilir ve pendingCapture kurulur', () => {
    const s = captureState(4, 1);
    const out = attack(s, 'fangreach', 'stormfell', mockRng([6, 6, 6, 1]));
    expect(out.captured).toBe(true);
    expect(out.state.territories.stormfell!.ownerId).toBe('p1');
    expect(out.state.pendingCapture).not.toBeNull();
    expect(out.state.conqueredThisTurn).toBe(true);
  });

  it('aktarım alt sınırı = atılan saldıran zar sayısı', () => {
    const out = attack(captureState(5, 1), 'fangreach', 'stormfell', mockRng([6, 6, 6, 2]));
    expect(out.state.pendingCapture!.min).toBe(3);
  });

  it('aktarım üst sınırı: kaynak bölgede en az 1 asker kalır', () => {
    const out = attack(captureState(6, 1), 'fangreach', 'stormfell', mockRng([6, 2, 2, 1]));
    const pc = out.state.pendingCapture!;
    // 6 asker → 3 zar, 0 kayıp: min 3 (zar sayısı), en fazla 5 taşınabilir.
    expect(pc.min).toBe(3);
    expect(pc.max).toBe(5);
    const lo = confirmCapture(out.state, 0); // min'e clamp
    expect(lo.territories.stormfell!.armies).toBe(3);
    expect(lo.territories.fangreach!.armies).toBe(3);
    const hi = confirmCapture(out.state, 999); // max'a clamp
    expect(hi.territories.stormfell!.armies).toBe(5);
    expect(hi.territories.fangreach!.armies).toBe(1);
    expect(hi.pendingCapture).toBeNull();
  });

  it('aktarımdan sonra bölge sahibi ordusuyla yerleşir', () => {
    const out = attack(captureState(3, 1), 'fangreach', 'stormfell', mockRng([6, 1]));
    const s = confirmCapture(out.state, 2);
    expect(s.territories.stormfell!.ownerId).toBe('p1');
    expect(s.territories.stormfell!.armies).toBe(2);
    expect(s.territories.fangreach!.armies).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6) Eliminasyon ve zafer
// ---------------------------------------------------------------------------

describe('eliminasyon ve zafer', () => {
  it('son bölgesini kaybeden oyuncu elenir ve kartları fatihe geçer', () => {
    let s = splitState();
    const s3 = {
      id: 'p3',
      name: 'Cem',
      color: '#0f0',
      cards: [],
      eliminated: false,
      ai: false,
    };
    s = { ...s, players: [...s.players, s3] };
    // p2'nin tek bölgesi kalsın; p3 tampon bölgeyle zaferi engellesin.
    for (const id of REGION_IDS) if (s.territories[id]!.ownerId === 'p2') s = own(s, 'p1', [id], 1);
    s = own(s, 'p2', ['ironfrost'], 1);
    s = own(s, 'p3', ['stormcay'], 1);
    s = own(s, 'p1', ['stormfell'], 3);
    s = {
      ...s,
      players: s.players.map((p) => (p.id === 'p2' ? { ...p, cards: cardsFor('territory-stormcay') } : p)),
    };
    const out = attack(s, 'stormfell', 'ironfrost', mockRng([6, 6, 1]));
    expect(out.eliminatedId).toBe('p2');
    expect(out.state.players.find((p) => p.id === 'p2')!.eliminated).toBe(true);
    expect(out.state.players.find((p) => p.id === 'p1')!.cards).toHaveLength(1);
    expect(out.state.phase).not.toBe('VICTORY');
  });

  it('tüm 28 bölge tek oyuncuya geçince VICTORY tetiklenir', () => {
    let s = splitState();
    // p2'nin tek bölgesi kalsın → düşünce p1 28/28 olur.
    for (const id of REGION_IDS) if (s.territories[id]!.ownerId === 'p2') s = own(s, 'p1', [id], 1);
    s = own(s, 'p2', ['ironfrost'], 1);
    s = own(s, 'p1', ['stormfell'], 2);
    const out = attack(s, 'stormfell', 'ironfrost', mockRng([6, 1]));
    expect(out.state.phase).toBe('VICTORY');
    expect(out.state.winnerId).toBe('p1');
  });

  it('elenen oyuncu tur sonunda atlanır', () => {
    let s = mk({ deployPool: 0 });
    s = { ...s, players: s.players.map((p) => (p.id === 'p2' ? { ...p, eliminated: true } : p)) };
    const n = endTurn(s);
    expect(n.current).toBe(0); // p2 atlandı, tekrar p1
    expect(n.phase).toBe('DEPLOY');
  });
});

// ---------------------------------------------------------------------------
// 7) İntikal (fortify)
// ---------------------------------------------------------------------------

describe('intikal', () => {
  it('bağlı olmayan dost bölgeler arasında kaydırma reddedilir', () => {
    let s = mk({ phase: 'FORTIFY' });
    const p2ids = REGION_IDS.filter((id) => id !== 'fangreach' && id !== 'ironfrost');
    s = own(s, 'p2', p2ids);
    s = own(s, 'p1', ['fangreach'], 6);
    s = own(s, 'p1', ['ironfrost'], 1);
    expect(areConnected(s, 'p1', 'fangreach', 'ironfrost')).toBe(false);
    expect(canFortify(s, 'fangreach', 'ironfrost')).toContain('bağlı değil');
  });

  it('dost zinciri üzerinden kaydırma yapılabilir', () => {
    let s = mk({ phase: 'FORTIFY' });
    const p2ids = REGION_IDS.filter((id) => !['fangreach', 'stormfell', 'ironfrost'].includes(id));
    s = own(s, 'p2', p2ids);
    s = own(s, 'p1', ['fangreach', 'stormfell'], 5);
    s = own(s, 'p1', ['ironfrost'], 1);
    expect(areConnected(s, 'p1', 'fangreach', 'ironfrost')).toBe(true);
    const n = fortify(s, 'fangreach', 'ironfrost', 4);
    expect(n.territories.fangreach!.armies).toBe(1);
    expect(n.territories.ironfrost!.armies).toBe(5);
    expect(n.fortifyUsed).toBe(true);
  });

  it('kaynak bölgede en az 1 asker kalacak şekilde kırpılır', () => {
    let s = mk({ phase: 'FORTIFY' });
    s = own(s, 'p1', ['fangreach', 'stormfell'], 4);
    const n = fortify(s, 'fangreach', 'stormfell', 99);
    expect(n.territories.fangreach!.armies).toBe(1);
    expect(n.territories.stormfell!.armies).toBe(7);
  });

  it('turda ikinci kez kaydırılamaz', () => {
    let s = mk({ phase: 'FORTIFY' });
    s = own(s, 'p1', ['fangreach', 'stormfell'], 4);
    const n = fortify(s, 'fangreach', 'stormfell', 1);
    expect(canFortify(n, 'stormfell', 'fangreach')).toContain('kullanıldı');
    expect(fortify(n, 'stormfell', 'fangreach', 1)).toBe(n);
  });

  it('saldırı fazında kaydırma reddedilir', () => {
    const s = mk({ phase: 'ATTACK' });
    expect(canFortify(s, 'fangreach', 'stormfell')).toContain('fazında');
  });

  it('düşman bölgeye kaydırılamaz', () => {
    let s = mk({ phase: 'FORTIFY' });
    s = own(s, 'p2', ['glassholt']);
    expect(canFortify(s, 'fangreach', 'glassholt')).toContain('kendi toprakların');
  });
});

// ---------------------------------------------------------------------------
// 8) Kart takası
// ---------------------------------------------------------------------------

describe('kart takası', () => {
  it('üç farklı tür geçerli set', () => {
    expect(isValidSet(cardsFor('territory-fangreach', 'territory-larkspur', 'territory-sunspire'))).toBe(true);
  });
  it('üç aynı tür geçerli set', () => {
    expect(isValidSet(cardsFor('territory-fangreach', 'territory-stormfell', 'territory-ironfrost'))).toBe(true);
  });
  it('iki aynı + bir farklı GEÇERSİZ', () => {
    expect(isValidSet(cardsFor('territory-fangreach', 'territory-stormfell', 'territory-larkspur'))).toBe(false);
  });
  it('joker her tür yerine geçer', () => {
    expect(isValidSet(cardsFor('territory-joker-01', 'territory-fangreach', 'territory-stormfell'))).toBe(true);
  });
  it('takas tablosu klasik artan dizi: 4,6,8,10,12,15,18,21,26', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(tradeValue)).toEqual([4, 6, 8, 10, 12, 15, 18, 21, 26]);
  });
  it('geçerli takas havuza eklenir, kartlar atığa gider', () => {
    const set = cardsFor('territory-fangreach', 'territory-larkspur', 'territory-sunspire');
    let s = mk({ deployPool: 0 });
    s = { ...s, players: s.players.map((p) => (p.id === 'p1' ? { ...p, cards: set } : p)) };
    const n = trade(s, set);
    expect(n.deployPool).toBe(4);
    expect(n.players.find((p) => p.id === 'p1')!.cards).toHaveLength(0);
    expect(n.discard).toHaveLength(3);
    expect(n.tradesDone).toBe(1);
  });
  it('geçersiz set takas edilemez', () => {
    const bad = cardsFor('territory-fangreach', 'territory-stormfell', 'territory-larkspur');
    let s = mk({ deployPool: 0 });
    s = { ...s, players: s.players.map((p) => (p.id === 'p1' ? { ...p, cards: bad } : p)) };
    expect(trade(s, bad)).toBe(s);
  });
  it('findTradeSet elde set varsa bulur, yoksa null', () => {
    const good = cardsFor('territory-fangreach', 'territory-larkspur', 'territory-sunspire', 'territory-fangreach');
    expect(findTradeSet(good)).toHaveLength(3);
    expect(
      findTradeSet(cardsFor('territory-fangreach', 'territory-stormfell', 'territory-larkspur')),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9) Tur sonu ve kart çekme
// ---------------------------------------------------------------------------

describe('tur sonu', () => {
  it('takviye havuzu doluyken tur bitirilemez', () => {
    const s = mk({ deployPool: 2 });
    expect(endTurn(s)).toBe(s);
  });

  it('sıradaki oyuncuya geçer ve havuzu yeniden hesaplanır', () => {
    let s = mk({ deployPool: 0 });
    const n = endTurn(s);
    expect(n.current).toBe(1);
    expect(n.deployPool).toBe(computeDeployPool(n, 'p2'));
    expect(n.turn).toBe(2);
  });

  it('fetih yapılan turda bitirince kart çekilir', () => {
    let s = mk({ deployPool: 0, conqueredThisTurn: true });
    s = { ...s, players: s.players.map((p) => (p.id === 'p1' ? { ...p, eliminated: true } : p)) };
    const deckBefore = s.deck.length;
    const n = endTurn(s);
    expect(n.deck.length).toBe(deckBefore - 1);
    // p1 elendiği için sıra zaten p2'de kalır; kart çeken p1 eliminasyon dışında normal akışta test edilmez.
  });

  it('VICTORY fazında tur bitirilemez', () => {
    const s = mk({ phase: 'VICTORY', winnerId: 'p1', deployPool: 0 });
    expect(endTurn(s)).toBe(s);
  });

  it('ATTACK → FORTIFY geçişi yalnızca saldırı fazında', () => {
    expect(goToFortify(mk({ phase: 'DEPLOY' })).phase).toBe('DEPLOY');
    expect(goToFortify(mk({ phase: 'ATTACK' })).phase).toBe('FORTIFY');
  });
});

// ---------------------------------------------------------------------------
// 10) Kurulum ve genel tutarlılık
// ---------------------------------------------------------------------------

describe('kurulum', () => {
  it('createInitialState 28 bölgeyi eşit dağıtır ve hepsinde ≥1 asker var', () => {
    const s = createInitialState({
      players: [
        { name: 'A', color: '#f00' },
        { name: 'B', color: '#00f' },
      ],
      seed: 42,
    });
    const a = ownedTerritories(s, 'p1');
    const b = ownedTerritories(s, 'p2');
    expect(a.length).toBe(14);
    expect(b.length).toBe(14);
    expect(REGION_IDS.every((id) => s.territories[id]!.armies >= 1)).toBe(true);
    expect(s.phase).toBe('DEPLOY');
    expect(s.deployPool).toBeGreaterThan(computeDeployPool(s, 'p1')); // başlangıç ordusu dahil
  });

  it('deterministik tohum → aynı kurulum', () => {
    const mk2 = () =>
      createInitialState({
        players: [
          { name: 'A', color: '#f00' },
          { name: 'B', color: '#00f' },
          { name: 'C', color: '#0f0' },
        ],
        seed: 7,
      });
    expect(JSON.stringify(mk2().territories)).toBe(JSON.stringify(mk2().territories));
  });

  it('komşuluk grafı simetrik ve 28 bölge tek parça bağlı', () => {
    for (const id of REGION_IDS) {
      for (const nb of NEIGHBORS[id]!) {
        expect(NEIGHBORS[nb]).toContain(id);
      }
    }
    const seen = new Set([REGION_IDS[0]!]);
    const q = [REGION_IDS[0]!];
    while (q.length) {
      for (const nb of NEIGHBORS[q.shift()!]!) {
        if (!seen.has(nb)) {
          seen.add(nb);
          q.push(nb);
        }
      }
    }
    expect(seen.size).toBe(28);
  });
});
