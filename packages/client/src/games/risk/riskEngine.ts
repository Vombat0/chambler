/**
 * R2 — Territory Wars: saf Risk kural motoru.
 *
 * Tüm eylemler saf fonksiyonlardır: (state, params, rng?) → yeni state.
 * UI hiçbir kural kararı vermez; motor doğrular ve uygular.
 *
 * Fazlar: DEPLOY (Takviye) → ATTACK (Saldırı) → FORTIFY (İntikal) → VICTORY.
 */

import {
  CARD_DECK,
  CONTINENT_BY_ID,
  NEIGHBORS,
  REGION_IDS,
  type ContinentId,
  mulberry32,
  shuffled,
} from './boardData';

export type Phase = 'DEPLOY' | 'ATTACK' | 'FORTIFY' | 'VICTORY';
export type Rng = () => number;

// ---------------------------------------------------------------------------
// Durum modeli
// ---------------------------------------------------------------------------

export interface RiskCard {
  readonly id: string;
  readonly regionId: string | null;
  readonly kind: ContinentId;
  readonly wild: boolean;
}

export interface RiskPlayer {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly cards: readonly RiskCard[];
  readonly eliminated: boolean;
  readonly ai: boolean;
}

export interface Territory {
  readonly ownerId: string;
  readonly armies: number;
}

export interface CapturePending {
  readonly from: string;
  readonly to: string;
  /** En az bu kadar asker taşınmalı (atılan saldıran zar sayısı). */
  readonly min: number;
  /** En fazla bu kadar taşınabilir (kaynak bölgede ≥1 kalmalı). */
  readonly max: number;
}

export interface CombatLogEntry {
  readonly attacker: string;
  readonly defender: string;
  readonly attackerDice: readonly number[];
  readonly defenderDice: readonly number[];
  readonly attackerLosses: number;
  readonly defenderLosses: number;
  readonly captured: boolean;
}

export interface RiskState {
  readonly territories: Readonly<Record<string, Territory>>;
  readonly players: readonly RiskPlayer[];
  /** Sıradaki oyuncunun index'i. */
  readonly current: number;
  readonly phase: Phase;
  readonly deployPool: number;
  readonly deck: readonly RiskCard[];
  readonly discard: readonly RiskCard[];
  /** Bu turda en az bir bölge fethedildi mi (tur sonunda kart çektirir)? */
  readonly conqueredThisTurn: boolean;
  readonly fortifyUsed: boolean;
  readonly tradesDone: number;
  readonly pendingCapture: CapturePending | null;
  readonly winnerId: string | null;
  readonly turn: number;
  readonly log: readonly string[];
}

// ---------------------------------------------------------------------------
// Yardımcı sorgular
// ---------------------------------------------------------------------------

export function currentPlayer(state: RiskState): RiskPlayer {
  return state.players[state.current]!;
}

export function ownedTerritories(state: RiskState, playerId: string): string[] {
  return REGION_IDS.filter((id) => state.territories[id]!.ownerId === playerId);
}

export function armyCount(state: RiskState, playerId: string): number {
  return ownedTerritories(state, playerId).reduce((s, id) => s + state.territories[id]!.armies, 0);
}

export function alivePlayers(state: RiskState): RiskPlayer[] {
  return state.players.filter((p) => !p.eliminated);
}

/** Bölge tam sahibi tarafından kontrol ediliyorsa kıta bonusunu döner. */
export function continentBonus(state: RiskState, playerId: string): number {
  let bonus = 0;
  for (const c of Object.values(CONTINENT_BY_ID)) {
    if (c.members.every((m) => state.territories[m]!.ownerId === playerId)) bonus += c.bonus;
  }
  return bonus;
}

/** Kıtanın tamamına sahip oyuncu; yoksa null. */
export function continentOwner(state: RiskState, continentId: ContinentId): string | null {
  const def = CONTINENT_BY_ID[continentId];
  const first = state.territories[def.members[0]!]!.ownerId;
  return def.members.every((m) => state.territories[m]!.ownerId === first) ? first : null;
}

/** deployPool = max(3, floor(bölge/3)) + kıta bonusları. */
export function computeDeployPool(state: RiskState, playerId: string): number {
  const n = ownedTerritories(state, playerId).length;
  return Math.max(3, Math.floor(n / 3)) + continentBonus(state, playerId);
}

