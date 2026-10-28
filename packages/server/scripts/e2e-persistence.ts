/**
 * B4 end-to-end proof: a table survives a real server crash + restart.
 *
 *   1. boots the BUILT server (dist/index.js) with a temp SNAPSHOT_DIR
 *   2. creates a room, spawns a pawn + a die, rolls the die (dieResult)
 *   3. waits for the DEBOUNCED autosave to hit disk (no forced save!)
 *   4. SIGKILLs the server — no graceful shutdown, no onDispose save
 *   5. restarts the server against the same SNAPSHOT_DIR
 *   6. joins the same room code via POST /reopen and asserts the table
 *      came back: object position, die value, and the player's seat.
 *
 * Run: pnpm --filter @chambler/server build && pnpm --filter @chambler/server e2e:persistence
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'colyseus.js';
import type { ObjectDef, TableResyncMessage } from '@chambler/shared';

const SNAPSHOT_HINT = '5 s debounce / 10 s max interval (server defaults)';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', 'dist', 'index.js');
const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
const UNIT = { x: 1, y: 1, z: 1 };

function log(step: string, detail = ''): void {
  console.log(`[e2e] ${step}${detail ? ` — ${detail}` : ''}`);
}

function fail(step: string, detail: string): never {
  console.error(`[e2e] FAIL ${step} — ${detail}`);
  process.exitCode = 1;
  throw new Error(`${step}: ${detail}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function httpJson(port: number, pathname: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  return fetch(`http://127.0.0.1:${port}${pathname}`, init).then(async (res) => ({
    status: res.status,
    body: await res.json().catch(() => ({})),
  }));
}

function startServer(port: number, savesDir: string): ChildProcess {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      SNAPSHOT_DIR: savesDir,
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout!.on('data', (d: Buffer) => process.stdout.write(`[server] ${d}`));
  child.stderr!.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`));
  return child;
}

async function waitHealthy(port: number, child: ChildProcess, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail('boot', `server exited with code ${child.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail('boot', `server did not become healthy within ${timeoutMs} ms`);
}

function waitForFile(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(file)) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`save file did not appear within ${timeoutMs} ms: ${file}`));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

/** Waits for the next message of `type` (handler must already be registered). */
function nextMessage<T>(room: { onMessage: (t: string, cb: (m: any) => void) => void }, type: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
    room.onMessage(type, (message) => {
      clearTimeout(timer);
      resolve(message as T);
    });
  });
}

