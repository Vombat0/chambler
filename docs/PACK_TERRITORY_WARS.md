# Pack: Territory Wars (`packs/territory-wars`)

Second game pack: an area-conquest strategy game on the invented world of
Aetheris. Validate: `node packages/modkit/dist/cli.js packs/territory-wars` (→ `OK`);
test: `cd packs/territory-wars && node ../../packages/modkit/node_modules/vitest/vitest.mjs run`.

## Originality

**Shared with the genre (mechanics only):** region claiming, regions/3 (min 3)
reinforcement, continent bonuses, 3-vs-2 conflict dice with descending pairing and
defender-wins-ties, territory-card trades, elimination to last standing.
**Original here:** the name _Territory Wars_, the world of Aetheris, all 5 continent
and 28 region names (Drakemoor Uçları, Mistral Basin, Ember Adaları…), all card
texts, the legion-writ subsystem (Spearwatch / Stormwing / Ironbull) and every
pixel, which is generated from code. `test/content.test.ts › originality` fails
the build if a classic map's brands, continents or region names appear.

## Map (`board/board.json`) — 28 regions, 5 continents

Drakemoor 5/+5, Koros 8/+7 (2 fortresses), Virelai 4/+3, Sundar 6/+4,
Emberisle 5/+3 (dotted sea links). Adjacency is hand-authored and test-enforced:
symmetric (A↔B), one connected component, each continent internally connected,
degrees 2–4, anchors ≥ 120 px apart. Fortress regions (Mistral Basin, Sundergate,
Glassholt) grant +1 to the defender's first die. Region polygons are a
deterministic Voronoi partition of the anchors.

## Rules as data (`rules/rules.json`)

Start armies 38→18 by player count (2–6); reinforce max(3, floor(regions/3)) plus
continent bonuses and capital +2; attack with ≤ 3 dice (2+ armies), defend with
≤ 2; dice sort descending, pair largest-to-largest, each pair costs the loser one
army, ties go to the defender; conquest pushes ≥ committed dice; trades start at
3 banners with rising tiers (4, 6, 8, 11, 14, 18, 22); losing the last region
eliminates and hands banners to the conqueror.

## Generated art (57 files, ~1.7 MiB, `scripts/generate-art.ts`)

24 PNG (manifest-listed) + 33 SVG (`assets/svg/`) + `art-index.json` with sha256:
`map.png`, `map-regions.svg` (polygons + neighbor metadata), `adjacency.svg`,
5 continent layers, `region-labels-{tr,en}.svg`, 6 dice faces, 3 legion writs +
unit markers, 2 card backs, banner card, joker, 6 pawns, army disc. Rasters come
from a built-in PNG writer (zlib only); every file > 1 KiB.

## Known gaps

- Schema v1 has no adjacency/rules field: both ship as JSON assets; snap points
  carry region anchors scaled to 16×9.
- No `.svg` in the asset whitelist; SVGs are engine-ready sources beside PNGs.
- Not yet a pnpm workspace member (workspace file owned elsewhere); scripts in
  `package.json` are ready for `packs/*` inclusion.