/** Aynı oyuncunun toprakları üzerinden `from`→`to` bağlı mı? */
export function areConnected(state: RiskState, playerId: string, from: string, to: string): boolean {
  if (from === to) return false;
  const owner = (id: string) => state.territories[id]!.ownerId;
  if (owner(from) !== playerId || owner(to) !== playerId) return false;
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of NEIGHBORS[cur] ?? []) {
      if (seen.has(nb) || owner(nb) !== playerId) continue;
      if (nb === to) return true;
      seen.add(nb);
      queue.push(nb);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Kurulum
// ---------------------------------------------------------------------------

export interface PlayerSetup {
  readonly name: string;
  readonly color: string;
  readonly ai?: boolean;
}

/** Oyuncu sayısına göre ilk takviye fazına eklenen başlangıç ordusu. */
export const STARTER_BONUS: Record<number, number> = { 2: 24, 3: 20, 4: 17 };

function emptyCards(): RiskCard[] {
  return CARD_DECK.map((c) => ({ id: c.id, regionId: c.regionId, kind: c.kind, wild: c.wild }));
}

export function createInitialState(opts: {
  players: readonly PlayerSetup[];
  seed?: number;
}): RiskState {
  if (opts.players.length < 2 || opts.players.length > 4) {
    throw new Error('2-4 oyuncu gerekir');
  }
  const rng = mulberry32(opts.seed ?? 1);

  const order = shuffled(REGION_IDS, rng);
  const territories: Record<string, Territory> = {};
  order.forEach((regionId, i) => {
    territories[regionId] = {
      ownerId: `p${(i % opts.players.length) + 1}`,
      armies: 1,
    };
  });
  // Dağılım: karıştırılmış sırayla round-robin → 2 oyunda 14/14, 3'te 10/9/9, 4'te 7'şer.
  const deck = shuffled(emptyCards(), rng);
  const firstId = 'p1';
  const state: RiskState = {
    territories,
    players: opts.players.map((p, i) => ({
      id: `p${i + 1}`,
      name: p.name,
      color: p.color,
      cards: [],
      eliminated: false,
      ai: p.ai === true,
    })),
    current: 0,
    phase: 'DEPLOY',
    deployPool: 0,
    deck,
    discard: [],
    conqueredThisTurn: false,
    fortifyUsed: false,
    tradesDone: 0,
    pendingCapture: null,
    winnerId: null,
    turn: 1,
    log: [`Savaş başladı! ${opts.players.length} ordu Aetheris için kapışıyor.`, `Sıra: ${opts.players[0]!.name}`],
  };
  return {
    ...state,
    deployPool: computeDeployPool(state, firstId) + (STARTER_BONUS[opts.players.length] ?? 20),
  };
}

// ---------------------------------------------------------------------------
// State yardımcıları
// ---------------------------------------------------------------------------

function withLog(state: RiskState, msg: string): RiskState {
  return { ...state, log: [...state.log, msg].slice(-80) };
}

function setTerritory(state: RiskState, id: string, t: Territory): RiskState {
  return { ...state, territories: { ...state.territories, [id]: t } };
}

// ---------------------------------------------------------------------------
// TAKVİYE
// ---------------------------------------------------------------------------

export function canDeploy(state: RiskState, regionId: string): boolean {
  const t = state.territories[regionId];
  return (
    state.phase === 'DEPLOY' &&
    state.pendingCapture === null &&
    state.deployPool > 0 &&
    !!t &&
    t.ownerId === currentPlayer(state).id
  );
}

/** Bölgeye havuzdan asker koyar. n>1 toplu dağıtım için. */
export function deploy(state: RiskState, regionId: string, n = 1): RiskState {
  const t = state.territories[regionId];
  if (state.phase !== 'DEPLOY' || !t || t.ownerId !== currentPlayer(state).id) return state;
  const count = Math.min(Math.max(1, Math.floor(n)), state.deployPool);
  if (count <= 0) return state;
  const next = setTerritory(state, regionId, { ...t, armies: t.armies + count });
  return { ...next, deployPool: next.deployPool - count };
}

/** Faz geçişi: DEPLOY → ATTACK (havuz bitmiş olmalı). */
export function goToAttack(state: RiskState): RiskState {
  if (state.phase !== 'DEPLOY' || state.deployPool > 0 || state.pendingCapture) return state;
  return { ...state, phase: 'ATTACK' };
}

// ---------------------------------------------------------------------------
// SALDIRI
// ---------------------------------------------------------------------------

export function canAttack(state: RiskState, from: string, to: string): string | null {
  if (state.phase !== 'ATTACK') return 'Saldırı fazında değilsin';
  if (state.pendingCapture) return 'Fetih tamamlanmayı bekliyor';
  const a = state.territories[from];
  const d = state.territories[to];
  if (!a || !d) return 'Bilinmeyen bölge';
  if (a.ownerId !== currentPlayer(state).id) return 'Bölge sana ait değil';
  if (a.armies < 2) return 'Saldırmak için en az 2 asker gerekir';
  if (!(NEIGHBORS[from] ?? []).includes(to)) return 'Bölgeler komşu değil';
  if (d.ownerId === a.ownerId) return 'Kendi bölgenize saldırılamaz';
  return null;
}

export interface AttackOutcome {
  readonly state: RiskState;
  readonly attackerDice: readonly number[];
  readonly defenderDice: readonly number[];
  readonly attackerLosses: number;
  readonly defenderLosses: number;
  readonly captured: boolean;
  readonly eliminatedId: string | null;
}

/** d6 atar, büyükten küçüğe sıralar. */
export function rollDice(count: number, rng: Rng): number[] {
  return Array.from({ length: count }, () => 1 + Math.floor(rng() * 6)).sort((x, y) => y - x);
}

/**
 * Bir zar kapışması yürütür. Eşitlikte SAVUNAN kazanır.
 * Bölge düştüyse pendingCapture ayarlanır (asker aktarımı bekler).
 */
export function attack(state: RiskState, from: string, to: string, rng: Rng): AttackOutcome {
  const err = canAttack(state, from, to);
  if (err) {
    return {
      state,
      attackerDice: [],
      defenderDice: [],
      attackerLosses: 0,
      defenderLosses: 0,
      captured: false,
      eliminatedId: null,
    };
  }
  const a = state.territories[from]!;
  const d = state.territories[to]!;
  const attackerDice = rollDice(Math.min(3, a.armies - 1), rng);
  const defenderDice = rollDice(Math.min(2, d.armies), rng);

  let aLoss = 0;
  let dLoss = 0;
  const pairs = Math.min(attackerDice.length, defenderDice.length);
  for (let i = 0; i < pairs; i++) {
    if (attackerDice[i]! > defenderDice[i]!) dLoss += 1;
    else aLoss += 1; // eşitlikte savunan kazanır
  }

  const defOwner = d.ownerId;

  let next = state;
  const attackerLeft = a.armies - aLoss;

  if (d.armies - dLoss <= 0) {
    // Fetih: bölge saldıranın olur; asker aktarımı pendingCapture ile tamamlanır.
    // Alt sınır klasik kural: en az atılan zar sayısı — ama saldıran kayıpları
    // yüzünden kaynak bölgede ≥1 asker kalamayacaksa sınır mümkün olana kırpılır.
    const minMove = Math.min(attackerDice.length, Math.max(1, attackerLeft - 1));
    const maxMove = Math.max(minMove, attackerLeft - 1);
    next = setTerritory(next, from, { ...a, armies: attackerLeft });
    next = setTerritory(next, to, { ownerId: a.ownerId, armies: 0 });
    next = {
      ...next,
      pendingCapture: { from, to, min: minMove, max: maxMove },
      conqueredThisTurn: true,
    };

    // Eliminasyon: savunanın son bölgesi miydi?
    const victimLeft = ownedTerritories(next, defOwner);
    let eliminatedId: string | null = null;
    if (victimLeft.length === 0) {
      eliminatedId = defOwner;
      const victim = next.players.find((p) => p.id === defOwner)!;
      const players = next.players.map((p) =>
        p.id === defOwner
          ? { ...p, eliminated: true }
          : p.id === a.ownerId
            ? { ...p, cards: [...p.cards, ...victim.cards] }
            : p,
      );
      next = { ...next, players };
      const victimName = victim.name;
      const winnerName = currentPlayer(next).name;
      next = withLog(next, `☠ ${victimName} elendi! Kartları ${winnerName} adlı fatihe geçti.`);
    }

    // Zafer: tek oyuncu tüm bölgelere mi sahip?
    const ownerSet = new Set(REGION_IDS.map((id) => next.territories[id]!.ownerId));
    if (ownerSet.size === 1) {
      const winnerId = [...ownerSet][0]!;
      // Son fethedilen bölgeye en az alt sınır kadar asker konuşlandır, sonra fazı kapat.
      const moved = Math.max(1, Math.min(minMove, attackerLeft - 1));
      next = setTerritory(next, from, { ownerId: winnerId, armies: attackerLeft - moved });
      next = setTerritory(next, to, { ownerId: winnerId, armies: moved });
      next = {
        ...next,
        phase: 'VICTORY',
        winnerId,
        pendingCapture: null,
      };
      next = withLog(
        next,
        `👑 ${next.players.find((p) => p.id === winnerId)!.name} Aetheris'in tamamını fethetti!`,
      );
    }

    next = withLog(
      next,
      `⚔ ${from} → ${to} FETİH EDİLDİ! (${diceSummary(attackerDice)} vs ${diceSummary(defenderDice)})`,
    );
    return {
      state: next,
      attackerDice,
      defenderDice,
      attackerLosses: aLoss,
      defenderLosses: dLoss,
      captured: true,
      eliminatedId,
    };
  }

  next = setTerritory(next, from, { ...a, armies: attackerLeft });
  next = setTerritory(next, to, { ...d, armies: d.armies - dLoss });
  next = withLog(
    next,
    `⚔ ${from} → ${to}: ${diceSummary(attackerDice)} vs ${diceSummary(defenderDice)} — saldırgan ${aLoss}, savunan ${dLoss} kaybetti.`,
  );
  return {
    state: next,
    attackerDice,
    defenderDice,
    attackerLosses: aLoss,
    defenderLosses: dLoss,
    captured: false,
    eliminatedId: null,
  };
}

function diceSummary(dice: readonly number[]): string {
  return `[${dice.join(',')}]`;
}

/**
 * Fetih sonrası asker aktarımı. min ≤ count ≤ max zorunlu;
 * kaynak bölgede en az 1 asker kalmalıdır.
 */
export function confirmCapture(state: RiskState, count: number): RiskState {
  const pc = state.pendingCapture;
  if (!pc) return state;
  const from = state.territories[pc.from]!;
  const moved = Math.min(Math.max(count, pc.min), pc.max);
  if (from.armies - moved < 1) return state;
  let next = setTerritory(state, pc.from, { ...from, armies: from.armies - moved });
  next = setTerritory(next, pc.to, { ownerId: from.ownerId, armies: moved });
  next = { ...next, pendingCapture: null };
  return withLog(next, `→ ${pc.to} içine ${moved} asker konuşlandı.`);
}

// ---------------------------------------------------------------------------
// KARTE TAKASI
// ---------------------------------------------------------------------------

/** Klasik Risk artan takas tablosu. */
export function tradeValue(tradesDone: number): number {
  const table = [4, 6, 8, 10, 12, 15, 18, 21];
  return tradesDone < table.length ? table[tradesDone]! : 21 + 5 * (tradesDone - 7);
}

/** 3 kartlık set geçerli mi? (joker her türü sayılır) */
export function isValidSet(cards: readonly RiskCard[]): boolean {
  if (cards.length !== 3) return false;
  const wilds = cards.filter((c) => c.wild).length;
  const kinds = cards.filter((c) => !c.wild).map((c) => c.kind);
  if (wilds === 2) return true;
  if (wilds === 1) return true; // joker + herhangi 2 kart
  const unique = new Set(kinds);
  return unique.size === 1 || unique.size === 3;
}

/** Elindeki kartlardan geçerli bir set bulur (yoksa null). */
export function findTradeSet(cards: readonly RiskCard[]): RiskCard[] | null {
  for (let i = 0; i < cards.length - 2; i++) {
    for (let j = i + 1; j < cards.length - 1; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        const set = [cards[i]!, cards[j]!, cards[k]!];
        if (isValidSet(set)) return set;
      }
    }
  }
  return null;
}

