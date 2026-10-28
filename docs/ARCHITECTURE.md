# Chambler — Architecture (A1 skeleton)

Browser-based tabletop simulator: Risk / Carcassonne / Monopoly style games are added
later as **content packages**; the engine stays game-agnostic.
pnpm workspaces + TypeScript (strict).

## Package structure

```
packages/
  shared/   @chambler/shared — types + protocol; ZERO runtime deps
  client/   @chambler/client — Vite + React + Three.js + @dimforge/rapier3d-compat
  server/   @chambler/server — Node + Colyseus (+ plain /health over HTTP)
```

`client` and `server` always import `@chambler/shared`; shared itself may not gain
runtime dependencies (types and constants only).

## Network model — two channels

1. **State channel (reliable, persistent):** join, leave, objectSpawn, objectRemove,
   objectClaim/Release/Lock, flip, deckShuffle, chat. The server holds full state;
   a client that joins late receives the full snapshot.
2. **Transform channel (unreliable, 20 Hz = `TRANSFORM_RATE_HZ`):** transformUpdate
   `{ id, transform, velocity? }`. Packet loss is tolerated; the later state-channel
   message (objectClaim / objectSpawn) always wins over transforms.

## Ownership-based physics

At any instant exactly one client (ObjectDef.ownerId) simulates an object's physics.
That client publishes transforms on the transform channel at 20 Hz; other clients
interpret it. The server is lightweight — it only validates and re-publishes.
Handover is through objectClaim / objectRelease on the state channel (claimToken
prevents an expired owner's stale transforms from being applied). Details: A2/B1.

## Secret hand rule

`HandInfo { ownerId, cardIds }` — `cardIds` is sent **only to the owner's session**;
the server filters per-session before sending, and it is never broadcast.
Face-up data of a face-down card (`assetRef`/meta back-mapping) is filtered the same way.

## Module ownership

| Task | Owner | Scope |
|---|---|---|
| A1 | this repo | monorepo, shared contract, dev tooling |
| A2 | client | scene, camera, physics (Rapier) |
| A3 | client | object management (spawn/claim, client side) |
| A4 | client | card/deck UX + secret hand (client side) |
| A5 | client | snap/placement helpers |
| A6 | client | inspect panel |
| B1 | server | Colyseus rooms + validation |
| B2 | server | transform channel + 20 Hz backbone |
| B3 | server | secret-hand filtering (server side) |
| B4 | server | lobby/persistence |
| C1 | shared | content package format |
| C2 | shared | helpers (snap, deck utils, id utils) |
| D1 | client | UI (chat, lobby, menu) |

## Rules

- BEFORE changing `packages/shared` types: **note it in ARCHITECTURE.md** and check the
  contract impact on downstream tasks (A2–A6, B1–B4, D1).
- No runtime dependency may be added to shared; helpers use standard WebCrypto/JS.
- Transform messages are unreliable; never bind game logic to transform arrival.
- Physics authority per object belongs to exactly one client (ownership conflict = bug).

## B2 shared contract additions
- `PlayerInfo.isHost` added (B1 schema already had it).
- State channel gains `seat`, `color`, `error`, `hand` messages.
- Network types: `ObjectSnapshot`, `OwnershipState`, `TransformFrame`.
- Hand-written validators in `packages/shared/src/validators.ts` (zero deps).
