# Persistence & Reconnection (B4)

Tables survive server restarts, and players survive connection drops.

## Snapshots

- One JSON save per room code at `SNAPSHOT_DIR` (default `.chambler/`,
  git-ignored): `<CODE>.json`, schema version 1 (`@chambler/shared`).
- Writes are atomic: `.tmp` file → `fsync` → `rename`. A corrupt save is
  quarantined as `<CODE>.json.corrupt` and reported as `SNAPSHOT_NOT_FOUND`.
  An unsupported schema version is left in place and rejected with
  `SNAPSHOT_VERSION_UNSUPPORTED`.
- Limits: 4 MB per save (`SNAPSHOT_MAX_BYTES`), 50 saves total
  (`MAX_SAVES`, oldest `savedAt` pruned first).
- Autosave: debounced 5 s (`SNAPSHOT_DEBOUNCE_MS`) with a 10 s max interval
  (`SNAPSHOT_MAX_INTERVAL_MS`); a forced save happens on room dispose.
- Secret rule: face-down card faces are NEVER written to disk. The
  sanitizer drops identity keys (`cardId`, `hiddenCard`, `secret`) and face
  mappings from face-down cards, and face mappings from decks (deck order
  `cardIds` survives). `snapshotSecretLeak()` runs before every save as a
  second guard, and a leak fails the save.

## HTTP API

| Endpoint | Meaning |
| --- | --- |
| `POST /api/rooms/:code/save?sessionId=` | Force a save now (host only) |
| `GET /api/rooms/:code/save` | Live snapshot, else the disk save |
| `GET /api/saves` | Saved tables, newest first |
| `POST /api/rooms/:code/reopen` | Restore a saved table (409 if live) |

## Reconnection

- Window: 30 s (`RECONNECTION_SECONDS`). A dropped player keeps seat, color
  and object ownership; ownership is only released (and broadcast) when the
  window expires.
- Client chain: `reconnect(token)` → `joinById(code)` → `POST reopen` →
  join. Statuses: `connected`, `reconnecting`, `offline` (gave up),
  `resyncing` (socket back, awaiting table).
- Every join/reconnect receives `tableResync` (full object list with
  last-known transforms); the client applies it authoritatively, resets
  interpolation buffers (no position jump), removes local-only objects and
  refreshes transforms.
- Offline local changes (spawn/claim/release/flip/dieResult) are queued
  (max 256) and replayed after the resync with server-wins conflict rules;
  transforms are never queued. Player identity returns by name (seat/color
  memory, capped at 64).

Client surface: `NetworkClient.saveRoom/listSaves/getRoomSnapshot/
openFromSnapshot/onResync`.
