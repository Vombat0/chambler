import type { ObjectKind } from '@chambler/shared';
import { z } from 'zod';
import { ASSET_EXTENSIONS, checkAssetExtension, checkRelativePath } from './rules.js';

export { ASSET_EXTENSIONS };

export type { ObjectKind };

/** Runtime mirror of `ObjectKind` from @chambler/shared (contract-checked in tests). */
export const OBJECT_KINDS = ['die', 'pawn', 'token', 'tile', 'board', 'card', 'deck', 'custom'] as const;

/** Current schema version this validator accepts. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** packId: kebab-case, 3-64 characters. */
export const PACK_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Shared id pattern for components / decks / snap points / localization keys. */
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Logical asset name (the keys of `assets`). */
const ASSET_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Language code in localization, e.g. `en`, `tr`, `en-US`. */
const LANG_RE = /^[a-z]{2}(?:-[A-Za-z]{2})?$/;

/** Strict semver: MAJOR.MINOR.PATCH with optional prerelease/build. */
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Attach a stable machine-readable code to a predicate check. */
const refineWith = <T extends z.ZodTypeAny>(
  schema: T,
  predicate: (value: z.output<T>) => boolean,
  code: string,
  message: string,
): z.ZodEffects<T> =>
  schema.superRefine((value, ctx) => {
    if (!predicate(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, params: { code } });
    }
  });

const semverField = () =>
  refineWith(
    z.string(),
    (v) => SEMVER_RE.test(v),
    'SEMVER_FORMAT',
    'Must be semantic version MAJOR.MINOR.PATCH',
  );

const packIdField = () =>
  refineWith(
    refineWith(
      z.string(),
      (v) => v.length >= 3 && v.length <= 64,
      'PACK_ID_LENGTH',
      'packId must be 3-64 characters',
    ),
    (v) => PACK_ID_RE.test(v),
    'PACK_ID_FORMAT',
    'packId must be lowercase kebab-case: [a-z0-9] groups separated by single hyphens',
  );

const objectKindField = () => z.enum(OBJECT_KINDS);

const assetRefField = () =>
  refineWith(
    z.string(),
    (v) => ASSET_NAME_RE.test(v),
    'ASSET_REF_FORMAT',
    'assetRef must be a logical asset name declared in `assets`',
  );

