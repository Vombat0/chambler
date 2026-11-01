/**
 * R2 — Territory Wars: açgözlü (greedy) yerel yapay zekâ.
 * Motoru çağırır; her `aiStep` tek bir anlamlı eylem üretir. UI bunu
 * zamanlayıcıyla adım adım uygulayarak "düşünen rakip" hissi verir.
 */

import { NEIGHBORS } from './boardData';
import {
  type RiskState,
  type Rng,
  areConnected,
  attack,
  canAttack,
  confirmCapture,
  currentPlayer,
  deploy,
  endTurn,
  findTradeSet,
  fortify,
  goToAttack,
  goToFortify,
  ownedTerritories,
  trade,
} from './riskEngine';

function threatScore(state: RiskState, myId: string, regionId: string): number {
  const enemies = (NEIGHBORS[regionId] ?? [])
    .map((n) => state.territories[n]!)
    .filter((t) => t.ownerId !== myId);
  return enemies.reduce((s, t) => s + t.armies, 0);
}

/** Tek bir AI eylemi uygular; state değişmezse sıra UI'da endTurn'e kalır. */
export function aiStep(state: RiskState, rng: Rng): RiskState {
  if (state.phase === 'VICTORY') return state;
  if (state.pendingCapture) return confirmCapture(state, state.pendingCapture.max);
  const me = currentPlayer(state);

  if (state.phase === 'DEPLOY') {
    if (state.deployPool <= 0) return goToAttack(state);
    // Kart takası fırsatsa kaçırma.
    if (me.cards.length >= 3) {
      const set = findTradeSet(me.cards);
      if (set) return trade(state, set);
    }
    // Sınırdaki en riskli bölgemize yığ (komşu düşman gücü en yüksek).
    const mine = ownedTerritories(state, me.id);
    const border = mine.filter((id) =>
      (NEIGHBORS[id] ?? []).some((n) => state.territories[n]!.ownerId !== me.id),
    );
    const pool = border.length > 0 ? border : mine;
    let best = pool[0]!;
    let bestScore = -1;
    for (const id of pool) {
      const s = threatScore(state, me.id, id) + state.territories[id]!.armies * 0.01;
      if (s > bestScore) {
        bestScore = s;
        best = id;
      }
    }
    const chunk = Math.min(state.deployPool, 2 + Math.floor(rng() * 3));
    return deploy(state, best, chunk);
  }

  if (state.phase === 'ATTACK') {
    const mine = ownedTerritories(state, me.id);
    let bestFrom = '';
    let bestTo = '';
    let bestEdge = 0;
    for (const from of mine) {
      const a = state.territories[from]!;
      if (a.armies < 3) continue;
      for (const to of NEIGHBORS[from] ?? []) {
        const d = state.territories[to]!;
        if (d.ownerId === me.id) continue;
        const edge = a.armies - d.armies;
        if (edge >= 2 && edge > bestEdge && canAttack(state, from, to) === null) {
          bestEdge = edge;
          bestFrom = from;
          bestTo = to;
        }
      }
    }
    if (bestFrom && bestTo) return attack(state, bestFrom, bestTo, rng).state;
    return goToFortify(state);
  }

  if (state.phase === 'FORTIFY') {
    if (!state.fortifyUsed) {
      const mine = ownedTerritories(state, me.id);
      // İç bölgeden (düşman komşusu az) sınır bölgesine aktar.
      const source = [...mine]
        .filter((id) => state.territories[id]!.armies > 1)
        .sort(
          (x, y) =>
            (NEIGHBORS[x] ?? []).filter((n) => state.territories[n]!.ownerId !== me.id).length -
              (NEIGHBORS[y] ?? []).filter((n) => state.territories[n]!.ownerId !== me.id).length ||
            state.territories[y]!.armies - state.territories[x]!.armies,
        )[0];
      if (source) {
        const targets = mine
          .filter((id) => id !== source && areConnected(state, me.id, source, id))
          .sort((x, y) => {
            const tx = threatScore(state, me.id, x);
            const ty = threatScore(state, me.id, y);
            const bx = (NEIGHBORS[x] ?? []).some((n) => state.territories[n]!.ownerId !== me.id);
            const by = (NEIGHBORS[y] ?? []).some((n) => state.territories[n]!.ownerId !== me.id);
            return Number(by) - Number(bx) || ty - tx;
          })[0];
        if (targets) {
          const moved = state.territories[source]!.armies - 1;
          if (moved >= 1) return fortify(state, source, targets, moved);
        }
      }
    }
    return endTurn(state);
  }

  return state;
}
