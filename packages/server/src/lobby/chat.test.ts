import { describe, expect, it } from 'vitest';
import { ChatRateLimiter, validateChatText } from './chat.js';

describe('chat', () => {
  it('sanitises control characters and whitespace', () => {
    expect(validateChatText('  hello \n  world  ')).toEqual({ ok: true, text: 'hello world' });
    expect(validateChatText('a\u0000b')).toEqual({ ok: true, text: 'a b' });
  });

  it('rejects empty, non-string and over-long messages', () => {
    expect(validateChatText('   ')).toMatchObject({ ok: false, code: 'CHAT_EMPTY' });
    expect(validateChatText('\u0000')).toMatchObject({ ok: false, code: 'CHAT_EMPTY' });
    expect(validateChatText(42)).toMatchObject({ ok: false, code: 'CHAT_INVALID' });
    expect(validateChatText('a'.repeat(301))).toMatchObject({ ok: false, code: 'CHAT_TOO_LONG' });
    expect(validateChatText('a'.repeat(300))).toMatchObject({ ok: true });
  });

  it('allows 3 messages per second, then blocks', () => {
    const limiter = new ChatRateLimiter(3, 1000);
    const start = 1_000_000;
    expect(limiter.allow('p1', start)).toBe(true);
    expect(limiter.allow('p1', start + 100)).toBe(true);
    expect(limiter.allow('p1', start + 200)).toBe(true);
    expect(limiter.allow('p1', start + 300)).toBe(false);
    // Other players have their own bucket.
    expect(limiter.allow('p2', start + 300)).toBe(true);
    // The window slides.
    expect(limiter.allow('p1', start + 1001)).toBe(true);
  });

  it('resets a player bucket on leave', () => {
    const limiter = new ChatRateLimiter(1, 1000);
    expect(limiter.allow('p1', 0)).toBe(true);
    expect(limiter.allow('p1', 1)).toBe(false);
    limiter.reset('p1');
    expect(limiter.allow('p1', 2)).toBe(true);
  });
});
