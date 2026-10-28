/**
 * Browser entry for bundlers: pure schema + rules + errors + limits only.
 *
 * The default entry (`.`) re-exports `validate.ts`, which needs `node:fs` —
 * browsers have no filesystem, so client packs load `manifest.json` over HTTP
 * and validate it with `gamePackManifestSchema` plus the logical checks here.
 */
export * from './errors.js';
export * from './limits.js';
export * from './rules.js';
export * from './schema.js';
