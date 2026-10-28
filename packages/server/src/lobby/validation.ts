/** Tiny, dependency-free helpers for validating untrusted client payloads. */

/** True for plain objects (arrays and `null` excluded). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads `key` from an untrusted payload, or `undefined`. */
export function readField(payload: unknown, key: string): unknown {
  return isRecord(payload) ? payload[key] : undefined;
}

/** Short, log-safe description of an untrusted message type. */
export function describeMessageType(type: unknown): string {
  if (typeof type === 'string') {
    return type.length > 32 ? `${type.slice(0, 32)}…` : type;
  }
  if (typeof type === 'number') {
    return String(type);
  }
  return typeof type;
}
