/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { sanitizeObjectForClient, filterHandForClient } from './secrets.js';
import type { ObjectDef } from '@chambler/shared';

const card: ObjectDef = {
  id: 'c1',
  kind: 'card',
  assetRef: 'deck/ace',
  transform: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
  ownerId: 'owner',
  locked: false,
  faceUp: false,
  meta: { cardId: 'ace-spades', cardIds: ['x'] },
};

describe('secrets', () => {
  it('strips card identity from face-down card for non-owner', () => {
    const out = sanitizeObjectForClient(card, 'other');
    expect((out.meta as any).cardId).toBeUndefined();
    expect((out.meta as any).cardIds).toBeUndefined();
    expect(out.assetRef).toContain('#back');
  });
  it('keeps identity for owner', () => {
    const out = sanitizeObjectForClient(card, 'owner');
    expect((out.meta as any).cardId).toBe('ace-spades');
    expect(out.assetRef).toBe('deck/ace');
  });
  it('keeps identity when face-up', () => {
    const up = { ...card, faceUp: true };
    const out = sanitizeObjectForClient(up, 'other');
    expect((out.meta as any).cardId).toBe('ace-spades');
  });
  it('filters hand for non-owner', () => {
    expect(filterHandForClient({ ownerId: 'owner', cardIds: ['a'] }, 'other')).toBeNull();
  });
  it('returns hand for owner', () => {
    expect(filterHandForClient({ ownerId: 'owner', cardIds: ['a'] }, 'owner')).toEqual({ ownerId: 'owner', cardIds: ['a'] });
  });
});