async function main(): Promise<void> {
  if (!fs.existsSync(SERVER_ENTRY)) {
    fail('build', 'dist/index.js not found — run `pnpm --filter @chambler/server build` first');
  }
  const savesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chambler-b4-e2e-'));
  let child: ChildProcess | null = null;
  try {
    /* ---------- phase 1: first server, live table ---------- */
    const port1 = await freePort();
    log('phase 1', `starting server on :${port1}, saves at ${savesDir}`);
    child = startServer(port1, savesDir);
    await waitHealthy(port1, child);

    const sdk = new Client(`ws://127.0.0.1:${port1}`);
    const room = await sdk.create('table', { name: 'Ayse' });
    const code = room.roomId;
    const sessionId = room.sessionId;
    // Handlers are registered synchronously after join: the server already
    // sent tableResync (and any dieResult replay) during onJoin.
    const resync1 = nextMessage<TableResyncMessage>(room, 'tableResync', 5000).catch(() => null);
    const dieBroadcast = nextMessage<any>(room, 'dieResult', 10_000).catch(() => null);
    void resync1;
    log('room created', `code=${code} sessionId=${sessionId}`);
    if ((await resync1) === null) fail('join', 'no tableResync after create');

    const pawn: ObjectDef = {
      id: 'e2e-pawn',
      kind: 'pawn',
      assetRef: 'risk/pawn-red',
      transform: { position: { x: 5, y: 0, z: 5 }, rotation: IDENTITY, scale: UNIT },
      ownerId: null,
      locked: false,
      faceUp: true,
      meta: {},
    };
    const die: ObjectDef = {
      id: 'e2e-die',
      kind: 'die',
      assetRef: 'risk/die-white',
      transform: { position: { x: -3, y: 0, z: 2 }, rotation: IDENTITY, scale: UNIT },
      ownerId: null,
      locked: false,
      faceUp: true,
      meta: { faces: 6 },
    };
    room.send('objectSpawn', { object: pawn });
    room.send('objectSpawn', { object: die });
    // Claim the die (only the owner may report the roll), then roll it.
    room.send('objectClaim', { objectId: die.id });
    for (let i = 0; i < 100 && (room.state as any)?.objects?.get('e2e-die')?.ownerId !== sessionId; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if ((room.state as any)?.objects?.get('e2e-die')?.ownerId !== sessionId) {
      fail('claim', 'die claim did not take effect');
    }
    room.send('dieResult', { objectId: die.id, value: 6 });

    const rolled = await dieBroadcast;
    if (!rolled || rolled.value !== 6) fail('die', `dieResult broadcast missing or wrong: ${JSON.stringify(rolled)}`);

    // Wait until the room state actually holds both objects + the roll.
    for (let i = 0; i < 100 && !(room.state as any)?.objects?.has('e2e-die'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const state = room.state as any;
    if (!state?.objects?.has('e2e-pawn') || !state?.objects?.has('e2e-die')) {
      fail('spawn', 'objects did not reach room state');
    }
    const seatBefore = [...state.players.values()].find((p: any) => p.id === sessionId)?.seat;
    const colorBefore = [...state.players.values()].find((p: any) => p.id === sessionId)?.color;
    log('table live', `pawn@(+5,+5) die=6 seat=${seatBefore} color=${colorBefore}`);

    /* ---------- phase 2: debounced autosave hits disk ---------- */
    const saveFile = path.join(savesDir, `${code}.json`);
    log('phase 2', `waiting for debounced autosave (${SNAPSHOT_HINT})`);
    try {
      await waitForFile(saveFile, 25_000);
    } catch (error) {
      fail('autosave', String(error));
    }
    const raw = fs.readFileSync(saveFile, 'utf8');
    const parsed = JSON.parse(raw) as any;
    if (parsed.schemaVersion !== 1 || parsed.roomCode !== code) {
      fail('autosave', `unexpected snapshot header: ${raw.slice(0, 200)}`);
    }
    log('autosave on disk', `${saveFile} (${raw.length} bytes)`);

    /* ---------- phase 3: crash (SIGKILL — no graceful save) ---------- */
    log('phase 3', 'SIGKILL server (no onDispose forced save)');
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => {
      if (child!.exitCode !== null) resolve();
      else child!.on('exit', () => resolve());
    });
    log('server dead', `exitCode=${child.exitCode} signal=${child.signalCode}`);
    child = null;

    /* ---------- phase 4: restart, rejoin same code ---------- */
    const port2 = await freePort();
    log('phase 4', `starting server on :${port2} (same SNAPSHOT_DIR)`);
    child = startServer(port2, savesDir);
    await waitHealthy(port2, child);

    const saves = await httpJson(port2, '/api/saves');
    const listed = Array.isArray(saves.body.saves) && saves.body.saves.some((s: any) => s.roomCode === code);
    if (!listed) fail('api/saves', `restart lost the save listing: ${JSON.stringify(saves.body)}`);
    log('save listed', `${code} is in GET /api/saves`);

    const sdk2 = new Client(`ws://127.0.0.1:${port2}`);
    let joinFailed = false;
    try {
      await sdk2.joinById(code, { name: 'Ayse' });
    } catch {
      joinFailed = true; // expected: the room is not live after the restart
    }
    if (!joinFailed) fail('rejoin', 'joinById succeeded before reopen — room should not be live');

    const reopen = await httpJson(port2, `/api/rooms/${code}/reopen`, { method: 'POST' });
    if (reopen.status !== 200 || reopen.body.restored !== true) {
      fail('reopen', `reopen failed: ${reopen.status} ${JSON.stringify(reopen.body)}`);
    }
    log('room reopened', `restored from ${new Date(reopen.body.createdAt).toISOString()}, ${reopen.body.objects} objects`);

    const room2 = await sdk2.joinById(code, { name: 'Ayse' });
    // Registered synchronously after join: the server replays the die result
    // during onJoin, BEFORE the tableResync message.
    const dieReplay = nextMessage<{ objectId: string; value: number }>(room2, 'dieResult', 5000);
    const resync2 = await nextMessage<TableResyncMessage>(room2, 'tableResync', 5000);
    const objects = resync2.objects as ObjectDef[];
    const pawnBack = objects.find((o) => o.id === 'e2e-pawn');
    const dieBack = objects.find((o) => o.id === 'e2e-die');
    if (!pawnBack) fail('verify', `pawn missing from resync: ${JSON.stringify(objects.map((o) => o.id))}`);
    if (!dieBack) fail('verify', `die missing from resync`);
    if (pawnBack!.transform.position.x !== 5 || pawnBack!.transform.position.z !== 5) {
      fail('verify', `pawn position lost: ${JSON.stringify(pawnBack!.transform.position)}`);
    }
    const replayed = await dieReplay;
    if (!replayed || replayed.objectId !== 'e2e-die' || replayed.value !== 6) {
      fail('verify', `die roll lost: ${JSON.stringify(replayed)}`);
    }
    const me = [...(room2.state as any).players.values()].find((p: any) => p.name === 'Ayse');
    if (seatBefore !== undefined && me && me.seat !== seatBefore) {
      fail('verify', `seat not restored: before=${seatBefore} after=${me.seat}`);
    }
    if (colorBefore !== undefined && me && me.color !== colorBefore) {
      fail('verify', `color not restored: before=${colorBefore} after=${me.color}`);
    }
    log('state verified', `pawn@(+5,+5) die=6 seat=${me?.seat} color=${me?.color}`);

    await room2.leave(true);
    log('PASS', 'table survived a server crash and restart (autosave only)');
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGKILL');
    }
    fs.rmSync(savesDir, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(`[e2e] aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(process.exitCode ?? 1);
});
