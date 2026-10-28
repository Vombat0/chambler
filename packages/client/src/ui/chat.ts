/**
 * D1 — İstemci sohbet yardımcıları.
 *
 * Sohbet limitleri sunucu (`lobby/chat.ts`) ile aynıdır: 300 karakter,
 * saniyede 3 mesaj (sliding window). İstemci, göndermeden önce kendi
 * göstergesini bilir ve sunucu reddi (CHAT_RATE_LIMITED) ile birleşik
 * geri bildirim verir.
 */

export const CHAT_MAX_LENGTH = 300;
export const CHAT_RATE_LIMIT = 3;
export const CHAT_RATE_WINDOW_MS = 1000;

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const WHITESPACE_RUN = /\s+/g;

/** Sunucuyla aynı normalizasyon: kontrol boşluk, whitespace tek boşluk, trim. */
export function sanitizeChatText(raw: string, max: number = CHAT_MAX_LENGTH): string | null {
  const text = raw.replace(CONTROL_CHARACTERS, ' ').replace(WHITESPACE_RUN, ' ').trim();
  if (text.length === 0) return null;
  return text.slice(0, max);
}

export type ChatSendResult =
  | { readonly allowed: true; readonly text: string }
  | { readonly allowed: false; readonly reason: 'empty' | 'too_long' | 'rate_limited' };

/**
 * Kayan pencere hız sınırlayıcısı (istemci tarafı um): limit aşırsa
 * `rate_limited` döner, UI uyarı gösterir. Sunucunun nihai kararı hâlâ
 * CHAT_RATE_LIMITED hata koduyla gelir; bu katman yalnızca erken uyarıdır.
 */
export class ClientChatGate {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number = CHAT_RATE_LIMIT,
    private readonly windowMs: number = CHAT_RATE_WINDOW_MS,
  ) {}

  submit(key: string, raw: string, now: number = Date.now()): ChatSendResult {
    const text = sanitizeChatText(raw);
    if (!text) {
      return { allowed: false, reason: raw.trim().length > CHAT_MAX_LENGTH ? 'too_long' : 'empty' };
    }
    if (Array.from(raw.trim()).length > CHAT_MAX_LENGTH) {
      return { allowed: false, reason: 'too_long' };
    }
    const windowStart = now - this.windowMs;
    const previous = this.hits.get(key) ?? [];
    const recent = previous.filter((timestamp) => timestamp > windowStart);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, reason: 'rate_limited' };
    }
    this.hits.set(key, [...recent, now]);
    return { allowed: true, text };
  }
}
