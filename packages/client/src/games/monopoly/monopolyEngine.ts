/**
 * Mülk Tycoon — saf kural motoru.
 *
 * Motor React'ten bağımsızdır; her eylem yeni bir `MonopolyState` döndürür.
 * Tahta/hücre/deste verisi paketten (`packs/property-tycoon`) gelir.
 *
 * Kritik kural: zar sonrası piyon konumu DAİMA `(position + sum) % 40` ile
 * hesaplanır. Başlangıç hücresine yalnızca gerçekten oraya varıldığında
 * dönülür; "her zar atışında başa dönme" hatası burada yapısal olarak
 * imkânsızdır (bkz. `moveBySteps`).
 */

import {
  BOARD_JSON,
  CHANCE_DECK,
  COMMUNITY_DECK,
  GROUPS_JSON,
  cardText,
  type DeckCard,
} from '../../board2d/boardData.js';

export const BOARD_SIZE = 40;
export const STARTING_CASH = 1500;
export const GO_SALARY = 200;
export const JAIL_INDEX = 10;
export const GO_TO_JAIL_INDEX = 30;
export const JAIL_FINE = 50;
export const MAX_JAIL_TURNS = 3;

export type CellType =
  | 'start'
  | 'property'
  | 'transport'
  | 'energy'
  | 'tax'
  | 'chance'
  | 'community'
  | 'jail'
  | 'free-parking'
  | 'go-to-jail';

export interface MonopolyCell {
  readonly index: number;
  readonly id?: string;
  readonly slug?: string;
  readonly type: CellType;
  readonly side: 'bottom' | 'left' | 'top' | 'right';
  readonly slot: number;
  readonly groupId?: string;
  readonly price?: number;
  /** [temel, tam grup, 1 ev, 2 ev, 3 ev, 4 ev, otel] */
  readonly rent?: readonly number[];
  readonly houseCost?: number;
  readonly hotelCost?: number;
  readonly mortgage?: number;
  readonly taxAmount?: number;
  readonly deckId?: 'chance' | 'community';
  readonly salary?: number;
  readonly targetIndex?: number;
  readonly rentMode?: 'dice-multiplier';
  readonly collectsPot?: boolean;
}

export interface MonopolyGroup {
  readonly id: string;
  readonly nameKey?: string;
  readonly color: string;
  readonly members: readonly number[];
  readonly size?: number;
  readonly houseCost?: number;
  readonly hotelCost?: number;
}

export const CELLS: readonly MonopolyCell[] = BOARD_JSON.cells as unknown as MonopolyCell[];
export const GROUPS: readonly MonopolyGroup[] = GROUPS_JSON as unknown as MonopolyGroup[];

const CELL_BY_INDEX = new Map<number, MonopolyCell>(CELLS.map((cell) => [cell.index, cell]));
const CARD_BY_ID = new Map<string, DeckCard>();
for (const card of [...CHANCE_DECK.cards, ...COMMUNITY_DECK.cards]) CARD_BY_ID.set(card.id, card);

export function cellAt(index: number): MonopolyCell | undefined {
  return CELL_BY_INDEX.get(index);
}

export function groupById(id: string | undefined): MonopolyGroup | undefined {
  if (!id) return undefined;
  return GROUPS.find((group) => group.id === id);
}

export function groupMembers(id: string): readonly number[] {
  return groupById(id)?.members ?? [];
}

/* --------------------------------- tipler --------------------------------- */

export interface PropertyHolding {
  mortgaged: boolean;
  /** 0..4 ev, 5 otel. */
  houses: number;
}

export interface MonopolyPlayer {
  id: string;
  name: string;
  color: string;
  cash: number;
  /** 0..39 tahta konumu. */
  position: number;
  inJail: boolean;
  /** Hapishanede başarısız çıkış denemesi sayısı. */
  jailTurns: number;
  getOutOfJailCards: number;
  bankrupt: boolean;
  /** Hücre indeksi (string anahtar) → sahiplik. */
  properties: Record<string, PropertyHolding>;
  /** Fırsat kartıyla kaybedilen tur sayısı. */
  skipTurns: number;
}

export type TurnPhase = 'ROLL' | 'ACTION' | 'JAIL_DECISION' | 'TURN_END';

export interface DiceState {
  die1: number;
  die2: number;
  /** Bu turda atılan ardışık çift sayısı. */
  doublesCount: number;
}

export type CardEffect =
  | { type: 'money'; amount: number }
  | { type: 'move'; toIndex: number; collectSalary?: boolean }
  | { type: 'jail'; toIndex?: number }
  | { type: 'collect-each'; amount: number }
  | { type: 'pay-each'; amount: number }
  | { type: 'extra-turn' }
  | { type: 'skip-turn' };

export interface PendingCard {
  deck: 'chance' | 'community';
  cardId: string;
  title: string;
  text: string;
  effect: CardEffect;
}

