/**
 * D1 — İstemci tarafı giriş doğrulama.
 *
 * Ad kuralları `packages/server/src/lobby/names.ts` ile uyumludur
 * (whitespace birleştirme + kontrol/zero-width/bidi reddi); istemci daha
 * katıdır: 2–20 karakter. Oda kodu kuralları `roomCode.ts` ile aynıdır:
 * 5 karakter, `01OIL` hariç alfabe.
 *
 * İstemci kuralları sunucudan asla daha gevşek olmamalıdır: buradan geçen
 * her ad/kod sunucu doğrulamasından da geçer.
 */

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 20;

/** Kontrol karakterleri, zero-width, bidi yönlendirme ve ayraçlar. */
const CONTROL_CHARACTERS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\uFEFF]/;

const WHITESPACE_RUN = /\s+/g;

export type NameErrorCode = 'NAME_REQUIRED' | 'NAME_INVALID' | 'NAME_TOO_LONG';

export type InputValidation =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly code: NameErrorCode; readonly i18nKey: string };

/** Whitespace dizerlerini tek boşluğa indirir; uçları kırpar. */
export function cleanName(raw: string): string {
  return raw.replace(WHITESPACE_RUN, ' ').trim();
}

/**
 * Takma ad doğrulama: 2–20 karakter, kontrol/zero-width/bidi karakter reddi.
 * Sunucudaki doğrulama kurallarıyla uyumlu (sunucunun `names.ts` kural grubu).
 */
export function validateName(
  raw: string,
  max: number = NAME_MAX_LENGTH,
  min: number = NAME_MIN_LENGTH,
): InputValidation {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'NAME_REQUIRED', i18nKey: 'err.NAME_REQUIRED' };
  }
  if (CONTROL_CHARACTERS.test(raw)) {
    return { ok: false, code: 'NAME_INVALID', i18nKey: 'err.NAME_INVALID' };
  }
  const name = cleanName(raw);
  const charCount = Array.from(name).length;
  if (charCount < min) {
    return { ok: false, code: 'NAME_REQUIRED', i18nKey: 'err.NAME_REQUIRED' };
  }
  if (charCount > max) {
    return { ok: false, code: 'NAME_TOO_LONG', i18nKey: 'err.NAME_TOO_LONG' };
  }
  return { ok: true, value: name };
}

export const ROOM_CODE_LENGTH = 5;
/** `0/O` ve `1/I/L` gürültü sebebiyle kodlarda kullanılmaz (server ile aynı). */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
/** Kodlara girmemesi gereken karakterler (hata mesajı için listelenir). */
export const AMBIGUOUS_CHARACTERS = '01OIL';

export type RoomCodeValidation =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly code: 'CODE_LENGTH' | 'CODE_CHARS'; readonly i18nKey: string };

/**
 * Oda kodu normalleştirme: trim + büyük harfe çevirme, 5 karakter ve alfabe
 * kontrolü. Kullanıcının küçük harf girmesi sorunsuz normalleştirilir.
 */
export function normalizeRoomCode(input: string): RoomCodeValidation {
  if (typeof input !== 'string') {
    return { ok: false, code: 'CODE_LENGTH', i18nKey: 'err.CODE_LENGTH' };
  }
  const code = input.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) {
    return { ok: false, code: 'CODE_LENGTH', i18nKey: 'err.CODE_LENGTH' };
  }
  for (const character of code) {
    if (!ROOM_CODE_ALPHABET.includes(character)) {
      return { ok: false, code: 'CODE_CHARS', i18nKey: 'err.CODE_CHARS' };
    }
  }
  return { ok: true, value: code };
}

/** Sohbet göstergesi: `n/300` biçiminde sıfıra karşı sayma. */
export function chatCounter(text: string, max: number = 300): string {
  const used = Array.from(text).length;
  return `${used}/${max}`;
}