export function canTrade(state: RiskState): RiskCard[] | null {
  if (state.phase !== 'DEPLOY') return null;
  const me = currentPlayer(state);
  return findTradeSet(me.cards);
}

export function trade(state: RiskState, cards: readonly RiskCard[]): RiskState {
  if (state.phase !== 'DEPLOY') return state;
  if (!isValidSet(cards)) return state;
  const me = currentPlayer(state);
  // Kartların gerçekten elde olduğundan emin ol (id bazında tam eşleşme).
  const handIds = new Set(me.cards.map((c) => c.id));
  for (const c of cards) if (!handIds.has(c.id)) return state;
  const ids = new Set(cards.map((c) => c.id));

  const value = tradeValue(state.tradesDone);
  const players = state.players.map((p) =>
    p.id === me.id ? { ...p, cards: p.cards.filter((c) => !ids.has(c.id)) } : p,
  );
  const next: RiskState = {
    ...state,
    players,
    discard: [...state.discard, ...cards],
    tradesDone: state.tradesDone + 1,
    deployPool: state.deployPool + value,
  };
  return withLog(next, `🃏 ${me.name} kart seti takas etti: +${value} takviye.`);
}

// ---------------------------------------------------------------------------
// İNTİKAL (FORTIFY)
// ---------------------------------------------------------------------------