const componentSchema = z
  .object({
    id: refineWith(
      z.string(),
      (v) => ID_RE.test(v),
      'ID_FORMAT',
      'component id must be [a-z0-9][a-z0-9._-]{0,63}',
    ),
    kind: objectKindField(),
    assetRef: assetRefField(),
    count: z.number().int().min(1).max(100000).default(1),
    defaultMeta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const deckSchema = z
  .object({
    id: refineWith(
      z.string(),
      (v) => ID_RE.test(v),
      'ID_FORMAT',
      'deck id must be [a-z0-9][a-z0-9._-]{0,63}',
    ),
    /** Logical asset names (faces announcement); engine consumes them later. */
    faces: z
      .array(
        refineWith(
          z.string(),
          (v) => ASSET_NAME_RE.test(v),
          'ASSET_REF_FORMAT',
          'each face must be a logical asset name',
        ),
      )
      .min(1)
      .max(2048),
    backAssetRef: refineWith(
      z.string(),
      (v) => ASSET_NAME_RE.test(v),
      'ASSET_REF_FORMAT',
      'backAssetRef must be a logical asset name',
    ).optional(),
    shuffle: z.enum(['auto', 'manual']).default('auto'),
  })
  .strict();

const vec3Tuple = z.tuple([z.number(), z.number(), z.number()]);

const boardSchema = z
  .object({
    grid: z
      .object({ cols: z.number().int().min(1).max(512), rows: z.number().int().min(1).max(512) })
      .strict()
      .optional(),
    cellSize: z
      .object({ width: z.number().positive(), depth: z.number().positive() })
      .strict()
      .optional(),
    snapPoints: z
      .array(
        z
          .object({
            id: refineWith(
              z.string(),
              (v) => ID_RE.test(v),
              'ID_FORMAT',
              'snap point id must be [a-z0-9][a-z0-9._-]{0,63}',
            ),
            position: vec3Tuple,
            rotation: vec3Tuple.optional(),
          })
          .strict(),
      )
      .max(4096)
      .default([]),
  })
  .strict();

const helperSchema = z
  .object({
    /** Declaration only — engine implementation comes later. */
    type: z.enum(['dice', 'money', 'score', 'turn']),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const localizationSchema = z.record(
  z.string().regex(LANG_RE, {
    message: 'language key must be ISO 639-1, optionally with region (e.g. "en", "tr", "en-US")',
  }),
  z.record(
    refineWith(
      z.string(),
      (v) => v.length > 0 && v.length <= 128 && v.split('.').every((part) => /^[A-Za-z0-9_-]+$/.test(part)),
      'LOC_KEY_FORMAT',
      'localization keys are dot-separated [A-Za-z0-9_-] segments (e.g. "game.title")',
    ),
    z.string().min(1),
  ),
);

/**
 * Full manifest schema. STRICT: unknown fields are rejected everywhere.
 * Filesystem-level rules (existence, symlinks, size) live in `validatePack`.
 */
export const gamePackManifestSchema = z
  .object({
    schemaVersion: refineWith(
      z.number().int(),
      (v) => v === SUPPORTED_SCHEMA_VERSION,
      'SCHEMA_VERSION_UNSUPPORTED',
      `schemaVersion must be ${SUPPORTED_SCHEMA_VERSION} (this validator supports only that version)`,
    ),
    packId: packIdField(),
    name: z.string().min(1).max(128),
    description: z.string().min(1).max(2000),
    version: semverField(),
    author: z.string().min(1).max(128),
    license: z.string().min(1).max(64),
    minEngineVersion: semverField(),
    players: refineWith(
      z
        .object({
          min: refineWith(z.number().int().max(64), (v) => v >= 1, 'PLAYERS_RANGE', 'players.min must be an integer >= 1 (max 64)'),
          max: refineWith(z.number().int().max(64), (v) => v >= 1, 'PLAYERS_RANGE', 'players.max must be an integer >= 1 (max 64)'),
        })
        .strict(),
      (v) => v.max >= v.min,
      'PLAYERS_RANGE',
      'players.min must be at least 1 and players.max must be >= players.min (both capped at 64)',
    ),
    tags: refineWith(
      z.array(z.string().min(1).max(32)).max(32),
      (tags) => new Set(tags).size === tags.length,
      'TAGS_DUPLICATE',
      'tags must not contain duplicates',
    ).optional(),
    /** Logical asset name -> relative file path. Extension whitelist is enforced here. */
    assets: z.record(
      refineWith(
        z.string(),
        (v) => ASSET_NAME_RE.test(v),
        'ASSET_NAME_FORMAT',
        'asset logical name must be [a-z0-9][a-z0-9._-]{0,63}',
      ),
      refineWith(
        refineWith(
          refineWith(z.string().max(4096), (v) => checkRelativePath(v) !== 'PATH_ABSOLUTE', 'PATH_ABSOLUTE', 'asset path must be relative (no `/...`, `C:`, `file://` or `~`)'),
          (v) => checkRelativePath(v) !== 'PATH_TRAVERSAL',
          'PATH_TRAVERSAL',
          'asset path must not contain `..` segments',
        ),
        (v) => checkAssetExtension(v) === null,
        'ASSET_EXT_NOT_ALLOWED',
        `asset extension must be one of: ${ASSET_EXTENSIONS.join(' ')}`,
      ),
    ),
    components: z.array(componentSchema).min(1).max(4096),
    board: boardSchema.optional(),
    decks: z.array(deckSchema).max(256).optional(),
    helpers: z.array(helperSchema).max(64).optional(),
    localization: localizationSchema.optional(),
  })
  .strict();

export type GamePackManifest = z.infer<typeof gamePackManifestSchema>;
export type GamePackComponent = z.infer<typeof componentSchema>;
export type GamePackDeck = z.infer<typeof deckSchema>;
export type GamePackBoard = z.infer<typeof boardSchema>;
export type GamePackHelper = z.infer<typeof helperSchema>;
