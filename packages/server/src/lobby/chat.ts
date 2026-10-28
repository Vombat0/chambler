/**
 * Chat validation + rate limiting. Chat is a reliable state-channel message
 * (`{ type: 'chat', playerId, text, sentAt }` in @chambler/shared).
 */

export const CHAT_MAX_LENGTH = 300;
export const CHAT_RATE_LIMIT = 3;
export const CHAT_RATE_WINDOW_MS = 1000;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const WHITESPACE_RUN = /\s+/g;

export type ChatErrorCode = 'CHAT_INVALID' | 'CHAT_EMPTY' | 'CHAT_TOO_LONG';

export type ChatValidation =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: ChatErrorCode; readonly message: string };

/**
 * Sanitises a raw chat payload: control characters become spaces, whitespace
 * runs collapse, the result is trimmed and must be 1..maxLength characters.
 */
export function validateChatText(raw: unknown, maxLength: number = CHAT_MAX_LENGTH): ChatValidation {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'CHAT_INVALID', message: 'Chat text must be a string.' };
  }
  const text = raw.replace(CONTROL_CHARACTERS, ' ').replace(WHITESPACE_RUN, ' ').trim();
  if (text.length === 0) {
    return { ok: false, code: 'CHAT_EMPTY', message: 'Chat text must not be empty.' };
  }
  if (text.length > maxLength) {
    return {
      ok: false,
      code: 'CHAT_TOO_LONG',
      message: `Chat text may be at most ${maxLength} characters.`,
    };
  }
  return { ok: true, text };
}

/**
 * Sliding-window rate limiter, one bucket per player session.
 * Not shared between processes; a single server process owns a room's state.
 */
export class ChatRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number = CHAT_RATE_LIMIT,
    private readonly windowMs: number = CHAT_RATE_WINDOW_MS,
  ) {}

  /** Records a message for `key`; returns false when the limit is exceeded. */
  allow(key: string, now: number = Date.now()): boolean {
    const windowStart = now - this.windowMs;
    const previous = this.hits.get(key) ?? [];
    const recent = previous.filter((timestamp) => timestamp > windowStart);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  clear(): void {
    this.hits.clear();
  }
}
