import { describe, expect, it } from 'vitest';
import { DiceModel, parseDieResult, rollDie, rollPair, splitSum } from './diceModel.js';

describe('diceModel — zar atma durumu', () => {
  it('idle durumunda atış başlatır ve rolling olur', () => {
    const dice = new DiceModel({ rng: () => 0.5, durationMs: 100 });
    expect(dice.state.phase).toBe('idle');
    expect(dice.roll(0, 'p1')).toBe(true);
    expect(dice.rolling).toBe(true);
    expect(dice.state.lastPlayerId).toBe('p1');
  });

  it('dönüş sırasında ikinci atış reddedilir', () => {
    const dice = new DiceModel({ rng: () => 0.5, durationMs: 100 });
    dice.roll(0);
    expect(dice.roll(50)).toBe(false);
  });

  it('süre dolunca settled olur ve tick yalnızca geçiş anında true döner', () => {
    const dice = new DiceModel({ rng: () => 0.0, durationMs: 100 });
    dice.roll(0);
    expect(dice.tick(99)).toBe(false);
    expect(dice.tick(100)).toBe(true);
    expect(dice.state.phase).toBe('settled');
    expect(dice.tick(150)).toBe(false);
    expect(dice.state.lastSum).toBe(2); // rng 0 → her iki zar 1
  });

  it('rollPair 2..12 toplam üretir (kenar değerler dahil)', () => {
    expect(rollPair(() => 0)).toEqual({ a: 1, b: 1 });
    expect(rollPair(() => 0.999999)).toEqual({ a: 6, b: 6 });
    for (const r of [0, 0.1, 0.35, 0.5, 0.9, 0.99999]) {
      const pair = rollPair(() => r);
      expect(pair.a + pair.b).toBeGreaterThanOrEqual(2);
      expect(pair.a + pair.b).toBeLessThanOrEqual(12);
    }
  });

  it('rollDie her zaman 1..6 tam sayı verir', () => {
    for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.999999]) {
      const v = rollDie(() => r);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('splitSum geçerli toplamı iki d6 yüzüne ayırır, geçersizde null', () => {
    expect(splitSum(2)).toEqual({ a: 1, b: 1 });
    expect(splitSum(12)).toEqual({ a: 6, b: 6 });
    const mid = splitSum(9);
    expect(mid).not.toBeNull();
    expect(mid!.a + mid!.b).toBe(9);
    expect(splitSum(13)).toBeNull();
    expect(splitSum(1)).toBeNull();
    expect(splitSum(7.5)).toBeNull();
  });

  it('rollFixed uzak sonucu animasyonla gösterir ama değeri değiştirmez', () => {
    const dice = new DiceModel({ rng: () => 0.999999, durationMs: 50 });
    expect(dice.rollFixed(0, 9, 'p2')).toBe(true);
    dice.tick(60);
    expect(dice.state.lastSum).toBe(9);
    expect(dice.state.lastPlayerId).toBe('p2');
  });

  it('facesAt dönme sırasında yüzleri çevirir, durunca gerçek yüzleri verir', () => {
    const dice = new DiceModel({ rng: () => 0.5, durationMs: 100, tickMs: 90 });
    dice.roll(0);
    const early = dice.facesAt(0);
    const later = dice.facesAt(95);
    expect(early.a).not.toBe(later.a); // adım ilerledikçe yüz değişir
    dice.tick(100);
    const final = dice.facesAt(120);
    const state = dice.state;
    expect(final).toEqual({ a: state.a, b: state.b });
  });

  it('parseDieResult geçerli {objectId, value, faces} mesajını doğrular', () => {
    expect(parseDieResult({ objectId: 'b2d-die-p1', value: 8, faces: 12 })).toEqual({
      objectId: 'b2d-die-p1',
      value: 8,
      faces: 12,
    });
    expect(parseDieResult({ id: 'd', value: 6 })?.value).toBe(6); // faces varsayılır
    expect(parseDieResult({ objectId: 'd', value: 1.5 })).toBeNull();
    expect(parseDieResult({ objectId: 'd', value: 0 })).toBeNull();
    expect(parseDieResult({ objectId: 'd', value: 7 })).toBeNull(); // faces=6 varsayımı
    expect(parseDieResult(null)).toBeNull();
    expect(parseDieResult({ value: 3 })).toBeNull();
  });
});
