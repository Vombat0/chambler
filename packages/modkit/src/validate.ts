import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { z } from 'zod';
import { packError, type PackError } from './errors.js';
import { DEFAULT_PACK_LIMITS, type PackLimits } from './limits.js';
import { checkAssetExtension, checkRelativePath, normalizeRelativePath } from './paths.js';
import { gamePackManifestSchema, type GamePackManifest } from './schema.js';

/** Result of {@link validatePack}. */
export type ValidateResult =
  | { ok: true; manifest: GamePackManifest }
  | { ok: false; errors: PackError[] };

interface WalkEntry {
  rel: string;
  abs: string;
}

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', '.orchestrator', 'coverage']);

/** Recursively list all files under `dir` (relative + absolute), skipping excluded dirs. */
async function walkFiles(dir: string, root: string): Promise<{ files: WalkEntry[]; symlinkRels: string[] }> {
  const files: WalkEntry[] = [];
  const symlinkRels: string[] = [];
  const dirEntries = await readdir(dir, { withFileTypes: true });
  for (const entry of dirEntries) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      const nested = await walkFiles(abs, root);
      files.push(...nested.files);
      symlinkRels.push(...nested.symlinkRels);
      continue;
    }
    if (entry.isSymbolicLink()) {
      symlinkRels.push(rel);
      continue;
    }
    files.push({ rel, abs });
  }
  return { files, symlinkRels };
}

/** Map a zod issue to a stable PackError code. */
function issueToError(issue: z.ZodIssue): PackError {
  const field = issue.path.length > 0 ? issue.path.join('.') : undefined;
  switch (issue.code) {
    case 'unrecognized_keys':
      return packError('UNKNOWN_FIELD', issue.message, { field });
    case 'invalid_type':
      // `undefined` received means a REQUIRED field is missing.
      if ('received' in issue && issue.received === 'undefined') {
        return packError('REQUIRED', `Missing required field: ${field ?? '(root)'}`, { field });
      }
      return packError('TYPE', issue.message, { field });
    case 'invalid_enum_value': {
      const isKind = field !== undefined && field.endsWith('kind');
      return packError(
        isKind ? 'OBJECT_KIND_UNKNOWN' : 'SCHEMA',
        issue.message,
        { field },
      );
    }
    default: {
      const params = issue as { params?: { code?: string } };
      const code = typeof params?.params?.code === 'string' ? params.params.code : 'SCHEMA';
      return packError(code, issue.message, { field });
    }
  }
}

async function loadImageSafe(path: string): Promise<{ json: string } | { error: PackError }> {
  const info = await lstat(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return 'missing' as const;
    throw err;
  });
  if (info === 'missing') {
    return { error: packError('MANIFEST_MISSING', 'manifest.json not found in pack directory', { path: 'manifest.json' }) };
  }
  if (info.isSymbolicLink()) {
    return { error: packError('SYMLINK_FORBIDDEN', 'manifest.json must not be a symbolic link', { path: 'manifest.json' }) };
  }
  if (info.size > DEFAULT_PACK_LIMITS.maxManifestBytes) {
    return { error: packError('MANIFEST_TOO_LARGE', `manifest.json exceeds ${DEFAULT_PACK_LIMITS.maxManifestBytes} bytes`, { path: 'manifest.json' }) };
  }
  try {
    return { json: await readFile(path, 'utf8') };
  } catch (err) {
    return { error: packError('MANIFEST_READ_ERROR', `Could not read manifest.json: ${(err as Error).message}`, { path: 'manifest.json' }) };
  }
}

/** Parse manifest.json into JSON, reporting stable errors on failure. */
function parseManifest(json: string): { data: unknown } | { error: PackError } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return { error: packError('MANIFEST_PARSE', `manifest.json is not valid JSON: ${(err as Error).message}`, { path: 'manifest.json' }) };
  }
  return { data };
}

/**
 * Validate a game pack directory.
 *
 * `manifest.json` must exist at `<dir>/manifest.json`. The manifest is:
 * 1. schema-validated (strict, unknown fields rejected),
 * 2. checked against filesystem rules (existence, symlinks, sizes, counts).
 */
