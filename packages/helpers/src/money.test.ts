import { describe, expect, test } from 'vitest';
import {
  BANK_ID,
  Bank,
  MoneyError,
  makeChange,
  type AuditEntry,
  type MoneyErrorCode,
} from './money.js';

const expectMoneyError = (fn: () => unknown, code: MoneyErrorCode): void => {
  try {
    fn();
    throw new Error('expected a MoneyError');
  } catch (error) {
    expect(error).toBeInstanceOf(MoneyError);
    expect((error as MoneyError).code).toBe(code);
  }
};

const newBank = (): Bank => new Bank({ vault: 1_000, players: ['alice', 'bob'], currency: 'TRY' });

describe('Bank accounts and transfers', () => {
  test('starts with the configured vault and zeroed players', () => {
    const bank = newBank();
    expect(bank.balanceOf(BANK_ID)).toBe(1_000);
    expect(bank.balanceOf('alice')).toBe(0);
    expect(bank.currency).toBe('TRY');
  });

  test('pay moves money between players', () => {
    const bank = newBank();
    bank.pay(BANK_ID, 'alice', 100, 'starting cash');
    bank.pay('alice', 'bob', 30, 'rent');
    expect(bank.balanceOf('alice')).toBe(70);
    expect(bank.balanceOf('bob')).toBe(30);
    expect(bank.totalSupply()).toBe(100);
  });

  test('transfer is an alias of pay', () => {
    const bank = newBank();
    bank.mint(50, 'alice', 'seed');
    const entry = bank.transfer('alice', 'bob', 20, 'gift');
    expect(bank.balanceOf('bob')).toBe(20);
    expect(entry.kind).toBe('pay');
  });

  test('rejects a player payment above their balance', () => {
    const bank = newBank();
    bank.pay(BANK_ID, 'alice', 10);
    expectMoneyError(() => bank.pay('alice', 'bob', 11), 'INSUFFICIENT_FUNDS');
    expect(bank.balanceOf('alice')).toBe(10);
  });

  test('player balances can never go negative', () => {
    const bank = newBank();
    expectMoneyError(() => bank.pay('alice', 'bob', 1), 'INSUFFICIENT_FUNDS');
    expect(bank.balanceOf('alice')).toBe(0);
    expect(bank.balanceOf('bob')).toBe(0);
  });

  test('rejects self transfers and unknown accounts', () => {
    const bank = newBank();
    expectMoneyError(() => bank.pay('alice', 'alice', 1), 'SELF_TRANSFER');
    expectMoneyError(() => bank.pay('alice', 'carol', 1), 'ACCOUNT_NOT_FOUND');
    expectMoneyError(() => bank.balanceOf('carol'), 'ACCOUNT_NOT_FOUND');
  });

  test('rejects non-positive and fractional amounts', () => {
    const bank = newBank();
    expectMoneyError(() => bank.pay(BANK_ID, 'alice', 0), 'INVALID_AMOUNT');
    expectMoneyError(() => bank.pay(BANK_ID, 'alice', -5), 'INVALID_AMOUNT');
    expectMoneyError(() => bank.pay(BANK_ID, 'alice', 1.5), 'INVALID_AMOUNT');
  });

  test('opens accounts and rejects duplicates', () => {
    const bank = newBank();
    bank.openAccount('carol');
    expect(bank.balanceOf('carol')).toBe(0);
    expectMoneyError(() => bank.openAccount('carol'), 'ACCOUNT_EXISTS');
    expectMoneyError(() => bank.openAccount(BANK_ID), 'INVALID_ACCOUNT');
  });
});

describe('Bank bankruptcy', () => {
  test('the bank may overdraw once and becomes bankrupt', () => {
    const bank = new Bank({ vault: 50, players: ['alice'] });
    bank.pay(BANK_ID, 'alice', 80, 'overdraft');
    expect(bank.balanceOf(BANK_ID)).toBe(-30);
    expect(bank.balanceOf('alice')).toBe(80);
    expect(bank.isBankrupt).toBe(true);
  });

  test('a bankrupt bank refuses further payouts with BANKRUPT', () => {
    const bank = new Bank({ vault: 50, players: ['alice'] });
    bank.pay(BANK_ID, 'alice', 80);
    expectMoneyError(() => bank.pay(BANK_ID, 'alice', 1), 'BANKRUPT');
    expect(bank.balanceOf('alice')).toBe(80);
  });

  test('redeeming beyond the reserves is BANKRUPT', () => {
    const bank = new Bank({ vault: 100, players: ['alice'] });
    bank.pay(BANK_ID, 'alice', 60);
    expect(bank.balanceOf(BANK_ID)).toBe(40);
    expectMoneyError(() => bank.redeem(60, 'alice'), 'BANKRUPT');
    expect(bank.balanceOf('alice')).toBe(60);
  });
});

