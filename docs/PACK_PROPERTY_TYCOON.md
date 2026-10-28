# Pack: Mülk Tycoon (`packs/property-tycoon`)

First real game pack: a 40-cell economic board game. Validate with
`node packages/modkit/dist/cli.js packs/property-tycoon` (→ `OK`); test with
`cd packs/property-tycoon && node ../../packages/modkit/node_modules/vitest/vitest.mjs run`.

## Originality

**Shared with the genre (mechanics only):** roll-and-move loop, buy/decline with
auction, rent tiers by colour group, houses/hotels with an even-build rule, mortgage,
jail, chance/community decks, bankruptcy, last-player-standing.
**Original here:** the name _Mülk Tycoon_, every place name (Kiremit Sokak, Zeytin
Bahçesi, Limanlar, Misafirhane, Karantina, Serbest Pazar…), all 32 card titles and
texts, the currency (Chambler Birimi, ₡), the 8-group palette and all artwork, which
is generated from code. `test/content.test.ts › originality` fails the build if a
trademarked name, card text or visual appears.

## Board (40 cells, 11 per side, corners shared)

| Type | Cells | Notes |
|---|---|---|
| start | 1 | index 0, salary 200 |
| property | 22 | 8 groups: 2×2 + 6×3 members, prices 60–400, 7-step rent table |
| transport (Liman) | 4 | indices 5/15/25/35, rent by owned count 25→200 |
| energy (Enerji) | 2 | indices 12/28, rent = dice × 4 or × 10 |
| tax | 2 | 200 (Belediye Harcı), 100 (Lüks Vergisi) |
| chance / community | 3 + 3 | Fırsat 16 cards, Topluluk 16 cards |
| jail / free-parking / go-to-jail | 1 + 1 + 1 | Misafirhane 10, Serbest Pazar 20, Karantina 30 |

Rent rows are `[base, full-group, 1h, 2h, 3h, 4h, hotel]`, strictly increasing;
rules live in `rules/rules.json` (start 1500, salary 200, jail 50/3 turns, mortgage
50 % + 10 % interest, even build, auction on decline, last standing).

## Generated art (70 files, ~2.4 MiB, `scripts/generate-art.ts`)

34 PNG (manifest-listed) + 36 SVG sources (`assets/svg/`) + `art-index.json` with a
sha256 per file: `board.png`, 8 × `property-card-<group>.png`, 10 × `tile-<type>.png`,
2 × `card-back-*.png`, 6 × `money-{1,5,10,50,100,500}.png`, 6 × `token-<colour>.png`,
`die-d6.png`, plus `cell-labels-{tr,en}.svg` layers (40 labels each). Rasters come from
a built-in PNG writer (zlib only): every PNG > 1 KiB, every SVG valid XML.

## Known gaps

- Schema v1 has no `rules`/`cells` field: cell data and rules are JSON assets
  (`board-layout`, `rules`) and `helpers` is declaration-only; a future schemaVersion
  should promote both to first-class fields.
- The asset whitelist has no `.svg`, so SVGs are design sources beside the PNGs.
- Not yet a `pnpm-workspace` member (root workspace file owned by another task);
  `package.json` declares `vitest`/`tsx`, so adding `packs/*` makes `pnpm -r test`
  pick the pack up unchanged. No 3D `.glb` models either: the renderer uses the PNGs.
