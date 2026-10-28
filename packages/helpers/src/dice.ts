/**
 * Dice notation parser, seeded RNG and roller.
 *
 * Notations: `1d6`, `2d6+1`, `4d6kh3`, `2d20kl1`, `3d8-2`, `1d6x3`, `d66`.
 * A roll is fully determined by `(notation, seed)`.
 */

export type DiceErrorCode =
  | 'INVALID_NOTATION'
  | 'COUNT_RANGE'
  | 'SIDES_RANGE'
  | 'KEEP_RANGE'
  | 'MODIFIER_RANGE'
  | 'MULT_RANGE'
  | 'SEED_INVALID'
  | 'NO_CRYPTO';

export class DiceError extends Error {
  readonly code: DiceErrorCode;

  constructor(code: DiceErrorCode, message: string) {
    super(message);
    this.name = 'DiceError';
    this.code = code;
  }
}

export type KeepMode = 'highest' | 'lowest';

export interface ParsedNotation {
  /** Normalized notation, e.g. `4d6kh3+1`. */
  notation: string;
  /** Number of dice (2 for the `d66` table). */
  count: number;
  /** Faces per die (6 for the `d66` table). */
  sides: number;
  /** Keep-highest / keep-lowest rule, when present. */
  keep?: { mode: KeepMode; n: number };
  /** Flat modifier added after the sum, before the multiplier. */
  modifier: number;
  /** Multiplier applied to `(sum + modifier)`. */
  mult: number;
  /** True for the two-d6 `d66` hundreds table (result 11..66). */
  table: boolean;
}

export interface RolledDie {
  sides: number;
  value: number;
  kept: boolean;
}

export interface RollResult {
  total: number;
  dice: RolledDie[];
  modifier: number;
  mult: number;
  notation: string;
}

export interface RollOptions {
  /** Number or string seed. Omitted means a secure random seed. */
  seed?: number | string;
}

/** Pseudo-random function returning a float in `[0, 1)`. */
export type Rng = () => number;

const NOTATION_RE = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?([+-]\d+)?(?:x(\d+))?$/;

const MIN_COUNT = 1;
const MAX_COUNT = 100;
const MIN_SIDES = 1;
const MAX_SIDES = 1000;
const MAX_MODIFIER = 10_000;
const MAX_MULT = 1000;

/** Parses a dice notation. Throws `DiceError` with a code and a message. */
export function parseNotation(input: string): ParsedNotation {
  if (typeof input !== 'string') {
    throw new DiceError('INVALID_NOTATION', 'Notation must be a string');
  }
  const notation = input.trim().toLowerCase();
  if (notation.length === 0) {
    throw new DiceError('INVALID_NOTATION', 'Notation is empty');
  }

  const match = NOTATION_RE.exec(notation);
  if (!match) {
    throw new DiceError(
      'INVALID_NOTATION',
      `Unsupported dice notation "${input}"; expected e.g. 2d6+1, 4d6kh3, 1d6x3 or d66`,
    );
  }

  const countRaw = match[1] ?? '';
  const count = countRaw === '' ? 1 : Number.parseInt(countRaw, 10);
  const sides = Number.parseInt(match[2] ?? '', 10);
  const table = countRaw === '' && sides === 66;

  if (!Number.isSafeInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    throw new DiceError('COUNT_RANGE', `Dice count must be ${MIN_COUNT}..${MAX_COUNT}, got ${count}`);
  }
  if (!Number.isSafeInteger(sides) || sides < MIN_SIDES || sides > MAX_SIDES) {
    throw new DiceError('SIDES_RANGE', `Dice sides must be ${MIN_SIDES}..${MAX_SIDES}, got ${sides}`);
  }

  const keepModeRaw = match[3];
  const keepNRaw = match[4];
  let keep: ParsedNotation['keep'];
  if (keepModeRaw !== undefined) {
    if (table) {
      throw new DiceError('INVALID_NOTATION', 'd66 does not support keep/drop rules');
    }
    const n = Number.parseInt(keepNRaw ?? '', 10);
    if (!Number.isSafeInteger(n) || n < 1 || n > count) {
      throw new DiceError('KEEP_RANGE', `Keep count must be 1..${count}, got ${keepNRaw ?? ''}`);
    }
    keep = { mode: keepModeRaw === 'kh' ? 'highest' : 'lowest', n };
  }

  let modifier = 0;
  const modifierRaw = match[5];
  if (modifierRaw !== undefined) {
    if (table) {
      throw new DiceError('INVALID_NOTATION', 'd66 does not support modifiers');
    }
    modifier = Number.parseInt(modifierRaw, 10);
    if (!Number.isSafeInteger(modifier) || Math.abs(modifier) > MAX_MODIFIER) {
      throw new DiceError(
        'MODIFIER_RANGE',
        `Modifier must be within ±${MAX_MODIFIER}, got ${modifierRaw}`,
      );
    }
  }

  let mult = 1;
  const multRaw = match[6];
  if (multRaw !== undefined) {
    if (table) {
      throw new DiceError('INVALID_NOTATION', 'd66 does not support multipliers');
    }
    mult = Number.parseInt(multRaw, 10);
    if (!Number.isSafeInteger(mult) || mult < 1 || mult > MAX_MULT) {
      throw new DiceError('MULT_RANGE', `Multiplier must be 1..${MAX_MULT}, got ${multRaw}`);
    }
  }

  return {
    notation,
    count: table ? 2 : count,
    sides: table ? 6 : sides,
    ...(keep ? { keep } : {}),
    modifier,
    mult,
    table,
  };
}

