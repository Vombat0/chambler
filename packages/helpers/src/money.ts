/**
 * Integer-only money: accounts, audit log and limited-stock change making.
 * All amounts are minor units (kuruş/cents). Floating point is never used.
 */

export type MoneyErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_ACCOUNT'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_EXISTS'
  | 'SELF_TRANSFER'
  | 'INSUFFICIENT_FUNDS'
  | 'BANKRUPT'
  | 'INVALID_DENOMINATION'
  | 'INVALID_STATE';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/** Reserved account id for the bank / vault. */
export const BANK_ID = '@bank';

export type LedgerKind = 'pay' | 'mint' | 'redeem' | 'open';

export interface AuditEntry {
  /** Logical clock, 1-based and strictly increasing. */
  seq: number;
  kind: LedgerKind;
  /** Payer account, `null` when money is minted. */
  from: string | null;
  /** Payee account, `null` when money is redeemed. */
  to: string | null;
  amount: number;
  reason: string;
  /** Balances of the touched accounts after the operation. */
  balances: Record<string, number>;
}

export interface BankOptions {
  /** Starting vault balance (may be 0). */
  vault?: number;
  /** Note/coin denominations offered by the pack, e.g. [1, 5, 10, 50, 100, 500]. */
  denominations?: readonly number[];
  /** Player account ids created with a zero balance. */
  players?: readonly string[];
  /** Free-form currency label, e.g. "TRY". */
  currency?: string;
}

export const DEFAULT_DENOMINATIONS: readonly number[] = [1, 5, 10, 25, 100];

const MAX_CHANGE_AMOUNT = 1_000_000;

function assertAmount(amount: number, label = 'Amount'): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new MoneyError('INVALID_AMOUNT', `${label} must be a positive integer, got ${String(amount)}`);
  }
}

function assertAccountId(id: string): void {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new MoneyError('INVALID_ACCOUNT', 'Account id must be a non-empty string');
  }
}

export class Bank {
  readonly currency: string;
  readonly denominations: readonly number[];

  private readonly balances = new Map<string, number>();
  private readonly entries: AuditEntry[] = [];
  private seq = 0;
  private bankrupt = false;

  constructor(options: BankOptions = {}) {
    this.currency = options.currency ?? 'unit';
    const vault = options.vault ?? 0;
    if (!Number.isSafeInteger(vault)) {
      throw new MoneyError('INVALID_AMOUNT', 'Vault must be an integer number of minor units');
    }
    const denominations = options.denominations ?? DEFAULT_DENOMINATIONS;
    if (denominations.length === 0) {
      throw new MoneyError('INVALID_DENOMINATION', 'At least one denomination is required');
    }
    const seen = new Set<number>();
    for (const denom of denominations) {
      if (!Number.isSafeInteger(denom) || denom <= 0 || seen.has(denom)) {
        throw new MoneyError('INVALID_DENOMINATION', `Invalid denomination ${String(denom)}`);
      }
      seen.add(denom);
    }
    this.denominations = [...denominations].sort((a, b) => a - b);
    this.balances.set(BANK_ID, vault);
    for (const player of options.players ?? []) {
      this.createAccount(player, false);
    }
  }

  /** True once the bank has paid out more than its vault and can no longer pay. */
  get isBankrupt(): boolean {
    return this.bankrupt;
  }

  /** Immutable view of the audit log, oldest first. */
  get log(): readonly AuditEntry[] {
    return this.entries;
  }

  accountIds(): string[] {
    return [...this.balances.keys()];
  }

  hasAccount(id: string): boolean {
    return this.balances.has(id);
  }

  balanceOf(id: string): number {
    assertAccountId(id);
    const balance = this.balances.get(id);
    if (balance === undefined) {
      throw new MoneyError('ACCOUNT_NOT_FOUND', `Unknown account "${id}"`);
    }
    return balance;
  }

  /** Sum of all player balances (the bank vault is a reserve, not player money). */
  totalSupply(): number {
    let total = 0;
    for (const [id, balance] of this.balances) {
      if (id !== BANK_ID) total += balance;
    }
    return total;
  }

