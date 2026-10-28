/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Real bandwidth measurement for the transform channel (B3).
 *
 * Boots a real Chambler server, connects 8 real colyseus.js clients, spawns 20
 * objects and moves them for N seconds. Two scenarios run back to back:
 *
 *   1. `legacy` — the B2 wire format: one JSON `transformUpdate` per object at
 *      20 Hz, no motion gating, no batching.
 *   2. `binary` — the B3 path: TransformSender motion filter (20/5/0 Hz) +
 *      binary `transformBatch` packets, one flush per render tick.
 *
 * Bytes are counted twice, independently:
 *   - server side: payload bytes x recipients for every accepted broadcast
 *     (`TableRoom.getMetrics()`), plus frames/batches/rejections;
 *   - client side: the raw WebSocket, by hooking `send()` and adding a
 *     `message` listener, so protocol framing and msgpack overhead are real.
 *
 * Run: pnpm --filter @chambler/server bandwidth
 *      pnpm --filter @chambler/server bandwidth -- --seconds=10
 */
import { Client } from 'colyseus.js';
import { matchMaker } from 'colyseus';
import { createChamblerServer, type ChamblerServer } from '../src/app.js';
import type { TableRoom } from '../src/rooms/TableRoom.js';
import { TransformSender } from '../../client/src/net/TransformSender.js';

const PLAYERS = 8;
const OBJECTS = 20;
const TICK_MS = 16; // 60 Hz render loop
const DEFAULT_SECONDS = 30;
const TICK_HZ = 1000 / TICK_MS;

type Scenario = 'legacy' | 'binary';

interface ScenarioResult {
  scenario: Scenario;
  seconds: number;
  budgetBytesPerSec: number;
  server: {
    framesAccepted: number;
    framesDropped: number;
    framesPerSecond: number;
    batches: number;
    batchesPerSecond: number;
    appBytes: number;
    appBytesPerSecond: number;
    bytesPerFrame: number;
    budgetRejections: number;
    legacyJsonFrames: number;
  };
  wire: {
    receivedBytes: number;
    receivedBytesPerSecond: number;
    sentBytes: number;
    sentBytesPerSecond: number;
    receivedMessagesPerSecond: number;
    bytesPerReceivedMessage: number;
  };
  cpuPercent: number;
}

