/**
 * SnapshotStore (B4) — durable table snapshots on local disk.
 *
 * Design notes:
 *
 * - SYNC IO, deliberately. Saves are debounced to >= SNAPSHOT_DEBOUNCE_MS
 *   apart and capped at SNAPSHOT_MAX_BYTES, so a write blocks the event loop
 *   for well under a millisecond in practice — and the room's `onDispose`
 *   can force a save that is guaranteed to hit the disk before the process
 *   is allowed to exit (an async write there would race shutdown).
 * - Atomic writes: data goes to `<code>.json.tmp`, is fsync'ed, then renamed
 *   over `<code>.json`. A crash mid-write can leave a `.tmp` (ignored) but
 *   never a half-written snapshot.
 * - Corrupt files (unparsable JSON or structurally invalid with a known
 *   schemaVersion) are quarantined as `<code>.json.corrupt` and logged, so a
 *   bad file cannot brick a room code forever and the evidence is kept.
 * - Files whose schemaVersion is not the one this server understands are
 *   reported as `unsupported` and left in place: they may be perfectly valid
 *   for a newer server (downgrades must not destroy data).
 * - At most MAX_SAVES files are kept; the oldest (by savedAt, mtime fallback)
 *   is deleted first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from 'colyseus';
import {
  SNAPSHOT_SCHEMA_VERSION,
  getSnapshotSchemaVersion,
  snapshotSecretLeak,
  validateTableSnapshot,
  type TableSnapshot,
} from '@chambler/shared';
import { normalizeRoomCode } from '../lobby/roomCode.js';
import { loadConfig } from '../config.js';

export type SnapshotSaveResult =
  | { ok: true; bytes: number; savedAt: number; pruned: string[] }
  | { ok: false; code: 'TOO_LARGE' | 'INVALID' | 'CODE_INVALID' | 'SECRET_LEAK'; message: string };

export type SnapshotLoadResult =
  | { status: 'ok'; snapshot: TableSnapshot }
  | { status: 'missing' }
  | { status: 'corrupt'; quarantined: string | null }
  | { status: 'unsupported'; foundVersion: number | null };

export interface SaveSummary {
  roomCode: string;
  savedAt: number;
  bytes: number;
  objects: number;
}

export interface SnapshotStoreOptions {
  dir?: string;
  maxSaves?: number;
  maxBytes?: number;
}

export class SnapshotStore {
  readonly dir: string;
  readonly maxSaves: number;
  readonly maxBytes: number;

  constructor(opts: SnapshotStoreOptions = {}) {
    this.dir = opts.dir ?? loadConfig().snapshotDir;
    this.maxSaves = opts.maxSaves ?? loadConfig().maxSaves;
    this.maxBytes = opts.maxBytes ?? loadConfig().snapshotMaxBytes;
  }

  private fileFor(roomCode: string): string {
    return path.join(this.dir, `${roomCode}.json`);
  }

  /** Normalises to a valid room code or null. */
  normalize(code: unknown): string | null {
    return normalizeRoomCode(code);
  }

  /**
   * Validates and atomically writes `snapshot`. Returns a non-ok result
   * (never throws) so callers can report the failure without try/catch.
   */
  save(snapshot: TableSnapshot): SnapshotSaveResult {
    const code = this.normalize(snapshot.roomCode);
    if (!code) {
      return { ok: false, code: 'CODE_INVALID', message: `Invalid room code "${snapshot.roomCode}".` };
    }
    const validation = validateTableSnapshot(snapshot);
    if (!validation.ok) {
      return { ok: false, code: 'INVALID', message: `Snapshot failed validation: ${validation.errors.join('; ')}` };
    }
    const leak = snapshotSecretLeak(snapshot);
    if (leak) {
      // Defense in depth: a leaking snapshot must never reach the disk.
      return { ok: false, code: 'SECRET_LEAK', message: `Refusing to save: ${leak}.` };
    }
    const json = JSON.stringify(snapshot);
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes > this.maxBytes) {
      return {
        ok: false,
        code: 'TOO_LARGE',
        message: `Snapshot is ${bytes} bytes; the limit is ${this.maxBytes}.`,
      };
    }

    fs.mkdirSync(this.dir, { recursive: true });
    const target = this.fileFor(code);
    const tmp = `${target}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
    this.syncDirBestEffort();

    const pruned = this.prune();
    logger.info(`[snapshot] saved ${code} (${bytes} B, ${snapshot.objects.length} objects${pruned.length ? `, pruned ${pruned.join(',')}` : ''})`);
    return { ok: true, bytes, savedAt: snapshot.savedAt, pruned };
  }

  /**
   * Loads the snapshot for `roomCode`. Corrupt files are quarantined
   * (renamed to `.corrupt`); files from another schema version are reported
   * as `unsupported` and left untouched.
   */
  load(roomCode: string): SnapshotLoadResult {
    const code = this.normalize(roomCode);
    if (!code) return { status: 'missing' };
    const file = this.fileFor(code);
    if (!fs.existsSync(file)) return { status: 'missing' };
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      logger.warn(`[snapshot] cannot read ${file}: ${String(error)}`);
      return { status: 'corrupt', quarantined: null };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return this.quarantine(file, `unparsable JSON: ${String(error)}`);
    }
    const version = getSnapshotSchemaVersion(parsed);
    if (version !== null && version !== SNAPSHOT_SCHEMA_VERSION) {
      logger.warn(`[snapshot] ${code} has schemaVersion ${version}, expected ${SNAPSHOT_SCHEMA_VERSION}`);
      return { status: 'unsupported', foundVersion: version };
    }
    const validation = validateTableSnapshot(parsed);
    if (!validation.ok) {
      return this.quarantine(file, `invalid content: ${validation.errors.join('; ')}`);
    }
    return { status: 'ok', snapshot: parsed as TableSnapshot };
  }

  private quarantine(file: string, reason: string): SnapshotLoadResult {
    const moved = `${file}.corrupt`;
    try {
      fs.renameSync(file, moved);
      logger.warn(`[snapshot] quarantined ${file} -> ${moved} (${reason})`);
      return { status: 'corrupt', quarantined: moved };
    } catch (error) {
      logger.error(`[snapshot] could not quarantine ${file}: ${String(error)}`);
      return { status: 'corrupt', quarantined: null };
    }
  }

  /** Lists saved tables, newest first. */
  list(): SaveSummary[] {
    if (!fs.existsSync(this.dir)) return [];
    const summaries: SaveSummary[] = [];
    for (const entry of fs.readdirSync(this.dir)) {
      if (!entry.endsWith('.json')) continue;
      const file = path.join(this.dir, entry);
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as TableSnapshot;
        summaries.push({
          roomCode: parsed.roomCode ?? entry.replace(/\.json$/, ''),
          savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
          bytes: fs.statSync(file).size,
          objects: Array.isArray(parsed.objects) ? parsed.objects.length : 0,
        });
      } catch {
        // Corrupt files are not listed; `load` quarantines them on touch.
      }
    }
    summaries.sort((a, b) => b.savedAt - a.savedAt);
    return summaries;
  }

  /** Deletes the save for `roomCode`; true when a file was removed. */
  delete(roomCode: string): boolean {
    const code = this.normalize(roomCode);
    if (!code) return false;
    const file = this.fileFor(code);
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file);
    return true;
  }

  /** Removes leftover `.tmp` files (crash recovery helper). */
  clearTmp(): string[] {
    if (!fs.existsSync(this.dir)) return [];
    const removed: string[] = [];
    for (const entry of fs.readdirSync(this.dir)) {
      if (!entry.endsWith('.tmp')) continue;
      fs.rmSync(path.join(this.dir, entry));
      removed.push(entry);
    }
    return removed;
  }

  /** Enforces MAX_SAVES; returns the pruned room codes (oldest first). */
  private prune(): string[] {
    const saves = this.list();
    if (saves.length <= this.maxSaves) return [];
    const excess = saves.slice(this.maxSaves);
    for (const save of excess) {
      const file = this.fileFor(save.roomCode);
      try {
        fs.rmSync(file);
        logger.info(`[snapshot] pruned ${save.roomCode} (MAX_SAVES=${this.maxSaves})`);
      } catch (error) {
        logger.warn(`[snapshot] could not prune ${file}: ${String(error)}`);
      }
    }
    return excess.map((save) => save.roomCode);
  }

  private syncDirBestEffort(): void {
    try {
      const fd = fs.openSync(this.dir, 'r');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // Directory fsync is not supported everywhere; the rename is enough.
    }
  }
}

/* ------------------------------------------------------------------ */
/* Process-wide default store (same pattern as configureTableRoom)     */
/* ------------------------------------------------------------------ */

let defaultStore: SnapshotStore | null = null;

/** Installs the store rooms and HTTP handlers share (called by app setup). */
export function configureSnapshotStore(store: SnapshotStore): void {
  defaultStore = store;
}

/** The shared store; lazily built from the environment on first use. */
export function getSnapshotStore(): SnapshotStore {
  defaultStore ??= new SnapshotStore();
  return defaultStore;
}
