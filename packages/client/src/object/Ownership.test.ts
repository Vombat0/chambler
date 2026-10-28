import { describe, expect, it } from 'vitest';
import { OwnershipTable } from './Ownership.js';
import { ObjectEventEmitter } from './ObjectEvents.js';

describe('OwnershipTable', () => {
  it('claim free object succeeds', () => {
    const o = new OwnershipTable();
    o.init('o1', null);
    expect(o.claim('o1', 'p1')).toBe(true);
    expect(o.getOwner('o1')).toBe('p1');
  });
  it('claim by other fails (lock)', () => {
    const o = new OwnershipTable();
    o.init('o1', 'p1');
    expect(o.claim('o1', 'p2')).toBe(false);
    expect(o.isOwnedByOther('o1', 'p2')).toBe(true);
  });
  it('same owner can re-claim', () => {
    const o = new OwnershipTable();
    o.init('o1', 'p1');
    expect(o.claim('o1', 'p1')).toBe(true);
  });
  it('release by owner succeeds', () => {
    const o = new OwnershipTable();
    o.init('o1', 'p1');
    expect(o.release('o1', 'p1')).toBe(true);
    expect(o.getOwner('o1')).toBeNull();
  });
  it('release by non-owner fails', () => {
    const o = new OwnershipTable();
    o.init('o1', 'p1');
    expect(o.release('o1', 'p2')).toBe(false);
    expect(o.getOwner('o1')).toBe('p1');
  });
  it('emits claim/release events', () => {
    const events: string[] = [];
    const emitter = new ObjectEventEmitter();
    emitter.on('objectClaim', () => events.push('objectClaim'));
    emitter.on('objectRelease', () => events.push('objectRelease'));
    const o = new OwnershipTable(emitter);
    o.init('o1', null);
    o.claim('o1', 'p1');
    o.release('o1', 'p1');
    expect(events).toContain('objectClaim');
    expect(events).toContain('objectRelease');
  });
});