export async function validatePack(
  dir: string,
  limits: PackLimits = DEFAULT_PACK_LIMITS,
): Promise<ValidateResult> {
  const errors: PackError[] = [];

  const rootStat = await stat(dir).catch(() => null);
  if (!rootStat?.isDirectory()) {
    return {
      ok: false,
      errors: [packError('PACK_DIR_NOT_FOUND', `Pack directory not found: ${dir}`)],
    };
  }

  const realRoot = await realpath(dir);

  // --- manifest.json ---
  const manifestAbs = join(dir, 'manifest.json');
  const loaded = await loadImageSafe(manifestAbs);
  if ('error' in loaded) return { ok: false, errors: [loaded.error] };

  const parsed = parseManifest(loaded.json);
  if ('error' in parsed) return { ok: false, errors: [parsed.error] };

  // --- schema ---
  const schemaResult = gamePackManifestSchema.safeParse(parsed.data);
  if (!schemaResult.success) {
    return {
      ok: false,
      errors: schemaResult.error.issues.map(issueToError),
    };
  }
  const manifest = schemaResult.data;

  // --- assets: path structure, extension, existence, symlink, size ---
  const seenTarget = new Map<string, string>();

  for (const [logical, rawPath] of Object.entries(manifest.assets)) {
    const structural = checkRelativePath(rawPath);
    if (structural) {
      errors.push(packError(structural, `asset "${logical}": ${rawPath}`, { field: `assets.${logical}`, path: rawPath }));
      continue;
    }
    const rel = normalizeRelativePath(rawPath);
    if (rel === 'manifest.json') {
      errors.push(packError('PATH_INVALID', 'manifest.json is reserved and cannot be an asset file', { field: `assets.${logical}`, path: rel }));
      continue;
    }
    const extErr = checkAssetExtension(rel);
    if (extErr) {
      errors.push(packError(extErr, `asset "${logical}" has a disallowed extension (allowed: ${'.glb, .gltf, .png, .jpg, .webp, .json, .mp3, .ogg'})`, { field: `assets.${logical}`, path: rel }));
      continue;
    }
    const abs = join(dir, ...rel.split('/'));

    // packId / root-escape protection: resolved path must stay inside the pack
    const real = await realpath(abs).catch(() => null);
    if (real !== null && !isWithinRoot(realRoot, real)) {
      errors.push(packError('PATH_ESCAPE', `asset "${logical}" resolves outside the pack directory (${rel})`, { field: `assets.${logical}`, path: rel }));
      continue;
    }

    const info = await lstat(abs).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null;
      if (err.code === 'ELOOP') return 'symlink';
      throw err;
    });
    if (info === 'symlink') {
      errors.push(packError('SYMLINK_FORBIDDEN', `asset "${logical}" must not be a symbolic link`, { field: `assets.${logical}`, path: rel }));
      continue;
    }
    if (info === null) {
      errors.push(packError('ASSET_MISSING', `asset "${logical}": file does not exist`, { field: `assets.${logical}`, path: rel }));
      continue;
    }
    if (info.size > limits.maxFileBytes) {
      errors.push(packError('FILE_TOO_LARGE', `asset "${logical}" is ${info.size} bytes (limit ${limits.maxFileBytes})`, { field: `assets.${logical}`, path: rel }));
      continue;
    }

    if (real !== null) {
      const previous = seenTarget.get(real);
      if (previous !== undefined) {
        errors.push(packError('ASSET_DUPLICATE_PATH', `assets "${previous}" and "${logical}" point to the same file`, { field: `assets.${logical}`, path: rel }));
        continue;
      }
      seenTarget.set(real, logical);
    }
  }
  const knownNames = new Set(Object.keys(manifest.assets));
  for (const component of manifest.components) {
    if (!knownNames.has(component.assetRef)) {
      errors.push(packError('ASSET_REF_UNKNOWN', `component "${component.id}" references undeclared asset "${component.assetRef}"`, { field: `components.${manifest.components.indexOf(component)}.assetRef` }));
    }
  }
  manifest.decks?.forEach((deck, i) => {
    for (const face of deck.faces) {
      if (!knownNames.has(face)) {
        errors.push(packError('ASSET_REF_UNKNOWN', `deck "${deck.id}" face references undeclared asset "${face}"`, { field: `decks.${i}.faces` }));
      }
    }
    if (deck.backAssetRef !== undefined && !knownNames.has(deck.backAssetRef)) {
      errors.push(packError('ASSET_REF_UNKNOWN', `deck "${deck.id}" back references undeclared asset "${deck.backAssetRef}"`, { field: `decks.${i}.backAssetRef` }));
    }
  });

  // --- id uniqueness across components / decks / helpers ---
  const idSeen = new Map<string, string>();
  for (const component of manifest.components) {
    const previous = idSeen.get(component.id);
    if (previous !== undefined) {
      errors.push(packError('ID_DUPLICATE', `id "${component.id}" used twice (${previous} and components)`, { field: 'components' }));
    } else idSeen.set(component.id, 'components');
  }
  manifest.decks?.forEach((deck, i) => {
    const previous = idSeen.get(deck.id);
    if (previous !== undefined) {
      errors.push(packError('ID_DUPLICATE', `id "${deck.id}" used twice (${previous} and decks)`, { field: `decks.${i}.id` }));
    } else idSeen.set(deck.id, 'decks');
  });

  // --- pack-wide limits: file count, total size, per-file size, symlinks ---
  const walk = await walkFiles(dir, dir).catch(() => ({ files: [], symlinkRels: [] }));
  for (const rel of walk.symlinkRels) {
    errors.push(packError('SYMLINK_FORBIDDEN', 'symbolic links are forbidden inside packs', { path: rel }));
  }
  if (walk.files.length > limits.maxFiles) {
    errors.push(packError('FILE_COUNT_EXCEEDED', `pack contains ${walk.files.length} files (limit ${limits.maxFiles})`));
  }
  let total = 0;
  for (const file of walk.files) {
    const info = await stat(file.abs).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    if (!info) continue;
    total += info.size;
    if (info.size > limits.maxFileBytes) {
      errors.push(packError('FILE_TOO_LARGE', `${file.rel} is ${info.size} bytes (limit ${limits.maxFileBytes})`, { path: file.rel }));
    }
  }
  if (total > limits.maxTotalBytes) {
    errors.push(packError('PACK_SIZE_EXCEEDED', `pack total size ${total} bytes (limit ${limits.maxTotalBytes})`));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest };
}

/** True when `child` is inside (or equal to) `root` — used for root-escape check. */
function isWithinRoot(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
