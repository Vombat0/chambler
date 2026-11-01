/**
 * Mülk Tycoon — çok oyunculu durum köprüsü.
 *
 * Oyun motoru saf ve deterministiktir. Bu adaptör, aynı `MonopolyState`
 * nesnesini bir Colyseus odasındaki bütün istemcilere taşır:
 *
 *   room.send('monopoly:state', state)
 *   room.onMessage('monopoly:state', (state) => …)
 *
 * Sunucu tarafı yetki (authoritative) doğrulaması ayrı bir katmandır; bu
 * adaptör yalnızca durum yayınını/aboneliğini standartlaştırır. Oda yoksa
 * görünüm tamamen yerel (hot-seat) çalışır.
 */

import type { MonopolyState } from './monopolyEngine.js';

export interface RoomLike {
  send(type: string, payload: unknown): void;
  onMessage?(type: string, callback: (payload: unknown) => void): (() => void) | void;
  removeAllListeners?(type: string): void;
}

export interface MonopolySync {
  publish(state: MonopolyState): void;
  /** Uzak durum geldiğinde dinleyiciyi çağırır; aboneliği iptal eden fonksiyon döner. */
  subscribe(listener: (state: MonopolyState) => void): () => void;
}

export const MONOPOLY_STATE_MESSAGE = 'monopoly:state';

function parseState(raw: unknown): MonopolyState | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<MonopolyState>;
  if (!Array.isArray(candidate.players) || typeof candidate.currentPlayerIndex !== 'number') return null;
  if (typeof candidate.phase !== 'string' || !candidate.dice) return null;
  return candidate as MonopolyState;
}

export function createRoomSync(room: RoomLike): MonopolySync {
  return {
    publish(state) {
      room.send(MONOPOLY_STATE_MESSAGE, state);
    },
    subscribe(listener) {
      if (!room.onMessage) return () => {};
      const off = room.onMessage(MONOPOLY_STATE_MESSAGE, (payload) => {
        const parsed = parseState(payload);
        if (parsed) listener(parsed);
      });
      return () => {
        if (typeof off === 'function') off();
      };
    },
  };
}
