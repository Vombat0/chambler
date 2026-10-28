import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS_CHARACTERS,
  NAME_MAX_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  chatCounter,
  cleanName,
  normalizeRoomCode,
  validateName,
} from './validation.js';

describe('name validation (D1)', () => {
  it(' boşluklar tek boşlukla birleşir, uçlar kırpar', () => {
    expect(cleanName('  Ay\u00A0\t  \n  Sevgi ')).toBe('Ay Sevgi');
  });

  it(' temiz ad geçer', () => {
    const validation = validateName('  Ali  ');
    expect(validation).toMatchObject({ ok: true, value: 'Ali' });
  });

  it(' en az 2 karakter (min)', () => {
    expect(validateName('a')).toMatchObject({ ok: false, code: 'NAME_REQUIRED', i18nKey: 'err.NAME_REQUIRED' });
    expect(validateName('ay')).toMatchObject({ ok: true, value: 'ay' });
    expect(validateName('')).toMatchObject({ ok: false, code: 'NAME_REQUIRED' });
    expect(validateName('   ')).toMatchObject({ ok: false, code: 'NAME_REQUIRED' });
  });

  it(' en fazla 20 karakter (max) + uzunluk sınırı düzgün', () => {
    const nineteen = 'a'.repeat(NAME_MAX_LENGTH - 1);
    const twenty = 'a'.repeat(NAME_MAX_LENGTH);
    const twentyOne = 'a'.repeat(NAME_MAX_LENGTH + 1);
    expect(validateName(nineteen).ok).toBe(true);
    expect(validateName(twenty).ok).toBe(true);
    expect(validateName(twentyOne)).toMatchObject({ ok: false, code: 'NAME_TOO_LONG', i18nKey: 'err.NAME_TOO_LONG' });
  });

  it(' zero-width ve no-break boşluk içeriklerini reddeder (sunucuyla uyumlu)', () => {
    expect(validateName('Ali\u200BBeker')).toMatchObject({ ok: false, code: 'NAME_INVALID', i18nKey: 'err.NAME_INVALID' });
    expect(validateName('Ay\uFEFFbe')).toMatchObject({ ok: false, code: 'NAME_INVALID' });
    expect(validateName('Ay\u2060be')).toMatchObject({ ok: false, code: 'NAME_INVALID' });
  });

  it(' bidi kontrol karakterleri reddedilir', () => {
    const bidiName = 'Ay\u202Abe';
    const bidiName2 = 'Ay\u202Ebe';
    expect(validateName(bidiName).ok).toBe(false);
    expect(validateName(bidiName2).ok).toBe(false);
  });

  it(' kontrol karakterleri reddedilir (C0/C1)', () => {
    expect(validateName('Ay\u0001be')).toMatchObject({ ok: false, code: 'NAME_INVALID' });
    expect(validateName('Ay\u009Fbe')).toMatchObject({ ok: false, code: 'NAME_INVALID' });
  });

  it(' satır ayracı reddedilir', () => {
    expect(validateName('Ay\u2028be')).toMatchObject({ ok: false, code: 'NAME_INVALID' });
    expect(validateName('Ay\nbe')).toMatchObject({ ok: false, code: 'NAME_INVALID' });
  });
});

describe('room code validation (D1)', () => {
  const ALPHABET = ROOM_CODE_ALPHABET;

  it(' sabitler sunucuyla uyumlu', () => {
    expect(ROOM_CODE_LENGTH).toBe(5);
    expect(AMBIGUOUS_CHARACTERS).toBe('01OIL');
    expect(ALPHABET).not.toMatch(/[01OIL0OIL]/);
  });

  it(' küçük harf girilir, büyük harfe normalleştirilir', () => {
    expect(normalizeRoomCode('ab2cd')).toMatchObject({ ok: true, value: 'AB2CD' });
    expect(normalizeRoomCode('  ab2cd ')).toMatchObject({ ok: true, value: 'AB2CD' });
  });

  it(' 5 karakter kuralına uymayan kodlar reddedilir', () => {
    expect(normalizeRoomCode('AB2C')).toMatchObject({ ok: false, code: 'CODE_LENGTH', i18nKey: 'err.CODE_LENGTH' });
    expect(normalizeRoomCode('AB2CDEFG')).toMatchObject({ ok: false, code: 'CODE_LENGTH' });
    expect(normalizeRoomCode('')).toMatchObject({ ok: false, code: 'CODE_LENGTH' });
  });

  it(' belirsiz karakterler reddedilir (0/O ve 1/I/L)', () => {
    expect(normalizeRoomCode('A0BCD')).toMatchObject({ ok: false, code: 'CODE_CHARS', i18nKey: 'err.CODE_CHARS' });
    expect(normalizeRoomCode('AOBCD')).toMatchObject({ ok: false, code: 'CODE_CHARS' });
    expect(normalizeRoomCode('A1BCD')).toMatchObject({ ok: false, code: 'CODE_CHARS' });
    expect(normalizeRoomCode('AILCD')).toMatchObject({ ok: false, code: 'CODE_CHARS' });
  });

  it(' geçerli kodlar sunucuyla aynı kurallarla geçer', () => {
    const probe = 'XY98K';
    expect(probe.length).toBe(ROOM_CODE_LENGTH);
    for (const character of probe) {
      expect(ALPHABET).toContain(character);
    }
    expect(normalizeRoomCode(probe)).toMatchObject({ ok: true, value: probe });
  });
});

describe('chat counter (D1)', () => {
  it(' karakter sayısını n/300 biçiminde gösterir', () => {
    expect(chatCounter('')).toBe('0/300');
    expect(chatCounter('Aybe')).toBe('4/300');
    expect(chatCounter('m'.repeat(123))).toBe('123/300');
  });
});