export function canFortify(state: RiskState, from: string, to: string): string | null {
  if (state.phase !== 'FORTIFY') return 'İntikal fazında değilsin';
  if (state.fortifyUsed) return 'Bu turda asker kaydırma kullanıldı';
  if (state.pendingCapture) return 'Fetih tamamlanmayı bekliyor';
  const a = state.territories[from];
  const b = state.territories[to];
  if (!a || !b) return 'Bilinmeyen bölge';
  const me = currentPlayer(state).id;
  if (a.ownerId !== me || b.ownerId !== me) return 'Yalnızca kendi toprakların arasında';
  if (a.armies < 2) return 'Kaynak bölgede en az 2 asker olmalı';
  if (!areConnected(state, me, from, to)) return 'Bölgeler dost topraklar üzerinden bağlı değil';
  return null;
}

export function fortify(state: RiskState, from: string, to: string, count: number): RiskState {
  const err = canFortify(state, from, to);
  if (err) return state;
  const a = state.territories[from]!;
  const b = state.territories[to]!;
  const moved = Math.min(Math.max(1, Math.floor(count)), a.armies - 1);
  if (moved < 1) return state;
  let next = setTerritory(state, from, { ...a, armies: a.armies - moved });
  next = setTerritory(next, to, { ...b, armies: b.armies + moved });
  next = { ...next, fortifyUsed: true };
  return withLog(next, `⇢ ${a.armies} → ${moved} asker ${from} üzerinden ${to} bölgesine kaydı.`);
}