export type GameEvent =
  | {
      type: 'move';
      playerId: string;
      from: number;
      to: number;
      /** Adım adım animasyon için ara kareler (hedef dahil). */
      path: number[];
      passedGo: boolean;
      reason: 'dice' | 'card' | 'jail' | 'teleport';
    }
  | { type: 'dice'; playerId: string; die1: number; die2: number; sum: number; doubles: boolean }
  | { type: 'salary'; playerId: string; amount: number }
  | { type: 'purchase-offer'; playerId: string; cellIndex: number; price: number }
  | { type: 'purchase'; playerId: string; cellIndex: number; price: number }
  | { type: 'decline'; playerId: string; cellIndex: number }
  | { type: 'rent'; from: string; to: string; cellIndex: number; amount: number }
  | { type: 'tax'; playerId: string; cellIndex: number; amount: number }
  | { type: 'card'; playerId: string; deck: 'chance' | 'community'; cardId: string; title: string; text: string }
  | { type: 'jail'; playerId: string; reason: 'goto' | 'doubles' | 'card' }
  | { type: 'jail-release'; playerId: string; method: 'pay' | 'card' | 'doubles' | 'timeout' }
  | { type: 'bankrupt'; playerId: string; creditorId: string | null }
  | { type: 'build'; playerId: string; cellIndex: number; houses: number; cost: number }
  | { type: 'sell-house'; playerId: string; cellIndex: number; houses: number; refund: number }
  | { type: 'mortgage'; playerId: string; cellIndex: number; amount: number }
  | { type: 'unmortgage'; playerId: string; cellIndex: number; amount: number }
  | { type: 'turn'; playerId: string; round: number }
  | { type: 'skip-turn'; playerId: string }
  | { type: 'winner'; playerId: string }
  | { type: 'info'; message: string };

export interface MonopolyState {
  players: MonopolyPlayer[];
  currentPlayerIndex: number;
  phase: TurnPhase;
  dice: DiceState;
  round: number;
  /** Kural motorunun son eylemde ürettiği olaylar (UI animasyonu için). */
  lastEvents: GameEvent[];
  /** Her eylemde artar; React effect'lerinin aynı olayı iki kez işlemesini önler. */
  actionSeq: number;
  pendingPurchase: number | null;
  pendingCard: PendingCard | null;
  chanceOrder: string[];
  chanceCursor: number;
  communityOrder: string[];
  communityCursor: number;
  /** Serbest Pazar'da biriken vergi/ceza havuzu. */
  freeParkingPot: number;
  /** Fırsat kartının verdiği ek zar hakkı. */
  bonusRoll: boolean;
  winnerId: string | null;
}

export interface PlayerConfig {
  id?: string;
  name: string;
  color?: string;
}

export interface CreateGameOptions {
  startingCash?: number;
  rng?: () => number;
  /** Testlerde deterministik deste sırası. */
  chanceOrder?: readonly string[];
  communityOrder?: readonly string[];
}

export const PLAYER_COLORS = [
  '#e4572e',
  '#2e86ab',
  '#38a169',
  '#d4a017',
  '#8e44ad',
  '#d64570',
] as const;

/* ------------------------------- yardımcılar ------------------------------- */

