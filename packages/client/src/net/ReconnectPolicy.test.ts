import { describe, expect, it } from 'vitest';
import { ReconnectPolicy } from './ReconnectPolicy.js';

describe('ReconnectPolicy', () => {
  it('allows up to max attempts', () => {
    const p = new ReconnectPolicy({ maxAttempts: 3 });
    expect(p.canRetry()).toBe(true);
    p.nextDelayMs();
    p.nextDelayMs();
    p.nextDelayMs();
    expect(p.canRetry()).toBe(false);
  });
  it('exponential backoff', () => {
    const p = new ReconnectPolicy({ baseDelayMs: 100, maxAttempts: 5 });
    expect(p.nextDelayMs()).toBe(100);
    expect(p.nextDelayMs()).toBe(200);
    expect(p.nextDelayMs()).toBe(400);
  });
  it('caps delay', () => {
    const p = new ReconnectPolicy({ baseDelayMs: 1000, maxDelayMs: 1500, maxAttempts: 10 });
    expect(p.nextDelayMs()).toBe(1000);
    expect(p.nextDelayMs()).toBe(1500);
    expect(p.nextDelayMs()).toBe(1500);
  });
  it('reset restores', () => {
    const p = new ReconnectPolicy({ maxAttempts: 2 });
    p.nextDelayMs();
    p.nextDelayMs();
    expect(p.canRetry()).toBe(false);
    p.reset();
    expect(p.canRetry()).toBe(true);
    expect(p.attempts).toBe(0);
  });
  it('default max 5', () => {
    const p = new ReconnectPolicy();
    let n = 0;
    while (p.canRetry()) { p.nextDelayMs(); n++; }
    expect(n).toBe(5);
  });
});
