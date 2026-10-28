# Chambler Mod Format (schemaVersion 1)

A **game pack** is a directory containing `manifest.json` plus asset files.
Validate any pack with: `pnpm --filter modkit cli <packDir>` (exit 0 = valid).

## Fields (`manifest.json`)

| Field | Type | Rules |
|---|---|---|
| `schemaVersion` | int | must be `1` |
| `packId` | string | kebab-case `[a-z0-9-]`, 3–64 chars, unique namespace |
| `name` | string | 1–128 chars |
| `description` | string | 1–2000 chars |
| `version` | string | strict semver `MAJOR.MINOR.PATCH` |
| `author` | string | 1–128 chars |
| `license` | string | SPDX id recommended (`MIT`, `CC-BY-4.0`) |
| `minEngineVersion` | string | strict semver |
| `players` | {min,max} | ints ≥ 1, `max ≥ min` |
| `tags` | string[] | optional, unique, ≤ 32 |
| `assets` | map | logical name → relative path (see security) |
| `components` | array | `id`, `kind` (ObjectKind: die/pawn/token/tile/board/card/deck/custom), `assetRef` (logical name in `assets`), `count` (default 1), `defaultMeta` |
| `board` | object | optional: `grid{cols,rows}`, `cellSize{width,depth}`, `snapPoints[{id,position[x,y,z],rotation?}]` |
| `decks` | array | optional: `id`, `faces[]` + optional `backAssetRef` (logical names), `shuffle: auto\|manual` |
| `helpers` | array | optional, declaration only: `type: dice\|money\|score\|turn` (implemented later by the engine) |
| `localization` | map | lang id (`en`, `tr`, `en-US`) → key → text |

## Security rules (enforced by `validatePack`)

- Asset paths must be **relative**, forward-slash only; `..`, absolute paths
  (`/…`, `C:\`, `file://`, `~`) and backslashes are rejected.
- Symlinks inside the pack are rejected (resolved paths must stay in the pack dir).
- Extension whitelist: `.glb .gltf .png .jpg .webp .json .mp3 .ogg`.
- Limits: 200 MB total, 2000 files, 50 MB per file, manifest.json ≤ 1 MB.
- `manifest.json` cannot itself be listed as an asset.
- Strict schema: unknown fields are rejected at every level.

## Error codes (subset)

`MANIFEST_MISSING` `MANIFEST_PARSE` `SCHEMA_VERSION_UNSUPPORTED` `UNKNOWN_FIELD`
`REQUIRED` `TYPE` `PACK_ID_FORMAT` `PACK_ID_LENGTH` `SEMVER_FORMAT`
`OBJECT_KIND_UNKNOWN` `PLAYERS_RANGE` `PATH_ABSOLUTE` `PATH_TRAVERSAL`
`ASSET_EXT_NOT_ALLOWED` `ASSET_MISSING` `ASSET_REF_UNKNOWN`
`ASSET_DUPLICATE_PATH` `SYMLINK_FORBIDDEN` `FILE_TOO_LARGE`
`PACK_SIZE_EXCEEDED` `FILE_COUNT_EXCEEDED`

`validatePack(dir)` returns `{ ok: true, manifest }` or
`{ ok: false, errors: PackError[] }` where each error has `code`, `message`
and optional `field` (manifest path) / `path` (file).

## Example fragments

Components (kind must be a valid ObjectKind):

```json
"components": [{ "id": "die-d6", "kind": "die", "assetRef": "die-d6", "count": 2 }]
```

Deck with card faces:

```json
"decks": [{ "id": "fortune", "faces": ["card-a", "card-b"], "backAssetRef": "card-back", "shuffle": "auto" }]
```

Helper declaration (no behavior in this schema version):

```json
"helpers": [{ "type": "dice", "config": { "sides": 6 } }]
```

## Versioning policy

- `schemaVersion` is the **pack format** version, not the game version.
- Adding optional fields = minor bump; every consumer must ignore nothing — the
  validator rejects unknown fields, so a new schemaVersion is *required* for any
  schema change.
- Validators accept exactly the versions they know; when the engine supports a
  new schemaVersion, the validator is updated first, packs are revalidated, and
  only then the engine ships support.
- `packId` is immutable once uploaded: it names the pack's storage namespace.
- `version` and `minEngineVersion` are strict semver; engine refuses packs with
  `version > 0.x` until formats stabilize per release channel.