function clampDie(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(6, Math.max(1, Math.floor(value)));
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

function clone(state: MonopolyState): MonopolyState {
  return structuredClone(state);
}

function begin(state: MonopolyState): MonopolyState {
  const draft = structuredClone(state);
  draft.lastEvents = [];
  draft.actionSeq += 1;
  return draft;
}

function push(draft: MonopolyState, event: GameEvent): void {
  draft.lastEvents.push(event);
}

export function currentPlayer(state: MonopolyState): MonopolyPlayer {
  const player = state.players[state.currentPlayerIndex];
  if (!player) throw new Error('monopoly: geçersiz oyuncu indeksi');
  return player;
}

export function playerById(state: MonopolyState, id: string): MonopolyPlayer | undefined {
  return state.players.find((player) => player.id === id);
}

export function activePlayers(state: MonopolyState): MonopolyPlayer[] {
  return state.players.filter((player) => !player.bankrupt);
}

export function isGameOver(state: MonopolyState): boolean {
  return state.winnerId !== null;
}

export function rolledSum(state: MonopolyState): number {
  return state.dice.die1 + state.dice.die2;
}

/* -------------------------------- oyun kurma ------------------------------- */

export function createGame(players: readonly PlayerConfig[], options: CreateGameOptions = {}): MonopolyState {
  if (players.length < 2) throw new Error('monopoly: en az 2 oyuncu gerekli');
  if (players.length > 6) throw new Error('monopoly: en fazla 6 oyuncu desteklenir');
  const rng = options.rng ?? Math.random;
  const startingCash = options.startingCash ?? STARTING_CASH;

  const state: MonopolyState = {
    players: players.map((config, index) => ({
      id: config.id ?? `p${index + 1}`,
      name: config.name.trim() || `Oyuncu ${index + 1}`,
      color: config.color ?? PLAYER_COLORS[index % PLAYER_COLORS.length]!,
      cash: startingCash,
      position: 0,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: {},
      skipTurns: 0,
    })),
    currentPlayerIndex: 0,
    phase: 'ROLL',
    dice: { die1: 0, die2: 0, doublesCount: 0 },
    round: 1,
    lastEvents: [],
    actionSeq: 0,
    pendingPurchase: null,
    pendingCard: null,
    chanceOrder: options.chanceOrder ? [...options.chanceOrder] : shuffle(CHANCE_DECK.cards.map((c) => c.id), rng),
    chanceCursor: 0,
    communityOrder: options.communityOrder
      ? [...options.communityOrder]
      : shuffle(COMMUNITY_DECK.cards.map((c) => c.id), rng),
    communityCursor: 0,
    freeParkingPot: 0,
    bonusRoll: false,
    winnerId: null,
  };
  // İlk oyuncu için tur olayı (UI "sıra sende" göstergesi).
  state.lastEvents = [{ type: 'turn', playerId: state.players[0]!.id, round: 1 }];
  return state;
}

/* ------------------------------ sahiplik / kira ---------------------------- */

export function holdingOf(player: MonopolyPlayer, cellIndex: number): PropertyHolding | undefined {
  return player.properties[String(cellIndex)];
}

export function ownerOf(state: MonopolyState, cellIndex: number): MonopolyPlayer | undefined {
  return state.players.find((player) => !player.bankrupt && player.properties[String(cellIndex)] !== undefined);
}

export function ownsFullGroup(state: MonopolyState, player: MonopolyPlayer, groupId: string | undefined): boolean {
  const members = groupMembers(groupId ?? '');
  if (members.length === 0) return false;
  return members.every((index) => {
    const holding = holdingOf(player, index);
    return holding !== undefined;
  });
}

function groupIsBuildable(state: MonopolyState, player: MonopolyPlayer, groupId: string): boolean {
  const members = groupMembers(groupId);
  return (
    members.length > 0 &&
    members.every((index) => {
      const holding = holdingOf(player, index);
      return holding !== undefined && !holding.mortgaged;
    })
  );
}

const TRANSPORT_INDICES = [5, 15, 25, 35] as const;
const ENERGY_INDICES = [12, 28] as const;

function countOwnedIndices(player: MonopolyPlayer, indices: readonly number[]): number {
  return indices.filter((index) => holdingOf(player, index) !== undefined).length;
}

export function countGroupOwned(state: MonopolyState, player: MonopolyPlayer, groupId: string): number {
  if (groupId === 'liman') return countOwnedIndices(player, TRANSPORT_INDICES);
  if (groupId === 'enerji') return countOwnedIndices(player, ENERGY_INDICES);
  return groupMembers(groupId).filter((index) => holdingOf(player, index) !== undefined).length;
}

/**
 * Kira hesabı. `diceSum` enerji hücreleri için son zar toplamıdır.
 * Mortgaged mülk kira getirmez.
 */
export function calculateRent(state: MonopolyState, cellIndex: number, diceSum = rolledSum(state)): number {
  const cell = cellAt(cellIndex);
  const owner = ownerOf(state, cellIndex);
  if (!cell || !owner) return 0;
  const holding = holdingOf(owner, cellIndex);
  if (!holding || holding.mortgaged) return 0;
  const rents = cell.rent ?? [];

  if (cell.type === 'property') {
    if (holding.houses >= 1) {
      return rents[Math.min(rents.length - 1, 1 + holding.houses)] ?? 0;
    }
    const doubled = ownsFullGroup(state, owner, cell.groupId) && groupIsBuildable(state, owner, cell.groupId ?? '');
    return doubled ? rents[1] ?? (rents[0] ?? 0) * 2 : rents[0] ?? 0;
  }

  if (cell.type === 'transport') {
    const count = countGroupOwned(state, owner, 'liman');
    return rents[Math.min(rents.length - 1, Math.max(0, count - 1))] ?? 0;
  }

  if (cell.type === 'energy') {
    const count = countGroupOwned(state, owner, 'enerji');
    const multiplier = count >= 2 ? rents[1] ?? 10 : rents[0] ?? 4;
    return multiplier * Math.max(0, diceSum);
  }

  return 0;
}

/* --------------------------------- hareket -------------------------------- */

interface MoveResult {
  from: number;
  to: number;
  path: number[];
  passedGo: boolean;
}

/** Adım adım yol üretir; konum daima modulo 40'ta kalır. */
function walk(from: number, steps: number): MoveResult {
  if (steps <= 0) return { from, to: from, path: [], passedGo: false };
  const path: number[] = [];
  let cursor = from;
  for (let i = 0; i < steps; i += 1) {
    cursor = (cursor + 1) % BOARD_SIZE;
    path.push(cursor);
  }
  return {
    from,
    to: cursor,
    path,
    passedGo: from + steps >= BOARD_SIZE,
  };
}

function applyMove(
  draft: MonopolyState,
  player: MonopolyPlayer,
  result: MoveResult,
  reason: 'dice' | 'card' | 'jail' | 'teleport',
): void {
  player.position = result.to;
  push(draft, {
    type: 'move',
    playerId: player.id,
    from: result.from,
    to: result.to,
    path: result.path,
    passedGo: result.passedGo,
    reason,
  });
  if (result.passedGo) {
    player.cash += GO_SALARY;
    push(draft, { type: 'salary', playerId: player.id, amount: GO_SALARY });
  }
}

function moveBySteps(draft: MonopolyState, player: MonopolyPlayer, steps: number): void {
  const result = walk(player.position, steps);
  applyMove(draft, player, result, 'dice');
}

function moveToIndex(draft: MonopolyState, player: MonopolyPlayer, target: number, collectSalary: boolean): void {
  const from = player.position;
  const normalized = ((target % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
  let path: number[] = [];
  let salary = false;
  if (normalized !== from) {
    const steps = (normalized - from + BOARD_SIZE) % BOARD_SIZE;
    const result = walk(from, steps);
    path = result.path;
    salary = collectSalary && result.passedGo;
  }
  player.position = normalized;
  push(draft, { type: 'move', playerId: player.id, from, to: normalized, path, passedGo: salary, reason: 'card' });
  if (salary) {
    player.cash += GO_SALARY;
    push(draft, { type: 'salary', playerId: player.id, amount: GO_SALARY });
  }
}

function sendToJail(draft: MonopolyState, player: MonopolyPlayer, reason: 'goto' | 'doubles' | 'card'): void {
  const from = player.position;
  player.position = JAIL_INDEX;
  player.inJail = true;
  player.jailTurns = 0;
  draft.dice.doublesCount = 0;
  draft.bonusRoll = false;
  push(draft, {
    type: 'move',
    playerId: player.id,
    from,
    to: JAIL_INDEX,
    path: from === JAIL_INDEX ? [] : [JAIL_INDEX],
    passedGo: false,
    reason: 'jail',
  });
  push(draft, { type: 'jail', playerId: player.id, reason });
  draft.phase = 'TURN_END';
}

/* -------------------------------- ödeme / iflas ---------------------------- */

function removeAllProperties(player: MonopolyPlayer, newOwner: MonopolyPlayer | null): void {
  if (newOwner) {
    for (const [key, holding] of Object.entries(player.properties)) {
      newOwner.properties[key] = { mortgaged: holding.mortgaged, houses: 0 };
    }
  }
  player.properties = {};
}

function declareBankruptcy(draft: MonopolyState, player: MonopolyPlayer, creditor: MonopolyPlayer | null): void {
  if (player.bankrupt) return;
  if (creditor && creditor.id !== player.id) {
    creditor.cash += player.cash;
    removeAllProperties(player, creditor);
  } else {
    removeAllProperties(player, null);
  }
  player.cash = 0;
  player.bankrupt = true;
  player.inJail = false;
  draft.pendingPurchase = draft.pendingPurchase !== null && currentPlayer(draft).id === player.id ? null : draft.pendingPurchase;
  push(draft, { type: 'bankrupt', playerId: player.id, creditorId: creditor?.id ?? null });

  const remaining = activePlayers(draft);
  if (remaining.length === 1 && remaining[0]) {
    draft.winnerId = remaining[0].id;
    draft.phase = 'TURN_END';
    push(draft, { type: 'winner', playerId: remaining[0].id });
  }
}

/** Para transferi; yetersizse oyuncuyu iflas ettirir. */
function payMoney(
  draft: MonopolyState,
  payer: MonopolyPlayer,
  creditor: MonopolyPlayer | null,
  amount: number,
): number {
  if (amount <= 0) return 0;
  const paid = Math.min(payer.cash, amount);
  payer.cash -= paid;
  if (creditor && creditor.id !== payer.id) creditor.cash += paid;
  else draft.freeParkingPot += paid;
  if (paid < amount) declareBankruptcy(draft, payer, creditor);
  return paid;
}

/* ---------------------------------- kartlar -------------------------------- */

function parseEffect(raw: Record<string, unknown> | undefined): CardEffect | null {
  if (!raw || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'money':
      return typeof raw.amount === 'number' ? { type: 'money', amount: raw.amount } : null;
    case 'move':
      return typeof raw.toIndex === 'number'
        ? { type: 'move', toIndex: raw.toIndex, collectSalary: raw.collectSalary === true }
        : null;
    case 'jail':
      return { type: 'jail', toIndex: typeof raw.toIndex === 'number' ? raw.toIndex : JAIL_INDEX };
    case 'collect-each':
      return typeof raw.amount === 'number' ? { type: 'collect-each', amount: raw.amount } : null;
    case 'pay-each':
      return typeof raw.amount === 'number' ? { type: 'pay-each', amount: raw.amount } : null;
    case 'extra-turn':
      return { type: 'extra-turn' };
    case 'skip-turn':
      return { type: 'skip-turn' };
    default:
      return null;
  }
}

function applyCardEffect(draft: MonopolyState, player: MonopolyPlayer, effect: CardEffect): void {
  switch (effect.type) {
    case 'money': {
      if (effect.amount >= 0) {
        player.cash += effect.amount;
      } else {
        payMoney(draft, player, null, -effect.amount);
      }
      return;
    }
    case 'collect-each': {
      for (const other of draft.players) {
        if (other.id === player.id || other.bankrupt) continue;
        player.cash += payMoney(draft, other, player, effect.amount);
      }
      return;
    }
    case 'pay-each': {
      for (const other of draft.players) {
        if (other.id === player.id || other.bankrupt) continue;
        payMoney(draft, player, other, effect.amount);
        if (player.bankrupt) break;
      }
      return;
    }
    case 'move': {
      if (player.bankrupt) return;
      const target = effect.toIndex;
      // "Hapishaneye git" kartı maaş ödemez; diğer ilerlemeler GO'dan
      // geçerse standart maaş kuralı işler.
      moveToIndex(draft, player, target, effect.collectSalary === true || target !== JAIL_INDEX);
      if (target === JAIL_INDEX && effect.collectSalary !== true) {
        // Misafirhane'ye "ilerle" kartı: hapse girmez, sadece ziyaret eder.
      }
      resolveLanding(draft, player, false);
      return;
    }
    case 'jail': {
      sendToJail(draft, player, 'card');
      return;
    }
    case 'extra-turn': {
      draft.bonusRoll = true;
      return;
    }
    case 'skip-turn': {
      player.skipTurns += 1;
      draft.phase = 'TURN_END';
      return;
    }
  }
}

function drawCard(draft: MonopolyState, player: MonopolyPlayer, deck: 'chance' | 'community'): void {
  const order = deck === 'chance' ? draft.chanceOrder : draft.communityOrder;
  const cursor = deck === 'chance' ? draft.chanceCursor : draft.communityCursor;
  if (order.length === 0) return;
  const cardId = order[cursor % order.length]!;
  if (deck === 'chance') draft.chanceCursor = (cursor + 1) % order.length;
  else draft.communityCursor = (cursor + 1) % order.length;

  const card = CARD_BY_ID.get(cardId);
  if (!card) return;
  const { title, text } = cardText(card, 'tr');
  const effect = parseEffect(card.effect);
  if (!effect) return;

  draft.pendingCard = { deck, cardId, title, text, effect };
  push(draft, { type: 'card', playerId: player.id, deck, cardId, title, text });
  applyCardEffect(draft, player, effect);
}

/* ------------------------------ hücre çözümleme ---------------------------- */

function resolveLanding(draft: MonopolyState, player: MonopolyPlayer, allowCards = true): void {
  if (player.bankrupt) {
    draft.phase = 'TURN_END';
    return;
  }
  const cell = cellAt(player.position);
  if (!cell) {
    draft.phase = 'TURN_END';
    return;
  }

  switch (cell.type) {
    case 'property':
    case 'transport':
    case 'energy': {
      const owner = ownerOf(draft, player.position);
      if (!owner) {
        draft.pendingPurchase = player.position;
        draft.phase = 'ACTION';
        push(draft, {
          type: 'purchase-offer',
          playerId: player.id,
          cellIndex: player.position,
          price: cell.price ?? 0,
        });
        return;
      }
      if (owner.id === player.id) {
        draft.phase = 'TURN_END';
        return;
      }
      const rent = calculateRent(draft, player.position, rolledSum(draft));
      if (rent > 0) {
        const paid = payMoney(draft, player, owner, rent);
        push(draft, {
          type: 'rent',
          from: player.id,
          to: owner.id,
          cellIndex: player.position,
          amount: paid,
        });
      }
      draft.phase = 'TURN_END';
      return;
    }
    case 'tax': {
      const amount = cell.taxAmount ?? 0;
      payMoney(draft, player, null, amount);
      push(draft, { type: 'tax', playerId: player.id, cellIndex: player.position, amount });
      draft.phase = 'TURN_END';
      return;
    }
    case 'chance':
    case 'community': {
      const phaseBefore = draft.phase;
      if (allowCards) drawCard(draft, player, cell.type);
      // Kart etkisi kendi fazını belirlediyse (satın alma modalı, hapis…)
      // onu ezme; yalnızca nötr kartlarda turu kapat.
      if (draft.phase === phaseBefore) draft.phase = 'TURN_END';
      return;
    }
    case 'go-to-jail': {
      sendToJail(draft, player, 'goto');
      return;
    }
    case 'free-parking': {
      if (cell.collectsPot && draft.freeParkingPot > 0) {
        const pot = draft.freeParkingPot;
        player.cash += pot;
        draft.freeParkingPot = 0;
        push(draft, { type: 'info', message: `Serbest Pazar havuzundan ${pot} ₡ alındı.` });
      }
      draft.phase = 'TURN_END';
      return;
    }
    case 'jail':
    case 'start':
    default:
      draft.phase = 'TURN_END';
  }
}

/* ------------------------------ eylem sonrası ------------------------------ */

function afterAction(draft: MonopolyState): void {
  const player = currentPlayer(draft);
  if (draft.winnerId) {
    draft.phase = 'TURN_END';
    return;
  }
  if (player.bankrupt) {
    // İflas eden oyuncunun turu biter; sıradaki oyuncuya geçilir.
    endTurnInternal(draft);
    return;
  }
  if (draft.pendingPurchase !== null) {
    draft.phase = 'ACTION';
    return;
  }
  if (draft.pendingCard) {
    draft.phase = 'TURN_END';
    return;
  }
  if (draft.bonusRoll) {
    draft.bonusRoll = false;
    draft.phase = 'ROLL';
    return;
  }
  if (draft.dice.doublesCount > 0 && !player.inJail) {
    draft.phase = 'ROLL';
    return;
  }
  draft.phase = 'TURN_END';
}

/* ---------------------------------- zarlar --------------------------------- */

export function rollWithDice(state: MonopolyState, die1: number, die2: number): MonopolyState {
  if (isGameOver(state) || state.phase !== 'ROLL') return state;
  const draft = begin(state);
  const player = currentPlayer(draft);
  if (player.inJail) {
    draft.phase = 'JAIL_DECISION';
    return state;
  }
  const a = clampDie(die1);
  const b = clampDie(die2);
  const doubles = a === b;
  draft.dice = { die1: a, die2: b, doublesCount: doubles ? draft.dice.doublesCount + 1 : draft.dice.doublesCount };
  push(draft, { type: 'dice', playerId: player.id, die1: a, die2: b, sum: a + b, doubles });

  if (doubles && draft.dice.doublesCount >= 3) {
    push(draft, { type: 'info', message: 'Üçüncü çift zar! Doğrudan Karantina.' });
    sendToJail(draft, player, 'doubles');
    return draft;
  }

  moveBySteps(draft, player, a + b);
  resolveLanding(draft, player, true);
  afterAction(draft);
  return draft;
}

export function rollDice(state: MonopolyState, rng: () => number = Math.random): MonopolyState {
  const a = clampDie(1 + Math.floor(rng() * 6));
  const b = clampDie(1 + Math.floor(rng() * 6));
  return rollWithDice(state, a, b);
}

/* ------------------------------- satın alma -------------------------------- */

export function buyProperty(state: MonopolyState): MonopolyState {
  if (isGameOver(state) || state.pendingPurchase === null || state.phase !== 'ACTION') return state;
  const index = state.pendingPurchase;
  const cell = cellAt(index);
  const draft = begin(state);
  const player = currentPlayer(draft);
  const price = cell?.price ?? 0;
  if (!cell || player.cash < price) {
    push(draft, { type: 'info', message: 'Satın almak için yeterli nakit yok.' });
    return draft;
  }
  player.cash -= price;
  player.properties[String(index)] = { mortgaged: false, houses: 0 };
  draft.pendingPurchase = null;
  push(draft, { type: 'purchase', playerId: player.id, cellIndex: index, price });
  afterAction(draft);
  return draft;
}

export function declinePurchase(state: MonopolyState): MonopolyState {
  if (isGameOver(state) || state.pendingPurchase === null || state.phase !== 'ACTION') return state;
  const index = state.pendingPurchase;
  const draft = begin(state);
  const player = currentPlayer(draft);
  draft.pendingPurchase = null;
  push(draft, { type: 'decline', playerId: player.id, cellIndex: index });
  afterAction(draft);
  return draft;
}

/** Fırsat/Topluluk kartı modalı kapatıldığında çağrılır. */
export function dismissCard(state: MonopolyState): MonopolyState {
  if (state.pendingCard === null) return state;
  const draft = begin(state);
  draft.pendingCard = null;
  if (draft.pendingPurchase !== null) {
    draft.phase = 'ACTION';
  } else if (draft.winnerId) {
    draft.phase = 'TURN_END';
  } else if (draft.bonusRoll) {
    draft.bonusRoll = false;
    draft.phase = 'ROLL';
  } else if (draft.dice.doublesCount > 0 && !draft.players[draft.currentPlayerIndex]?.inJail && (draft.players[draft.currentPlayerIndex]?.skipTurns ?? 0) === 0) {
    draft.phase = 'ROLL';
  }
  return draft;
}

/* ------------------------------- hapishane --------------------------------- */

function releaseJail(draft: MonopolyState, player: MonopolyPlayer, method: 'pay' | 'card' | 'doubles' | 'timeout'): void {
  player.inJail = false;
  player.jailTurns = 0;
  push(draft, { type: 'jail-release', playerId: player.id, method });
}

export function payJailFine(state: MonopolyState): MonopolyState {
  if (isGameOver(state) || state.phase !== 'JAIL_DECISION') return state;
  const draft = begin(state);
  const player = currentPlayer(draft);
  if (player.cash < JAIL_FINE) {
    push(draft, { type: 'info', message: 'Kefalet için yeterli nakit yok.' });
    return draft;
  }
  payMoney(draft, player, null, JAIL_FINE);
  releaseJail(draft, player, 'pay');
  draft.phase = player.bankrupt ? 'TURN_END' : 'ROLL';
  return draft;
}

export function useJailCard(state: MonopolyState): MonopolyState {
  if (isGameOver(state) || state.phase !== 'JAIL_DECISION') return state;
  const draft = begin(state);
  const player = currentPlayer(draft);
  if (player.getOutOfJailCards <= 0) {
    push(draft, { type: 'info', message: 'Çıkış kartı yok.' });
    return draft;
  }
  player.getOutOfJailCards -= 1;
  releaseJail(draft, player, 'card');
  draft.phase = 'ROLL';
  return draft;
}

export function rollForJail(state: MonopolyState, rng: () => number = Math.random): MonopolyState {
  const a = clampDie(1 + Math.floor(rng() * 6));
  const b = clampDie(1 + Math.floor(rng() * 6));
  return rollForJailWithDice(state, a, b);
}

export function rollForJailWithDice(state: MonopolyState, die1: number, die2: number): MonopolyState {
  if (isGameOver(state) || state.phase !== 'JAIL_DECISION') return state;
  const draft = begin(state);
  const player = currentPlayer(draft);
  const a = clampDie(die1);
  const b = clampDie(die2);
  const doubles = a === b;
  draft.dice = { die1: a, die2: b, doublesCount: 0 };
  push(draft, { type: 'dice', playerId: player.id, die1: a, die2: b, sum: a + b, doubles });

  if (doubles) {
    releaseJail(draft, player, 'doubles');
    moveBySteps(draft, player, a + b);
    resolveLanding(draft, player, true);
    afterAction(draft);
    return draft;
  }

  player.jailTurns += 1;
  if (player.jailTurns >= MAX_JAIL_TURNS) {
    push(draft, { type: 'info', message: 'Üç denemede çift gelmedi; 50 ₡ kefalet ödeniyor.' });
    payMoney(draft, player, null, JAIL_FINE);
    if (player.bankrupt) {
      afterAction(draft);
      return draft;
    }
    releaseJail(draft, player, 'timeout');
    moveBySteps(draft, player, a + b);
    resolveLanding(draft, player, true);
    afterAction(draft);
    return draft;
  }

  draft.phase = 'TURN_END';
  return draft;
}

/* ------------------------------- inşaat / ipotek --------------------------- */

export function buildHouse(state: MonopolyState, cellIndex: number): MonopolyState {
  if (isGameOver(state)) return state;
  const player = currentPlayer(state);
  const cell = cellAt(cellIndex);
  const holding = holdingOf(player, cellIndex);
  if (!cell || cell.type !== 'property' || !holding || holding.mortgaged) return state;
  const groupId = cell.groupId ?? '';
  if (!groupIsBuildable(state, player, groupId)) return state;
  if (holding.houses >= 5) return state;
  const members = groupMembers(groupId);
  const minHouses = Math.min(...members.map((index) => holdingOf(player, index)?.houses ?? 0));
  if (holding.houses > minHouses) return state;

  const cost = cell.houseCost ?? groupById(groupId)?.houseCost ?? 0;
  if (player.cash < cost) return state;

  const draft = begin(state);
  const draftPlayer = currentPlayer(draft);
  const draftHolding = holdingOf(draftPlayer, cellIndex);
  if (!draftHolding) return state;
  draftPlayer.cash -= cost;
  draftHolding.houses += 1;
  push(draft, {
    type: 'build',
    playerId: draftPlayer.id,
    cellIndex,
    houses: draftHolding.houses,
    cost,
  });
  return draft;
}

export function sellHouse(state: MonopolyState, cellIndex: number): MonopolyState {
  if (isGameOver(state)) return state;
  const player = currentPlayer(state);
  const holding = holdingOf(player, cellIndex);
  const cell = cellAt(cellIndex);
  if (!cell || !holding || holding.houses <= 0) return state;
  const members = groupMembers(cell.groupId ?? '');
  const maxHouses = Math.max(...members.map((index) => holdingOf(player, index)?.houses ?? 0));
  if (holding.houses < maxHouses) return state;

  const cost = cell.houseCost ?? groupById(cell.groupId)?.houseCost ?? 0;
  const refund = Math.floor(cost / 2);
  const draft = begin(state);
  const draftPlayer = currentPlayer(draft);
  const draftHolding = holdingOf(draftPlayer, cellIndex);
  if (!draftHolding) return state;
  draftHolding.houses -= 1;
  draftPlayer.cash += refund;
  push(draft, {
    type: 'sell-house',
    playerId: draftPlayer.id,
    cellIndex,
    houses: draftHolding.houses,
    refund,
  });
  return draft;
}

export function mortgageProperty(state: MonopolyState, cellIndex: number): MonopolyState {
  if (isGameOver(state)) return state;
  const player = currentPlayer(state);
  const holding = holdingOf(player, cellIndex);
  const cell = cellAt(cellIndex);
  if (!cell || !holding || holding.mortgaged || holding.houses > 0) return state;
  const amount = cell.mortgage ?? Math.floor((cell.price ?? 0) / 2);
  const draft = begin(state);
  const draftPlayer = currentPlayer(draft);
  const draftHolding = holdingOf(draftPlayer, cellIndex);
  if (!draftHolding) return state;
  draftHolding.mortgaged = true;
  draftPlayer.cash += amount;
  push(draft, { type: 'mortgage', playerId: draftPlayer.id, cellIndex, amount });
  return draft;
}

export function unmortgageProperty(state: MonopolyState, cellIndex: number): MonopolyState {
  if (isGameOver(state)) return state;
  const player = currentPlayer(state);
  const holding = holdingOf(player, cellIndex);
  const cell = cellAt(cellIndex);
  if (!cell || !holding || !holding.mortgaged) return state;
  const amount = Math.ceil((cell.mortgage ?? Math.floor((cell.price ?? 0) / 2)) * 1.1);
  if (player.cash < amount) return state;
  const draft = begin(state);
  const draftPlayer = currentPlayer(draft);
  const draftHolding = holdingOf(draftPlayer, cellIndex);
  if (!draftHolding) return state;
  draftHolding.mortgaged = false;
  draftPlayer.cash -= amount;
  push(draft, { type: 'unmortgage', playerId: draftPlayer.id, cellIndex, amount });
  return draft;
}

/* --------------------------------- tur sonu -------------------------------- */

function skipBlockedPlayers(draft: MonopolyState): void {
  const count = draft.players.length;
  let guard = 0;
  while (guard < count * 4) {
    const previous = draft.currentPlayerIndex;
    const nextIndex = (previous + 1) % count;
    if (nextIndex === 0) draft.round += 1;
    draft.currentPlayerIndex = nextIndex;
    const next = draft.players[nextIndex];
    if (!next) break;
    if (next.bankrupt) {
      guard += 1;
      continue;
    }
    if (next.skipTurns > 0) {
      next.skipTurns -= 1;
      push(draft, { type: 'skip-turn', playerId: next.id });
      guard += 1;
      continue;
    }
    break;
  }
}

function endTurnInternal(draft: MonopolyState): void {
  draft.pendingPurchase = null;
  draft.pendingCard = null;
  draft.bonusRoll = false;
  draft.dice = { die1: 0, die2: 0, doublesCount: 0 };
  if (!draft.winnerId) skipBlockedPlayers(draft);
  const next = currentPlayer(draft);
  push(draft, { type: 'turn', playerId: next.id, round: draft.round });
  draft.phase = next.inJail ? 'JAIL_DECISION' : 'ROLL';
}

export function endTurn(state: MonopolyState): MonopolyState {
  if (isGameOver(state)) return state;
  if (state.phase !== 'TURN_END') return state;
  const draft = begin(state);
  endTurnInternal(draft);
  return draft;
}

/* -------------------------------- okunabilirlik ---------------------------- */

export function summarizeEvent(state: MonopolyState, event: GameEvent): string {
  const name = (id: string): string => playerById(state, id)?.name ?? id;
  const cellNameOf = (index: number): string => cellAt(index)?.slug ?? `#${index}`;
  switch (event.type) {
    case 'dice':
      return `${name(event.playerId)} zar attı: ${event.die1} + ${event.die2} = ${event.sum}${event.doubles ? ' (çift)' : ''}`;
    case 'move':
      return `${name(event.playerId)} ${cellNameOf(event.from)} → ${cellNameOf(event.to)}`;
    case 'salary':
      return `${name(event.playerId)} başlangıçtan geçti: +${event.amount} ₡`;
    case 'purchase':
      return `${name(event.playerId)} ${cellNameOf(event.cellIndex)} aldı (${event.price} ₡)`;
    case 'decline':
      return `${name(event.playerId)} ${cellNameOf(event.cellIndex)} almadı`;
    case 'rent':
      return `${name(event.from)} → ${name(event.to)}: ${event.amount} ₡ kira`;
    case 'tax':
      return `${name(event.playerId)} ${event.amount} ₡ vergi ödedi`;
    case 'card':
      return `${name(event.playerId)} kart çekti: ${event.title}`;
    case 'jail':
      return `${name(event.playerId)} Karantina'ya gitti`;
    case 'jail-release':
      return `${name(event.playerId)} Karantina'dan çıktı`;
    case 'bankrupt':
      return `${name(event.playerId)} iflas etti`;
    case 'build':
      return `${name(event.playerId)} ${cellNameOf(event.cellIndex)} geliştirdi (${event.houses}. seviye)`;
    case 'sell-house':
      return `${name(event.playerId)} ${cellNameOf(event.cellIndex)} ev sattı`;
    case 'mortgage':
      return `${name(event.playerId)} ${cellNameOf(event.cellIndex)} ipotek etti (+${event.amount} ₡)`;
    case 'unmortgage':
      return `${name(event.playerId)} ipoteği kaldırdı (−${event.amount} ₡)`;
    case 'turn':
      return `Sıra ${name(event.playerId)}'nde · ${event.round}. tur`;
    case 'skip-turn':
      return `${name(event.playerId)} tur atlıyor`;
    case 'winner':
      return `${name(event.playerId)} oyunu kazandı!`;
    case 'info':
      return event.message;
    default:
      return '';
  }
}