describe('mint and redeem', () => {
  test('mint credits the player and grows the vault', () => {
    const bank = newBank();
    bank.mint(200, 'alice', 'issue');
    expect(bank.balanceOf('alice')).toBe(200);
    expect(bank.balanceOf(BANK_ID)).toBe(1_200);
    expect(bank.totalSupply()).toBe(200);
  });

  test('redeem debits the player and shrinks the vault', () => {
    const bank = newBank();
    bank.mint(200, 'alice');
    bank.redeem(50, 'alice', 'burn');
    expect(bank.balanceOf('alice')).toBe(150);
    expect(bank.balanceOf(BANK_ID)).toBe(1_150);
  });

  test('redeem rejects players without enough money', () => {
    const bank = newBank();
    expectMoneyError(() => bank.redeem(10, 'alice'), 'INSUFFICIENT_FUNDS');
  });

  test('minting to the bank or redeeming from it is invalid', () => {
    const bank = newBank();
    expectMoneyError(() => bank.mint(10, BANK_ID), 'INVALID_ACCOUNT');
    expectMoneyError(() => bank.redeem(10, BANK_ID), 'INVALID_ACCOUNT');
  });
});

describe('audit log', () => {
  test('records every operation in order with a logical clock', () => {
    const bank = newBank();
    bank.pay(BANK_ID, 'alice', 100, 'start');
    bank.pay('alice', 'bob', 40, 'bet');
    bank.mint(20, 'bob', 'bonus');

    const log = bank.log;
    expect(log.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(log.map((entry) => entry.kind)).toEqual(['pay', 'pay', 'mint']);
    expect(log[0]).toMatchObject({ from: BANK_ID, to: 'alice', amount: 100, reason: 'start' });
    expect(log[1]).toMatchObject({ from: 'alice', to: 'bob', amount: 40, reason: 'bet' });
    expect(log[2]).toMatchObject({ from: null, to: 'bob', amount: 20, reason: 'bonus' });
  });

  test('audit entries snapshot the touched balances', () => {
    const bank = newBank();
    bank.pay(BANK_ID, 'alice', 100);
    const entry: AuditEntry = bank.pay('alice', 'bob', 25);
    expect(entry.balances).toEqual({ alice: 75, bob: 25 });
  });

  test('failed operations are not logged', () => {
    const bank = newBank();
    expectMoneyError(() => bank.pay('alice', 'bob', 5), 'INSUFFICIENT_FUNDS');
    expect(bank.log).toHaveLength(0);
  });
});

describe('makeChange', () => {
  test('makes exact change with the fewest notes', () => {
    const result = makeChange(36, { 1: 10, 5: 1, 10: 1, 20: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.total).toBe(36);
    expect(result.coins).toEqual([
      { denomination: 20, count: 1 },
      { denomination: 10, count: 1 },
      { denomination: 5, count: 1 },
      { denomination: 1, count: 1 },
    ]);
  });

  test('respects limited stock', () => {
    const result = makeChange(30, { 10: 2, 5: 1 });
    expect(result).toEqual({ ok: false, code: 'UNMAKEABLE', message: expect.any(String) });
  });

  test('finds a solution greedy would miss', () => {
    const result = makeChange(40, { 25: 1, 10: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coins).toEqual([{ denomination: 10, count: 4 }]);
  });

  test('prefers fewer notes over larger denominations', () => {
    const result = makeChange(30, { 20: 1, 10: 5, 5: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coins).toEqual([
      { denomination: 20, count: 1 },
      { denomination: 10, count: 1 },
    ]);
  });

  test('accepts a Map of stock', () => {
    const result = makeChange(12, new Map([[10, 1], [1, 5]]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.coins).toEqual([
      { denomination: 10, count: 1 },
      { denomination: 1, count: 2 },
    ]);
  });

  test('zero is valid and yields no coins', () => {
    expect(makeChange(0, { 1: 5 })).toEqual({ ok: true, coins: [], total: 0 });
  });

  test('rejects negative and fractional amounts', () => {
    expect(makeChange(-1, { 1: 5 })).toMatchObject({ ok: false, code: 'INVALID_AMOUNT' });
    expect(makeChange(2.5, { 1: 5 })).toMatchObject({ ok: false, code: 'INVALID_AMOUNT' });
  });

  test('rejects invalid denominations', () => {
    expect(makeChange(5, { 0: 1 })).toMatchObject({ ok: false, code: 'INVALID_DENOMINATION' });
    expect(makeChange(5, { 1: -1 })).toMatchObject({ ok: false, code: 'INVALID_DENOMINATION' });
  });

  test('bank exposes pack denominations sorted', () => {
    const bank = new Bank({ denominations: [500, 1, 50, 5, 100, 10] });
    expect(bank.denominations).toEqual([1, 5, 10, 50, 100, 500]);
    expectMoneyError(() => new Bank({ denominations: [5, 5] }), 'INVALID_DENOMINATION');
  });
});
