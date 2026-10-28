/**
 * Runtime configuration for the Chambler server.
 *
 * Everything comes from environment variables so the same build can run in
 * development, tests and production. Defaults are safe for local development.
 */

export interface ServerConfig {
  /** TCP port for HTTP (/health, /api) + WebSocket. */
  readonly port: number;
  /** Interface to bind. */
  readonly host: string;
  /** Browser origins allowed to call the HTTP API / open a WebSocket. `['*']` allows all. */
  readonly corsOrigins: readonly string[];
  /** Hard cap of players per table (Colyseus `maxClients`). */
  readonly maxPlayers: number;
  /** Seconds a dropped player keeps their seat (reconnection window, full flow lands in B4). */
  readonly reconnectionSeconds: number;
  /** Max chat message length in characters (after sanitising). */
  readonly chatMaxLength: number;
  /** Chat messages allowed per player per window. */
  readonly chatRateLimit: number;
  /** Chat rate-limit window in milliseconds. */
  readonly chatRateWindowMs: number;
  /** Largest accepted WebSocket frame (bytes). Protects against oversized payloads. */
  readonly maxPayloadBytes: number;
  /**
   * Room-wide outbound transform budget in bytes per second (B3). Frames above
   * it are trimmed fairly per player; the session is never dropped.
   * `TRANSFORM_BUDGET_BYTES_PER_SEC`.
   */
  readonly transformBudgetBytesPerSec: number;
  /** Send interval of the batched transform flush in ms (`TRANSFORM_FLUSH_MS`, 10..200). */
  readonly transformFlushMs: number;
  /** Directory holding table snapshots (`SNAPSHOT_DIR`). */
  readonly snapshotDir: string;
  /** Max snapshots kept on disk before the oldest is deleted (`MAX_SAVES`). */
  readonly maxSaves: number;
  /** Debounce for the automatic room save in ms (`SNAPSHOT_DEBOUNCE_MS`). */
  readonly snapshotDebounceMs: number;
  /** Hard cap between two automatic saves while changes keep coming (`SNAPSHOT_MAX_INTERVAL_MS`). */
  readonly snapshotMaxIntervalMs: number;
  /** Largest serialised snapshot accepted in bytes (`SNAPSHOT_MAX_BYTES`). */
  readonly snapshotMaxBytes: number;
}

import { DEFAULT_TRANSFORM_BUDGET_BYTES_PER_SEC } from '@chambler/shared';

export const DEFAULT_CORS_ORIGIN = 'http://localhost:5173';
export const MAX_TABLE_PLAYERS = 8;

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    return fallback;
  }
  return value;
}

function readList(env: NodeJS.ProcessEnv, key: string, fallback: readonly string[]): string[] {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return [...fallback];
  }
  const values = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length > 0 ? values : [...fallback];
}

/** Reads the server configuration from `env` (defaults to `process.env`). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: readInt(env, 'PORT', 3001, 0, 65535),
    host: env.HOST?.trim() || '0.0.0.0',
    corsOrigins: readList(env, 'CORS_ORIGINS', [DEFAULT_CORS_ORIGIN]),
    maxPlayers: readInt(env, 'MAX_PLAYERS', MAX_TABLE_PLAYERS, 1, MAX_TABLE_PLAYERS),
    reconnectionSeconds: readInt(env, 'RECONNECTION_SECONDS', 30, 0, 300),
    chatMaxLength: readInt(env, 'CHAT_MAX_LENGTH', 300, 1, 2000),
    chatRateLimit: readInt(env, 'CHAT_RATE_LIMIT', 3, 1, 100),
    chatRateWindowMs: readInt(env, 'CHAT_RATE_WINDOW_MS', 1000, 100, 60_000),
    maxPayloadBytes: readInt(env, 'MAX_PAYLOAD_BYTES', 16 * 1024, 1024, 1024 * 1024),
    transformBudgetBytesPerSec: readInt(
      env,
      'TRANSFORM_BUDGET_BYTES_PER_SEC',
      DEFAULT_TRANSFORM_BUDGET_BYTES_PER_SEC,
      1024,
      64 * 1024 * 1024,
    ),
    transformFlushMs: readInt(env, 'TRANSFORM_FLUSH_MS', 50, 10, 200),
    snapshotDir: env.SNAPSHOT_DIR?.trim() || '.chambler/saves',
    maxSaves: readInt(env, 'MAX_SAVES', 50, 1, 10_000),
    snapshotDebounceMs: readInt(env, 'SNAPSHOT_DEBOUNCE_MS', 5_000, 100, 600_000),
    snapshotMaxIntervalMs: readInt(env, 'SNAPSHOT_MAX_INTERVAL_MS', 10_000, 200, 3_600_000),
    snapshotMaxBytes: readInt(env, 'SNAPSHOT_MAX_BYTES', 4 * 1024 * 1024, 1024, 64 * 1024 * 1024),
  };
}

/** True when `origin` is allowed by the configured CORS allow-list. */
export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) {
    // Non-browser clients (tests, server-to-server) send no Origin header.
    return true;
  }
  return allowed.includes('*') || allowed.includes(origin);
}
