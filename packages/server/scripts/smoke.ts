/**
 * End-to-end smoke test against a real, running server.
 *
 *   PORT=3101 pnpm --filter @chambler/server exec tsx src/index.ts &
 *   pnpm --filter @chambler/server exec tsx scripts/smoke.ts
 *
 * Two real colyseus.js clients: one creates a table, the second joins by room
 * code, then they exchange chat messages (state channel).
 */
import { Client, type Room } from 'colyseus.js';

const ENDPOINT = process.env.SMOKE_URL ?? 'ws://127.0.0.1:3101';
const HTTP_ENDPOINT = ENDPOINT.replace(/^ws/, 'http');

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

async function waitFor<T>(read: () => T | undefined, label: string, timeoutMs = 5000): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() - startedAt > timeoutMs) {
      fail(`timeout waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function nextMessage<T>(room: Room, type: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`timeout waiting for "${type}"`));
    }, timeoutMs);
    const off = room.onMessage<T>(type, (message) => {
      clearTimeout(timer);
      off();
      resolve(message);
    });
  });
}

function playerCount(room: Room): number {
  const state = room.state as { players?: { size: number } } | undefined;
  return state?.players?.size ?? 0;
}

const client = new Client(ENDPOINT);
const host = await client.create('table', { name: 'SmokeHost' });
host.onMessage('join', () => undefined);
host.onMessage('leave', () => undefined);
const code = await waitFor(
  () => (host.state as { code?: string } | undefined)?.code,
  'room code',
);
console.log(`1. room created: code=${code} roomId=${host.roomId}`);

const guest = await client.joinById(code, { name: 'SmokeGuest' });
guest.onMessage('join', () => undefined);
guest.onMessage('leave', () => undefined);
await waitFor(() => (playerCount(host) === 2 && playerCount(guest) === 2 ? true : undefined), '2 players');
const seats = [...((host.state as { players: Map<string, { seat: number; color: string }> }).players).values()];
console.log(
  `2. guest joined by code: players=${seats.length} seats=${seats.map((p) => p.seat).join(',')} colors=${seats.map((p) => p.color).join(',')}`,
);

const guestSawChat = nextMessage<{ playerId: string; text: string }>(guest, 'chat');
host.send('chat', { text: 'hello from the host' });
const fromHost = await guestSawChat;
console.log(`3. host -> guest chat: "${fromHost.text}" (playerId=${fromHost.playerId})`);

// The host also receives its own broadcast; collect until the guest's message
// shows up (a plain "next message" would race with the host's own copy).
const hostChats: { playerId: string; text: string }[] = [];
host.onMessage<{ playerId: string; text: string }>('chat', (message) => hostChats.push(message));
guest.send('chat', { text: 'hello from the guest' });
const fromGuest = await waitFor(
  () => hostChats.find((message) => message.text === 'hello from the guest'),
  'guest chat on the host',
);
console.log(`4. guest -> host chat: "${fromGuest.text}" (playerId=${fromGuest.playerId})`);
if (fromGuest.playerId !== guest.sessionId) {
  fail('chat playerId does not match the guest session');
}

const health = await fetch(`${HTTP_ENDPOINT}/health`);
console.log(`5. /health -> ${health.status} ${JSON.stringify(await health.json())}`);

const lookup = await fetch(`${HTTP_ENDPOINT}/api/rooms/${code}`);
const lookupBody = (await lookup.json()) as { players?: unknown[]; maxPlayers?: number };
console.log(
  `6. /api/rooms/${code} -> ${lookup.status} players=${lookupBody.players?.length} max=${lookupBody.maxPlayers}`,
);

const missing = await fetch(`${HTTP_ENDPOINT}/api/rooms/ZZZZZ`);
console.log(`7. unknown code -> ${missing.status} ${JSON.stringify(await missing.json())}`);

await host.leave();
await guest.leave();
host.connection.close();
guest.connection.close();
console.log('8. both clients left; smoke test passed');
process.exit(0);
