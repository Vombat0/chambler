/**
 * R2 — Başsız (headless) tam oyun simülasyonu: yapay zekâlar motorla kapışır.
 * Amaç: kilitlenme / sonsuz döngü / istisna olmadığını ve oyunun gerçekten
 * ilerlediğini kanıtlamak (entegrasyon duman testi).
 */

import { describe, expect, it } from 'vitest';
import { aiStep } from './ai';
import { mulberry32 } from './boardData';
import { type RiskState, createInitialState, endTurn } from './riskEngine';

/** Bir adım ilerlet: aiStep sıkışırsa endTurn dener; ikisi de yerinde sayarsa null. */
function step(state: RiskState, rng: () => number): RiskState | null {
  const next = aiStep(state, rng);
  if (next !== state) return next;
  const forced = endTurn(state);
  return forced === state ? null : forced;
}

function runMatch(
  seed: number,
  players: { name: string; color: string }[],
  maxSteps: number,
): { state: RiskState; steps: number; stalled: boolean } {
  const rng = mulberry32(seed);
  let state = createInitialState({
    players: players.map((p) => ({ ...p, ai: true })),
    seed,
  });
  let steps = 0;
  let stalled = false;
  while (state.phase !== 'VICTORY' && steps < maxSteps) {
    const next = step(state, rng);
    if (!next) {
      stalled = true;
      break;
    }
    state = next;
    steps += 1;
  }
  return { state, steps, stalled };
}

describe('AI vs AI — başsız simülasyon', () => {
  it('tohum 1 (1v1): kilitlenme yok; oyun biterse kazanan tek başına hayatta', () => {
    const { state, steps, stalled } = runMatch(1, [{ name: 'Algo', color: '#f00' }, { name: 'Brute', color: '#00f' }], 30000);
    expect(stalled).toBe(false);
    expect(steps).toBeGreaterThan(20);
    if (state.phase === 'VICTORY') {
      expect(state.winnerId).toBeTruthy();
      expect(state.players.filter((p) => !p.eliminated)).toHaveLength(1);
    } else {
      expect(state.turn).toBeGreaterThan(25); // bitmediyse de kararlı biçimde ilerliyor
    }
  });

  it('tohum 42 (3 oyuncu): 3000 adım boyunca sıra ilerlemeye devam eder', () => {
    const { state, steps } = runMatch(
      42,
      [
        { name: 'A', color: '#f00' },
        { name: 'B', color: '#00f' },
        { name: 'C', color: '#0f0' },
      ],
      3000,
    );
    expect(steps).toBeGreaterThan(0);
    expect(state.turn).toBeGreaterThan(1);
  });

  it('simülasyon sonunda hayatta kalan her ordunun en az 1 bölgesi ve 1 askeri var', () => {
    const { state } = runMatch(7, [{ name: 'A', color: '#f00' }, { name: 'B', color: '#00f' }], 4000);
    for (const p of state.players) {
      if (p.eliminated) continue;
      const owned = Object.values(state.territories).filter((t) => t.ownerId === p.id);
      expect(owned.length).toBeGreaterThan(0);
      expect(owned.every((t) => t.armies >= 1)).toBe(true);
    }
  });

  it('asker envanteri korunur: toplam ordu yalnızca savaş/aktarım/takasla değişir', () => {
    const rng = mulberry32(99);
    let state = createInitialState({
      players: [
        { name: 'A', color: '#f00', ai: true },
        { name: 'B', color: '#00f', ai: true },
      ],
      seed: 99,
    });
    const total = (s: RiskState) =>
      Object.values(s.territories).reduce((n, t) => n + t.armies, 0) + s.deployPool;
    let prev = total(state);
    for (let i = 0; i < 1500 && state.phase !== 'VICTORY'; i++) {
      const next = step(state, rng);
      if (!next) break;
      const now = total(next);
      // Savaş/kaydırma adımları toplam orduyu asla artıramaz (takviye yalnızca DEPLOY'da).
      // Aynı adımda tur devri olursa yeni takviye havuzu gelir; o yüzden tolerans
      // yalnızca tur içinde uygulanır.
      if (next.turn === state.turn && (next.phase === 'ATTACK' || next.phase === 'FORTIFY')) {
        expect(now).toBeLessThanOrEqual(prev);
      }
      state = next;
      prev = now;
    }
    expect(state.turn).toBeGreaterThan(1);
  });
});