function parseArgs(argv: string[]): { seconds: number } {
  const secondsArg = argv.find((a) => a.startsWith('--seconds='));
  const seconds = secondsArg ? Number(secondsArg.split('=')[1]) : DEFAULT_SECONDS;
  return { seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_SECONDS };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ObjectMotion {
  id: string;
  owner: number;
  kind: 'fast' | 'slow' | 'still';
  phase: number;
  amplitude: number;
  frequency: number;
}

function planMotion(objectCount: number, playerCount: number): ObjectMotion[] {
  const motions: ObjectMotion[] = [];
  for (let i = 0; i < objectCount; i += 1) {
    // 40% fast (dragged/thrown), 40% slow (nudged), 20% resting on the table
    const kind: ObjectMotion['kind'] = i % 5 < 2 ? 'fast' : i % 5 < 4 ? 'slow' : 'still';
    motions.push({
      id: `obj-${i}`,
      owner: i % playerCount,
      kind,
      phase: (i * Math.PI) / 7,
      amplitude: kind === 'fast' ? 0.5 : 0.05,
      frequency: kind === 'fast' ? 0.5 : 0.2,
    });
  }
  return motions;
}

function sampleMotion(motion: ObjectMotion, tSeconds: number) {
  if (motion.kind === 'still') {
    return {
      position: { x: motion.phase, y: 0.5, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      rotation: { w: 1, x: 0, y: 0, z: 0 },
    };
  }
  const w = 2 * Math.PI * motion.frequency;
  const x = motion.amplitude * Math.sin(w * tSeconds + motion.phase);
  const vx = motion.amplitude * w * Math.cos(w * tSeconds + motion.phase);
  const half = (vx > 0 ? 0.02 : -0.02) * Math.sin(w * tSeconds);
  return {
    position: { x, y: 0.5, z: motion.phase * 0.1 },
    velocity: { x: vx, y: 0, z: 0 },
    rotation: { w: Math.cos(half), x: 0, y: Math.sin(half), z: 0 },
  };
}

interface WireCounter {
  receivedBytes: number;
  receivedMessages: number;
  sentBytes: number;
  sentMessages: number;
}

interface TestClient {
  room: any;
  counter: WireCounter;
}

/** Hooks the real WebSocket so every wire byte is counted. */
function instrument(room: any): WireCounter {
  const counter: WireCounter = { receivedBytes: 0, receivedMessages: 0, sentBytes: 0, sentMessages: 0 };
  const ws = room?.connection?.transport?.ws;
  if (!ws) return counter;
  ws.addEventListener('message', (event: { data: ArrayBuffer | Uint8Array | string }) => {
    const data = event.data;
    const size =
      typeof data === 'string'
        ? Buffer.byteLength(data, 'utf8')
        : data instanceof ArrayBuffer
          ? data.byteLength
          : data.byteLength;
    counter.receivedBytes += size;
    counter.receivedMessages += 1;
  });
  const originalSend = ws.send.bind(ws);
  ws.send = (data: ArrayBuffer | Uint8Array | string) => {
    const size =
      typeof data === 'string'
        ? Buffer.byteLength(data, 'utf8')
        : data instanceof ArrayBuffer
          ? data.byteLength
          : data.byteLength;
    counter.sentBytes += size;
    counter.sentMessages += 1;
    return originalSend(data);
  };
  return counter;
}

async function runScenario(scenario: Scenario, seconds: number, budgetBytesPerSec: number): Promise<ScenarioResult> {
  const chambler: ChamblerServer = createChamblerServer({
    port: 0,
    maxPlayers: PLAYERS,
    reconnectionSeconds: 0,
    transformBudgetBytesPerSec: budgetBytesPerSec,
    transformFlushMs: 50,
  });
  const port = await chambler.start();
  const url = `ws://127.0.0.1:${port}`;
  const clients: TestClient[] = [];

  try {
    // --- connect 8 real clients ---
    for (let i = 0; i < PLAYERS; i += 1) {
      const client = new Client(url);
      const room =
        i === 0
          ? await client.create('table', { name: `P${i}` })
          : await client.joinById((clients[0]!.room as { roomId: string }).roomId, { name: `P${i}` });
      clients.push({ room, counter: instrument(room) });
    }
    const roomId = (clients[0]!.room as { roomId: string }).roomId;
    await sleep(200);

    // --- spawn 20 objects, each owned by its player ---
    const motions = planMotion(OBJECTS, PLAYERS);
    for (const motion of motions) {
      const owner = clients[motion.owner]!;
      owner.room.send('objectSpawn', {
        object: {
          id: motion.id,
          kind: 'pawn',
          assetRef: '',
          transform: { position: { x: 0, y: 0.5, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
          ownerId: owner.room.sessionId,
          locked: false,
          faceUp: true,
          meta: {},
        },
      });
      owner.room.send('objectClaim', { objectId: motion.id });
    }
    // wait for the server to accept all spawns
    const instance = matchMaker.getLocalRoomById(roomId) as unknown as TableRoom;
    const spawnDeadline = Date.now() + 5000;
    while (instance.state.objects.size < OBJECTS && Date.now() < spawnDeadline) {
      await sleep(20);
    }
    if (instance.state.objects.size < OBJECTS) {
      throw new Error(`only ${instance.state.objects.size}/${OBJECTS} objects spawned`);
    }

    // --- senders (binary path) ---
    const senders = clients.map(() => new TransformSender());
    // adopt the server-assigned netIndex for every owned object
    for (const motion of motions) {
      const index = instance.state.objects.get(motion.id)!.netIndex;
      senders[motion.owner]!.registerIndex(motion.id, index);
    }

    const before = instance.getMetrics();
    const cpuBefore = process.cpuUsage();
    const wallStart = Date.now();
    const durationMs = seconds * 1000;
    const sentBefore = clients.map((c) => ({ ...c.counter }));
    let frameIndex = 0;

    while (Date.now() - wallStart < durationMs) {
      const now = Date.now();
      const tSeconds = (now - wallStart) / 1000;
      frameIndex += 1;

      if (scenario === 'legacy') {
        // B2 behaviour: one JSON frame per object at 20 Hz, no motion filter.
        for (const motion of motions) {
          if (frameIndex % Math.round(TICK_HZ / 20) !== 0) continue;
          const sample = sampleMotion(motion, tSeconds);
          const owner = clients[motion.owner]!;
          owner.room.send('transformUpdate', {
            id: motion.id,
            transform: { ...sample, scale: { x: 1, y: 1, z: 1 } },
            velocity: sample.velocity,
            seq: Math.round(tSeconds * 20) + 1,
            t: now,
          });
        }
      } else {
        // B3 behaviour: every client samples its own objects at 60 Hz, the
        // sender decides whether/when a frame is actually emitted.
        for (const motion of motions) {
          const sample = sampleMotion(motion, tSeconds);
          senders[motion.owner]!.enqueue(motion.id, { ...sample, scale: { x: 1, y: 1, z: 1 } }, sample.velocity, now);
        }
        for (let i = 0; i < clients.length; i += 1) {
          const sender = senders[i]!;
          const room = clients[i]!.room;
          sender.flushTo(now, (bytes) => room.send('transformBatch', bytes));
        }
      }

      await sleep(TICK_MS);
    }

    const wallMs = Date.now() - wallStart;
    const cpu = process.cpuUsage(cpuBefore);
    const after = instance.getMetrics();

    const sentAfter = clients.map((c) => ({ ...c.counter }));
    const wireReceived = sentAfter.reduce((sum, c, i) => sum + c.receivedBytes - sentBefore[i]!.receivedBytes, 0);
    const wireReceivedMessages = sentAfter.reduce(
      (sum, c, i) => sum + c.receivedMessages - sentBefore[i]!.receivedMessages,
      0,
    );
    const wireSent = sentAfter.reduce((sum, c, i) => sum + c.sentBytes - sentBefore[i]!.sentBytes, 0);

    const elapsedSeconds = wallMs / 1000;
    const frames = after.transformFramesAccepted - before.transformFramesAccepted;
    const appBytes = after.transformBytesSent - before.transformBytesSent;
    const batches = after.transformBatchesSent - before.transformBatchesSent;

    return {
      scenario,
      seconds: elapsedSeconds,
      budgetBytesPerSec,
      server: {
        framesAccepted: frames,
        framesDropped: after.transformFramesDropped - before.transformFramesDropped,
        framesPerSecond: frames / elapsedSeconds,
        batches,
        batchesPerSecond: batches / elapsedSeconds,
        appBytes,
        appBytesPerSecond: appBytes / elapsedSeconds,
        // app bytes are payload x recipients; divide by recipients to get the
        // size of one object frame on the wire.
        // The owner is excluded from the fan-out, so payload is record x (players-1).
        bytesPerFrame: frames > 0 ? appBytes / frames / (PLAYERS - 1) : 0,
        budgetRejections: after.budgetRejections - before.budgetRejections,
        legacyJsonFrames: after.legacyJsonFrames - before.legacyJsonFrames,
      },
      wire: {
        receivedBytes: wireReceived,
        receivedBytesPerSecond: wireReceived / elapsedSeconds,
        sentBytes: wireSent,
        sentBytesPerSecond: wireSent / elapsedSeconds,
        receivedMessagesPerSecond: wireReceivedMessages / elapsedSeconds,
        bytesPerReceivedMessage: wireReceivedMessages > 0 ? wireReceived / wireReceivedMessages : 0,
      },
      cpuPercent: ((cpu.user + cpu.system) / 1000 / wallMs) * 100,
    };
  } finally {
    for (const client of clients) {
      try {
        await client.room.leave(true);
      } catch {
        // ignore
      }
    }
    await chambler.stop();
  }
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(1);
}

function printResult(result: ScenarioResult): void {
  const label = result.scenario === 'legacy' ? 'BEFORE (JSON, 20 Hz, no filter)' : 'AFTER (binary batch, motion gated)';
  console.log(`\n--- ${label} ---`);
  console.log(`duration            : ${result.seconds.toFixed(1)} s`);
  console.log(`room budget         : ${result.budgetBytesPerSec > 1_000_000 ? 'disabled' : `${kb(result.budgetBytesPerSec)} KB/s`}`);
  console.log(`frames sent         : ${result.server.framesAccepted} (${result.server.framesPerSecond.toFixed(1)}/s), dropped ${result.server.framesDropped}`);
  console.log(`packets             : ${result.server.batches} (${result.server.batchesPerSecond.toFixed(1)}/s)`);
  console.log(`bytes per object    : ${result.server.bytesPerFrame.toFixed(1)} B on the wire (codec record is 40 B + batch header)`);
  console.log(`server app traffic  : ${kb(result.server.appBytesPerSecond)} KB/s`);
  console.log(`client wire recv    : ${kb(result.wire.receivedBytesPerSecond)} KB/s aggregate (${kb(result.wire.receivedBytesPerSecond / PLAYERS)} KB/s per client)`);
  console.log(`client wire send    : ${kb(result.wire.sentBytesPerSecond)} KB/s aggregate`);
  console.log(`wire messages       : ${result.wire.receivedMessagesPerSecond.toFixed(1)}/s, ${result.wire.bytesPerReceivedMessage.toFixed(1)} B each`);
  console.log(`budget rejections   : ${result.server.budgetRejections}`);
  console.log(`CPU (script process): ${result.cpuPercent.toFixed(1)} %`);
}

async function main(): Promise<void> {
  const { seconds } = parseArgs(process.argv.slice(2));
  console.log(`Chambler transform bandwidth — ${PLAYERS} clients, ${OBJECTS} objects, ${seconds}s per scenario`);
  console.log(`tick ${TICK_HZ.toFixed(0)} Hz, server flush 50 ms`);

  const unlimited = 64 * 1024 * 1024;
  const legacy = await runScenario('legacy', seconds, unlimited);
  printResult(legacy);

  const binaryUncapped = await runScenario('binary', seconds, unlimited);
  printResult(binaryUncapped);

  const binaryCapped = await runScenario('binary', seconds, 64 * 1024);
  printResult(binaryCapped);

  const reduction = legacy.wire.receivedBytesPerSecond / Math.max(1, binaryUncapped.wire.receivedBytesPerSecond);
  console.log('\n--- SUMMARY ---');
  console.log(`wire traffic before : ${kb(legacy.wire.receivedBytesPerSecond)} KB/s (${kb(legacy.wire.receivedBytesPerSecond / PLAYERS)} KB/s per client)`);
  console.log(`wire traffic after  : ${kb(binaryUncapped.wire.receivedBytesPerSecond)} KB/s (${kb(binaryUncapped.wire.receivedBytesPerSecond / PLAYERS)} KB/s per client)`);
  console.log(`reduction           : ${reduction.toFixed(1)}x`);
  console.log(`target <= 100 KB/s  : ${binaryUncapped.wire.receivedBytesPerSecond <= 100 * 1024 ? 'MET' : 'MISSED'} (uncapped demand)`);
  console.log(`target <= 100 KB/s  : ${binaryCapped.wire.receivedBytesPerSecond <= 100 * 1024 ? 'MET' : 'MISSED'} (default 64 KB/s budget)`);
  console.log(`JSON report: ${JSON.stringify({ legacy, binaryUncapped, binaryCapped })}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
