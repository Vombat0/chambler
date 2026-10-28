/**
 * D1 — Sunucu hata kodu → insan mesajı dönüşümü.
 *
 * TableRoom'un `sendError` kodları burada eşlenir. Bilinmeyen bir kod
 * generic `err.UNKNOWN` mesajına düşer ve sunucunun özgün metni ayrı alan
 * olarak korunur (kullanıcı detayı kaybetmez).
 */

export interface ResolvedError {
  /** i18n anahtarı (`err.<CODE>`). */
  readonly key: string;
  /** Bilinmeyen bir kod mu? (ihtiyaten etiketle gösterilir) */
  readonly unknown: boolean;
  /** Sunucunun özgün mesajı; UI'da ikincil metin olabilir. */
  readonly serverMessage: string;
}

/**
 * Kodu i18n anahtarına çevirir. `err.<CODE>` sözlükte yoksa yedek dile
 * düşme zaten i18n katmanının davranışı; burada `err.UNKNOWN` yedekladi.
 */
export function resolveError(code: string, message: string): ResolvedError {
  const key = `err.${code}`;
  if (isKnownErrorCode(code)) {
    return { key, unknown: false, serverMessage: message };
  }
  return { key: 'err.UNKNOWN', unknown: true, serverMessage: message };
}

export const KNOWN_ERROR_CODES = new Set([
  'NAME_REQUIRED',
  'NAME_INVALID',
  'NAME_TOO_LONG',
  'CODE_LENGTH',
  'CODE_CHARS',
  'CHAT_EMPTY',
  'CHAT_TOO_LONG',
  'CHAT_RATE_LIMITED',
  'CHAT_INVALID',
  'SEAT_INVALID',
  'SEAT_TAKEN',
  'COLOR_INVALID',
  'COLOR_TAKEN',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'OBJECT_INVALID',
  'OBJECT_EXISTS',
  'OBJECT_META_TOO_LARGE',
  'OBJECT_NOT_FOUND',
  'OBJECT_NOT_OWNER',
  'OBJECT_CLAIMED',
  'FLIP_FORBIDDEN',
  'SHUFFLE_FORBIDDEN',
  'TRANSFORM_FORBIDDEN',
  'TRANSFORM_MALFORMED',
  'DECODE_FAILED',
]);

export function isKnownErrorCode(code: string): boolean {
  return KNOWN_ERROR_CODES.has(code);
}

/**
 * Katılmama hataları: sunucu `ServerError` olarak fırlatıyor; mesaj ya da
 * Colyseus hata türünde kod aranır.
 */
export function joinFailureCode(err: unknown): string {
  const text = typeof err === 'string' ? err : err instanceof Error ? `${err.message} ${err.name}` : '';
  if (text.includes('ROOM_FULL')) return 'ROOM_FULL';
  if (text.includes('ROOM_NOT_FOUND') || text.includes('no matching room') || text.includes('not found')) {
    return 'ROOM_NOT_FOUND';
  }
  if (text.includes('NAME_')) {
    const found = ['NAME_REQUIRED', 'NAME_INVALID', 'NAME_TOO_LONG'].find((code) => text.includes(code));
    if (found) return found;
  }
  return 'JOIN_FAILED';
}