// ---------------------------------------------------------------------------
// TUR SONU
// ---------------------------------------------------------------------------

function drawCard(state: RiskState, playerId: string): RiskState {
  if (state.deck.length === 0 && state.discard.length === 0) return state;
  if (state.deck.length === 0) {
    const rng = mulberry32(state.turn * 7919 + 13);
    return { ...state, deck: shuffled(state.discard, rng), discard: [] };
  }
  const [card, ...rest] = state.deck;
  const players = state.players.map((p) =>
    p.id === playerId ? { ...p, cards: [...p.cards, card!] } : p,
  );
  return withLog(
    { ...state, deck: rest, players },
    `🃏 ${state.players.find((p) => p.id === playerId)!.name} fetih kartı çekti.`,
  );
}

/** Sıradaki hayatta oyuncuya geç; havuzu hesapla. Havuz doluyken bitirilemez. */
export function endTurn(state: RiskState): RiskState {
  if (state.phase === 'VICTORY' || state.pendingCapture) return state;
  if (state.deployPool > 0) return state;

  let next: RiskState = { ...state };
  if (state.conqueredThisTurn) next = drawCard(next, currentPlayer(state).id);

  let idx = state.current;
  for (let step = 0; step < state.players.length; step++) {
    idx = (idx + 1) % state.players.length;
    if (!next.players[idx]!.eliminated) break;
  }
  next = {
    ...next,
    current: idx,
    phase: 'DEPLOY',
    fortifyUsed: false,
    conqueredThisTurn: false,
    turn: state.turn + 1,
    pendingCapture: null,
  };
  next = { ...next, deployPool: computeDeployPool(next, next.players[idx]!.id) };
  return withLog(next, `— Sıra: ${next.players[idx]!.name} (takviye: ${next.deployPool})`);
}

export function goToFortify(state: RiskState): RiskState {
  if (state.phase !== 'ATTACK' || state.pendingCapture) return state;
  return { ...state, phase: 'FORTIFY' };
}