  openAccount(id: string): void {
    this.createAccount(id, true);
  }

  private createAccount(id: string, log: boolean): void {
    assertAccountId(id);
    if (id === BANK_ID) {
      throw new MoneyError('INVALID_ACCOUNT', `"${BANK_ID}" is reserved for the bank`);
    }
    if (this.balances.has(id)) {
      throw new MoneyError('ACCOUNT_EXISTS', `Account "${id}" already exists`);
    }
    this.balances.set(id, 0);
    if (log) this.record('open', null, id, 0, 'open account');
  }

  pay(from: string, to: string, amount: number, reason = ''): AuditEntry {
    assertAmount(amount);
    this.requireAccount(from);
    this.requireAccount(to);
    if (from === to) {
      throw new MoneyError('SELF_TRANSFER', 'Payer and payee must differ');
    }

    if (from === BANK_ID) {
      if (this.bankrupt) {
        throw new MoneyError('BANKRUPT', 'The bank is bankrupt and cannot pay out');
      }
      if (this.balanceOf(BANK_ID) - amount < 0) {
        // Allowed once: the bank overdraws and is flagged bankrupt afterwards.
        this.bankrupt = true;
      }
    } else if (this.balanceOf(from) < amount) {
      throw new MoneyError(
        'INSUFFICIENT_FUNDS',
        `Account "${from}" has ${this.balanceOf(from)}, cannot pay ${amount}`,
      );
    }

    this.balances.set(from, this.balanceOf(from) - amount);
    this.balances.set(to, this.balanceOf(to) + amount);
    return this.record('pay', from, to, amount, reason);
  }

  /** Alias of `pay` for symmetric reading. */
  transfer(from: string, to: string, amount: number, reason = ''): AuditEntry {
    return this.pay(from, to, amount, reason);
  }

  /** Creates money into a player account; the vault grows by the same amount. */
  mint(amount: number, to: string, reason = ''): AuditEntry {
    assertAmount(amount);
    this.requireAccount(to);
    if (to === BANK_ID) {
      throw new MoneyError('INVALID_ACCOUNT', 'Cannot mint directly into the bank');
    }
    this.balances.set(to, this.balanceOf(to) + amount);
    this.balances.set(BANK_ID, this.balanceOf(BANK_ID) + amount);
    return this.record('mint', null, to, amount, reason);
  }

  /** Destroys money from a player account; the vault shrinks by the same amount. */
  redeem(amount: number, from: string, reason = ''): AuditEntry {
    assertAmount(amount);
    this.requireAccount(from);
    if (from === BANK_ID) {
      throw new MoneyError('INVALID_ACCOUNT', 'Cannot redeem from the bank');
    }
    if (this.balanceOf(from) < amount) {
      throw new MoneyError(
        'INSUFFICIENT_FUNDS',
        `Account "${from}" has ${this.balanceOf(from)}, cannot redeem ${amount}`,
      );
    }
    if (this.balanceOf(BANK_ID) < amount) {
      throw new MoneyError(
        'BANKRUPT',
        `The bank reserves ${this.balanceOf(BANK_ID)} cannot redeem ${amount}`,
      );
    }
    this.balances.set(from, this.balanceOf(from) - amount);
    this.balances.set(BANK_ID, this.balanceOf(BANK_ID) - amount);
    return this.record('redeem', from, null, amount, reason);
  }

  private requireAccount(id: string): void {
    assertAccountId(id);
    if (!this.balances.has(id)) {
      throw new MoneyError('ACCOUNT_NOT_FOUND', `Unknown account "${id}"`);
    }
  }

  private record(
    kind: LedgerKind,
    from: string | null,
    to: string | null,
    amount: number,
    reason: string,
  ): AuditEntry {
    this.seq += 1;
    const balances: Record<string, number> = {};
    if (from !== null) balances[from] = this.balanceOf(from);
    if (to !== null) balances[to] = this.balanceOf(to);
    const entry: AuditEntry = {
      seq: this.seq,
      kind,
      from,
      to,
      amount,
      reason,
      balances,
    };
    this.entries.push(entry);
    return entry;
  }
}

export interface ChangeCoin {
  denomination: number;
  count: number;
}

