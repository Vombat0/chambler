# Chambler — Decision Log

Project-wide decisions. Append-only: to change a decision, add a new entry
that supersedes the old one; do not rewrite history.

## D1 — Web platform: Three.js + Rapier + Colyseus (2026-10-28)

The simulator runs in the browser; no native client. Rendering is Three.js,
physics is `@dimforge/rapier3d-compat`, networking is Colyseus over
WebSocket. Rationale: zero-install multiplayer, one codebase, mature
ecosystems.

## D2 — Hybrid view: 3D table + 2D inspect (2026-10-28)

The primary view is the shared 3D table. Inspecting an object (card, board,
tile) opens a 2D overlay rendered from the same state. Rationale: reading
card text in 3D is poor UX; a 2D panel is cheap, accessible and testable.

## D3 — Ownership-based network model (2026-10-28)

Exactly one client simulates an object at any instant (`ObjectDef.ownerId`).
The server holds authoritative state on a reliable channel; late joiners get
a full snapshot. Claim/release messages always win over per-frame
transforms. Rationale: determinism without server-side physics.

## D4 — Transform sync: 20 Hz + binary codec, 40 B per update (2026-10-28)

Transform updates are sent unreliably at `TRANSFORM_RATE_HZ = 20` in a fixed
40-byte binary packet, not JSON. Rationale: packet loss is tolerated by
design; binary encoding keeps bandwidth flat as object count grows.

## D5 — Asset policy: CC0 only, no branded content (2026-10-28)

All assets must be CC0-1.0 (Kenney etc.); branded or trademarked content is
banned from the repo and from generated scenes. `assets/manifest.json`
records source, license and checksum per asset. Files over 5 MB are never
committed without Git LFS; manifests and license files are always tracked
(enforced in `.gitignore`).

## D6 — Verify after commit (2026-10-28)

Every task commits first, then runs `pnpm -r build`, `pnpm lint` and
`pnpm -r test`, and pastes the output in its report. A verification failure
after commit is reported, not silently fixed, unless fixing is in scope.

## D7 — Model isolation (2026-10-28)

The orchestrator's underlying model is never assigned to any subagent — no
variant, no provider alias, no inheritance. Subagents always receive an
explicit provider/model ID.

## D8 — Quota transfer rule (2026-10-28)

When a provider hits a quota limit, its pending work is reassigned to
eligible models on other providers (respecting D7) instead of waiting for
recovery. Outages and cooldowns are recorded in
`.orchestrator/performance/credits.json`.

## D9 — Server-wins reconciliation, secrets never at rest (2026-10-29)

Table persistence (B4) stores one JSON snapshot per room code with atomic
writes (tmp → fsync → rename) and quarantines corrupt files instead of
deleting them; unsupported schema versions are left for future servers.
Face-down card faces are never written to disk — the sanitizer strips
identity and face-mapping keys before every save and a leak guard fails the
save. On reconnect the server is authoritative: the client applies
`tableResync` (rebuild + interpolation reset, no jump) and replays its
offline intent queue only where it does not conflict with the resynced
table (dropped object, re-owned object, duplicate spawn → dropped).
