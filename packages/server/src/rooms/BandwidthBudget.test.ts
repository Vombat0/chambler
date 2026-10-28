import { describe, expect, it } from 'vitest';
import { BandwidthBudget } from './BandwidthBudget.js';

describe('BandwidthBudget', () => {
  it('divides the room budget equally between seats', () => {
    const budget = new BandwidthBudget({ roomBytesPerSecond: 64 * 1024, players: 8 });
    expect(budget.perPlayerBytesPerSecond).toBe(8 * 1024);
    budget.setPlayers(4);
    expect(budget.perPlayerBytesPerSecond).toBe(16 * 1024);
  });

  it('accepts bytes inside the per-player share', () => {
    const now = 0;
    const budget = new BandwidthBudget({ roomBytesPerSecond: 8000, players: 8, now: () => now });
    expect(budget.tryConsume('a', 500).allowed).toBe(true);
    expect(budget.tryConsume('a', 400).allowed).toBe(true);
    expect(budget.remainingFor('a')).toBe(100);
  });

  it('trims one greedy player without touching the others (fair trimming)', () => {
    const now = 0;
    const budget = new BandwidthBudget({ roomBytesPerSecond: 8000, players: 8, now: () => now });
    // each player gets 1000 B/s: two 400-byte frames fit, the third does not
    expect(budget.tryConsume('greedy', 400).allowed).toBe(true);
    expect(budget.tryConsume('greedy', 400).allowed).toBe(true);
    const greedy = budget.tryConsume('greedy', 400);
    expect(greedy.allowed).toBe(false);
    expect(greedy.reason).toBe('player');
    budget.tryConsume('greedy', 400);

    // a quiet player still has their full share
    expect(budget.tryConsume('quiet', 900).allowed).toBe(true);
    const stats = budget.stats();
    expect(stats.perPlayerDropped.greedy).toBe(2);
    expect(stats.perPlayer.quiet).toBe(900);
    expect(stats.totalDroppedFrames).toBe(2);
    expect(stats.totalBytes).toBe(800 + 900);
  });

  it('refuses a request that would overshoot the room cap', () => {
    const now = 0;
    // one seat: the per-player share equals the room cap, so only the room check bites
    const budget = new BandwidthBudget({ roomBytesPerSecond: 1000, players: 1, now: () => now });
    expect(budget.tryConsume('a', 600).allowed).toBe(true);
    const second = budget.tryConsume('b', 600);
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe('room');
    expect(second.roomRemaining).toBe(400);
    expect(budget.tryConsume('b', 400).allowed).toBe(true);
  });

  it('rolls the window and refills every share', () => {
    let now = 0;
    const budget = new BandwidthBudget({ roomBytesPerSecond: 8000, players: 8, now: () => now, windowMs: 1000 });
    expect(budget.tryConsume('a', 400).allowed).toBe(true);
    expect(budget.tryConsume('a', 400).allowed).toBe(true);
    expect(budget.tryConsume('a', 400).allowed).toBe(false);
    now = 1000;
    expect(budget.tryConsume('a', 400).allowed).toBe(true);
    expect(budget.stats().windowDroppedFrames).toBe(0);
    expect(budget.stats().totalDroppedFrames).toBe(1);
  });

  it('does not roll before the window elapses', () => {
    let now = 0;
    const budget = new BandwidthBudget({ roomBytesPerSecond: 1000, players: 1, now: () => now, windowMs: 1000 });
    expect(budget.tryConsume('a', 1000).allowed).toBe(true);
    now = 999;
    expect(budget.tryConsume('a', 1).allowed).toBe(false);
    now = 1000;
    expect(budget.tryConsume('a', 1).allowed).toBe(true);
  });

  it('reports totals that survive a window reset', () => {
    const now = 0;
    const budget = new BandwidthBudget({ roomBytesPerSecond: 2000, players: 2, now: () => now });
    budget.tryConsume('a', 900);
    budget.tryConsume('a', 900); // trimmed
    budget.reset(0);
    const stats = budget.stats();
    expect(stats.windowBytes).toBe(0);
    expect(stats.windowDroppedFrames).toBe(0);
    expect(stats.totalBytes).toBe(900);
    expect(stats.totalDroppedBytes).toBe(900);
  });

  it('never divides by zero seats', () => {
    const budget = new BandwidthBudget({ roomBytesPerSecond: 64 * 1024, players: 0 });
    expect(budget.perPlayerBytesPerSecond).toBe(64 * 1024);
  });
});