export interface ChangeOk {
  ok: true;
  coins: ChangeCoin[];
  total: number;
}

export interface ChangeFail {
  ok: false;
  code: 'INVALID_AMOUNT' | 'INVALID_DENOMINATION' | 'UNMAKEABLE';
  message: string;
}

export type ChangeResult = ChangeOk | ChangeFail;

export type ChangeStock = Readonly<Record<number, number>> | ReadonlyMap<number, number>;

function normalizeStock(stock: ChangeStock): Map<number, number> | ChangeFail {
  const result = new Map<number, number>();
  const entries: Array<[number, number]> =
    stock instanceof Map
      ? [...stock.entries()]
      : Object.entries(stock as Record<string, number>).map(([key, count]) => [
          Number(key),
          count,
        ]);

  for (const [denomination, count] of entries) {
    if (!Number.isSafeInteger(denomination) || denomination <= 0) {
      return { ok: false, code: 'INVALID_DENOMINATION', message: `Invalid denomination ${denomination}` };
    }
    if (!Number.isSafeInteger(count) || count < 0) {
      return {
        ok: false,
        code: 'INVALID_DENOMINATION',
        message: `Invalid stock for denomination ${denomination}: ${String(count)}`,
      };
    }
    if (count > 0) result.set(denomination, count);
  }
  return result;
}

/**
 * Makes exact change from limited stock. Uses bounded min-note DP (not greedy),
 * so it finds a solution whenever one exists and prefers fewer notes, then
 * larger denominations. Deterministic for a given input.
 */
export function makeChange(amount: number, available: ChangeStock): ChangeResult {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    return { ok: false, code: 'INVALID_AMOUNT', message: `Amount must be a non-negative integer, got ${String(amount)}` };
  }
  if (amount > MAX_CHANGE_AMOUNT) {
    return { ok: false, code: 'INVALID_AMOUNT', message: `Amount exceeds ${MAX_CHANGE_AMOUNT}` };
  }
  if (amount === 0) return { ok: true, coins: [], total: 0 };

  const stock = normalizeStock(available);
  if ('ok' in stock) return stock;

  const denominations = [...stock.keys()].sort((a, b) => b - a);
  const chunks: Array<{ denomination: number; value: number; count: number }> = [];
  for (const denomination of denominations) {
    let remaining = stock.get(denomination) ?? 0;
    let block = 1;
    while (remaining > 0) {
      const take = Math.min(block, remaining);
      chunks.push({ denomination, value: denomination * take, count: take });
      remaining -= take;
      block <<= 1;
    }
  }

  const inf = 0x7fffffff;
  const best = new Int32Array(amount + 1).fill(inf);
  const parentChunk = new Int32Array(amount + 1).fill(-1);
  const parentAmount = new Int32Array(amount + 1).fill(-1);
  best[0] = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (!chunk) continue;
    for (let sum = amount; sum >= chunk.value; sum -= 1) {
      const previous = best[sum - chunk.value];
      if (previous === undefined || previous === inf) continue;
      if (previous + 1 < (best[sum] ?? inf)) {
        best[sum] = previous + 1;
        parentChunk[sum] = index;
        parentAmount[sum] = sum - chunk.value;
      }
    }
  }

  if ((best[amount] ?? inf) === inf) {
    return { ok: false, code: 'UNMAKEABLE', message: `Cannot make ${amount} from the available stock` };
  }

  const counts = new Map<number, number>();
  let cursor = amount;
  while (cursor > 0) {
    const index = parentChunk[cursor] ?? -1;
    if (index < 0) {
      return { ok: false, code: 'UNMAKEABLE', message: `Cannot make ${amount} from the available stock` };
    }
    const chunk = chunks[index];
    if (!chunk) break;
    counts.set(chunk.denomination, (counts.get(chunk.denomination) ?? 0) + chunk.count);
    cursor = parentAmount[cursor] ?? 0;
  }

  const coins: ChangeCoin[] = [...counts.entries()]
    .map(([denomination, count]) => ({ denomination, count }))
    .sort((a, b) => b.denomination - a.denomination);

  return { ok: true, coins, total: amount };
}
