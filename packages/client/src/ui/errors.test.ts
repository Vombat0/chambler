import { describe, expect, it } from 'vitest';
import { isKnownErrorCode, joinFailureCode, resolveError } from './errors.js';

describe('error code mapping (D1)', () => {
  it(' bilinen kodlar err.<CODE> anahtarına eşlenir', () => {
    for (const code of ['SEAT_TAKEN', 'COLOR_TAKEN', 'ROOM_FULL', 'OBJECT_CLAIMED']) {
      const resolved = resolveError(code, 'server says hi');
      expect(resolved).toEqual({ key: `err.${code}`, unknown: false, serverMessage: 'server says hi' });
    }
  });

  it(' bilinmeyen kod err.UNKNOWN anahtarına düşer ve sunucu metnini korur', () => {
    const resolved = resolveError('MYSTERY_CODE', 'oddball detail');
    expect(resolved).toEqual({ key: 'err.UNKNOWN', unknown: true, serverMessage: 'oddball detail' });
  });

  it(' isKnownErrorCode servisi tutarlı', () => {
    expect(isKnownErrorCode('SEAT_TAKEN')).toBe(true);
    expect(isKnownErrorCode('MADE_UP')).toBe(false);
  });

  it(' joinFailure: Room not found algılanır', () => {
    const err = new Error('room "TABLE" not found');
    expect(joinFailureCode(err)).toBe('ROOM_NOT_FOUND');
  });

  it(' joinFailure: Room full algılanır', () => {
    expect(joinFailureCode(new Error('ROOM_FULL: no seat or colour left.'))).toBe('ROOM_FULL');
  });

  it(' joinFailure: bilinmeyen başarısızlık JOIN_FAILED olur', () => {
    expect(joinFailureCode(new Error('network down'))).toBe('JOIN_FAILED');
    expect(joinFailureCode('kapalı')).toBe('JOIN_FAILED');
  });
});