function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i += 1) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function splitmix32(seed: number): [number, number, number, number] {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x9e3779b9) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
  return [next(), next(), next(), next()];
}

function seedWords(seed: number | string): [number, number, number, number] {
  if (typeof seed === 'string') {
    if (seed.length === 0) {
      throw new DiceError('SEED_INVALID', 'Seed string must not be empty');
    }
    return cyrb128(seed);
  }
  if (!Number.isFinite(seed)) {
    throw new DiceError('SEED_INVALID', `Seed must be a finite number or a non-empty string`);
  }
  return splitmix32(Math.trunc(seed));
}

/** Creates a deterministic sfc32 generator. The same seed always yields the same stream. */
export function createRng(seed: number | string): Rng {
  const [s0, s1, s2, s3] = seedWords(seed);
  let a = s0;
  let b = s1;
  let c = s2;
  let d = s3;
  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // Discard the first outputs so nearby seeds diverge immediately.
  for (let i = 0; i < 12; i += 1) next();
  return next;
}

/** Cryptographically strong 32-bit seed for live (non-replay) rolls. */
export function secureSeed(): number {
  const webCrypto = globalThis.crypto;
  if (!webCrypto || typeof webCrypto.getRandomValues !== 'function') {
    throw new DiceError('NO_CRYPTO', 'crypto.getRandomValues is unavailable; pass an explicit seed');
  }
  const buffer = new Uint32Array(1);
  webCrypto.getRandomValues(buffer);
  return buffer[0] ?? 0;
}

function rollDie(sides: number, rng: Rng): number {
  return 1 + Math.floor(rng() * sides);
}

/** Rolls an already parsed notation with a supplied RNG (useful for replay). */
export function rollParsed(parsed: ParsedNotation, rng: Rng): RollResult {
  if (parsed.table) {
    const tens = rollDie(6, rng);
    const units = rollDie(6, rng);
    return {
      total: tens * 10 + units,
      dice: [
        { sides: 6, value: tens, kept: true },
        { sides: 6, value: units, kept: true },
      ],
      modifier: 0,
      mult: 1,
      notation: parsed.notation,
    };
  }

  const dice: RolledDie[] = [];
  for (let i = 0; i < parsed.count; i += 1) {
    dice.push({ sides: parsed.sides, value: rollDie(parsed.sides, rng), kept: true });
  }

  let kept = dice;
  if (parsed.keep) {
    const { mode, n } = parsed.keep;
    const order = dice
      .map((die, index) => ({ die, index }))
      .sort((left, right) => {
        const byValue = mode === 'highest' ? right.die.value - left.die.value : left.die.value - right.die.value;
        return byValue !== 0 ? byValue : left.index - right.index;
      });
    const keepIndexes = new Set(order.slice(0, n).map((entry) => entry.index));
    kept = dice.map((die, index) => ({ ...die, kept: keepIndexes.has(index) }));
  }

  const sum = kept.reduce((acc, die) => (die.kept ? acc + die.value : acc), 0);
  return {
    total: (sum + parsed.modifier) * parsed.mult,
    dice: kept,
    modifier: parsed.modifier,
    mult: parsed.mult,
    notation: parsed.notation,
  };
}

/** Parses and rolls a notation. Same notation + same seed = same result. */
export function roll(notation: string, options: RollOptions = {}): RollResult {
  const parsed = parseNotation(notation);
  const rng = createRng(options.seed ?? secureSeed());
  return rollParsed(parsed, rng);
}
