/**
 * Conflict-rule tests. rules/rules.json carries the combat data; these tests
 * check the declared constants AND exercise a reference pairing built strictly
 * from those constants (descending pairing, ties to the defender).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

const rules = read<{
  setup: { startArmies: Record<string, number> };
  reinforce: { regionsDivisor: number; minimum: number; roundDown: boolean; capitalBonus: number };
  conflict: {
    diceSides: number;
    attacker: { minArmies: number; maxDice: number };
    defender: { minArmies: number; maxDice: number };
    pairing: string;
    tieWins: string;
    lossesPerPair: { attacker: number; defender: number };
    fortressRegions: string[];
    fortressDefenseBonus: number;
    fortressBonusCap: number;
  };
  cards: { tradeTrigger: number; tradeTiers: { cards: number; armies: number }[] };
  conquest: { required: boolean; minMoved: string };
  elimination: { trigger: string };
  end: { condition: string };
}>('rules/rules.json');

interface Outcome {
  attackerLosses: number;
  defenderLosses: number;
}

/** Reference combat resolution driven by the rule data, not hardcoded numbers. */
function resolveCombat(attackerRoll: number[], defenderRoll: number[]): Outcome {
  expect(rules.conflict.pairing).toBe('descending');
  const a = [...attackerRoll].sort((x, y) => y - x);
  const d = [...defenderRoll].sort((x, y) => y - x);
  const outcome: Outcome = { attackerLosses: 0, defenderLosses: 0 };
  const pairs = Math.min(a.length, d.length);
  for (let i = 0; i < pairs; i++) {
    const attackerWins = a[i]! > d[i]!; // a tie goes to defender (tieWins === 'defender')
    if (attackerWins) outcome.defenderLosses += rules.conflict.lossesPerPair.defender;
    else outcome.attackerLosses += rules.conflict.lossesPerPair.attacker;
  }
  return outcome;
}

describe('combat constants', () => {
  test('attacker rolls at most 3 dice, defender at most 2, from d6', () => {
    expect(rules.conflict.attacker.maxDice).toBe(3);
    expect(rules.conflict.defender.maxDice).toBe(2);
    expect(rules.conflict.attacker.minArmies).toBe(2);
    expect(rules.conflict.defender.minArmies).toBe(1);
    expect(rules.conflict.diceSides).toBe(6);
    expect(rules.conflict.tieWins).toBe('defender');
  });

  test('reinforcement is floor(regions/3) with a minimum of 3', () => {
    expect(rules.reinforce.regionsDivisor).toBe(3);
    expect(rules.reinforce.minimum).toBe(3);
    expect(rules.reinforce.roundDown).toBe(true);
    const forRegions = (n: number) => Math.max(rules.reinforce.minimum, Math.floor(n / 3));
    expect(forRegions(4)).toBe(3);
    expect(forRegions(9)).toBe(3);
    expect(forRegions(10)).toBe(3); // floor(10/3)=3, min applies
    expect(forRegions(12)).toBe(4);
    expect(forRegions(28)).toBe(9);
  });

  test('start armies cover 2-6 players and shrink as players grow', () => {
    const table = Object.entries(rules.setup.startArmies);
    expect(table.map(([k]) => k)).toEqual(['2', '3', '4', '5', '6']);
    const values = table.map(([, v]) => v);
    for (const v of values) expect(v).toBeGreaterThan(0);
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeLessThan(values[i - 1]!);
  });

  test('card trades trigger at 3 and pay strictly more per bigger set', () => {
    expect(rules.cards.tradeTrigger).toBe(3);
    expect(rules.cards.tradeTiers.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < rules.cards.tradeTiers.length; i++) {
      expect(rules.cards.tradeTiers[i]!.armies).toBeGreaterThan(rules.cards.tradeTiers[i - 1]!.armies);
      expect(rules.cards.tradeTiers[i]!.cards).toBeGreaterThan(rules.cards.tradeTiers[i - 1]!.cards);
    }
  });

  test('fortress regions in rules.json match the fortress flags on the board', () => {
    const board = read<{ regions: { id: string; fortress?: boolean }[] }>('board/board.json');
    const flagged = board.regions.filter((r) => r.fortress === true).map((r) => r.id).sort();
    expect([...rules.conflict.fortressRegions].sort()).toEqual(flagged);
    expect(rules.conflict.fortressDefenseBonus).toBeGreaterThan(0);
    expect(rules.conflict.fortressBonusCap).toBeLessThanOrEqual(rules.conflict.diceSides);
  });

  test('conquest is mandatory and elimination ends with a last-standing winner', () => {
    expect(rules.conquest.required).toBe(true);
    expect(rules.conquest.minMoved).toBe('attackers-committed-dice');
    expect(rules.elimination.trigger).toBe('lost-last-region');
    expect(rules.end.condition).toBe('last-standing');
  });
});

describe('dice pairing (10 cases)', () => {
  test('case 1: three sixes crush two fives — defender loses 2', () => {
    expect(resolveCombat([6, 6, 6], [5, 5])).toEqual({ attackerLosses: 0, defenderLosses: 2 });
  });

  test('case 2: three threes break on two sixes — attacker loses 2', () => {
    expect(resolveCombat([3, 3, 3], [6, 6])).toEqual({ attackerLosses: 2, defenderLosses: 0 });
  });

  test('case 3: every tie goes to the defender — attacker loses 2', () => {
    expect(resolveCombat([6, 5, 4], [6, 5])).toEqual({ attackerLosses: 2, defenderLosses: 0 });
  });

  test('case 4: rolls are paired after sorting, input order is irrelevant', () => {
    expect(resolveCombat([4, 5, 6], [5, 6])).toEqual({ attackerLosses: 2, defenderLosses: 0 });
  });

  test('case 5: superior pairings win — defender loses 2', () => {
    expect(resolveCombat([2, 2, 2], [1, 1])).toEqual({ attackerLosses: 0, defenderLosses: 2 });
  });

  test('case 6: a lone six plus a tie — attacker loses 2', () => {
    expect(resolveCombat([1, 1, 1], [6, 1])).toEqual({ attackerLosses: 2, defenderLosses: 0 });
  });

  test('case 7: mirror dice, defender wins both ties', () => {
    expect(resolveCombat([6, 6], [6, 6])).toEqual({ attackerLosses: 2, defenderLosses: 0 });
  });

  test('case 8: weakest dice meet the strongest — attacker loses 2', () => {
    expect(resolveCombat([6, 1, 1], [6, 6])).toEqual({ attackerLosses: 2, defenderLosses: 0 });
  });

  test('case 9: split round — one army lost on each side', () => {
    expect(resolveCombat([6, 6, 6], [6, 1])).toEqual({ attackerLosses: 1, defenderLosses: 1 });
  });

  test('case 10: pairs are limited by the smaller dice pool — one pair only', () => {
    expect(resolveCombat([4, 3, 2], [6])).toEqual({ attackerLosses: 1, defenderLosses: 0 });
  });
});
