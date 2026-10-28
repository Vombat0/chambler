/**
 * Die-result validation (B3) — pure, side-effect free, unit testable.
 *
 * The owning client reads the face after the die stops and reports it. The
 * server is the authority: it checks the object really is a die, that the
 * reporter owns it, that the value is an integer inside 1..faces, and that the
 * same claim epoch does not flip the result back and forth inside a short
 * conflict window (that is what a cheating client would do to re-roll a bad
 * outcome without picking the die up again).
 *
 * A new roll starts a new epoch: picking the die up issues a fresh claim token,
 * so a legitimate second throw is accepted while a rapid contradictory report
 * is rejected.
 */
import { DIE_RESULT_CONFLICT_WINDOW_MS } from '@chambler/shared';

export type DieResultErrorCode =
  | 'DIE_NOT_DIE'
  | 'DIE_FORBIDDEN'
  | 'DIE_RESULT_INVALID'
  | 'DIE_RESULT_CONFLICT';

export interface DieResultEpoch {
  value: number;
  /** Claim token active when the result was accepted (epoch identity). */
  claimToken: string | null;
  /** Server clock (ms) of acceptance. */
  at: number;
}

export interface DieResultContext {
  /** ObjectDef.kind of the target object. */
  kind: string;
  /** Face count the value is validated against. */
  faces: number;
  /** Raw value as received from the wire. */
  value: unknown;
  /** True when the reporter currently owns the object. */
  isOwner: boolean;
  /** Claim token of the current epoch (null when unowned). */
  claimToken: string | null;
  /** Last accepted result for this object, if any. */
  previous: DieResultEpoch | null;
  now: number;
  conflictWindowMs?: number;
}

export type DieResultVerdict =
  | { ok: true; value: number; faces: number }
  | { ok: false; code: DieResultErrorCode; message: string };

/** Reads the face count from object meta (`faces` / `sides`), default 6. */
export function dieFaceCount(meta: Record<string, unknown> | null | undefined): number {
  const raw = meta?.faces ?? meta?.sides ?? meta?.diceFaces;
  const numeric = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric)) return 6;
  if (numeric < 2 || numeric > 1000) return 6;
  return numeric;
}

/** Full validation for a reported die result. */
export function validateDieResult(ctx: DieResultContext): DieResultVerdict {
  if (ctx.kind !== 'die') {
    return { ok: false, code: 'DIE_NOT_DIE', message: `Object is a ${ctx.kind || 'unknown'}, not a die.` };
  }
  if (!ctx.isOwner) {
    return { ok: false, code: 'DIE_FORBIDDEN', message: 'Only the owner can report a die result.' };
  }
  const faces = Number.isInteger(ctx.faces) && ctx.faces >= 2 ? ctx.faces : 6;
  const value = ctx.value;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > faces) {
    return {
      ok: false,
      code: 'DIE_RESULT_INVALID',
      message: `Die value must be an integer between 1 and ${faces}.`,
    };
  }

  const window = ctx.conflictWindowMs ?? DIE_RESULT_CONFLICT_WINDOW_MS;
  const previous = ctx.previous;
  if (
    previous &&
    previous.value !== value &&
    previous.claimToken === ctx.claimToken &&
    ctx.now - previous.at < window
  ) {
    return {
      ok: false,
      code: 'DIE_RESULT_CONFLICT',
      message: `Die already reported ${previous.value} for this throw; pick it up before rolling again.`,
    };
  }

  return { ok: true, value, faces };
}
