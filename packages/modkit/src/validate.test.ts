import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test } from 'vitest';
import { validatePack } from './validate.js';

import { manifestBody } from './schema.test.js';

let packRoot = '';

const FAKE_ASSET = JSON.stringify({ fake: 'mesh' });

beforeEach(async () => {
  packRoot = await mkdtemp(join(tmpdir(), 'modkit-test-'));
  await mkdir(join(packRoot, 'assets'), { recursive: true });
  await writeFile(join(packRoot, 'assets', 'die-d6.json'), FAKE_ASSET);
  await writeFile(join(packRoot, 'manifest.json'), JSON.stringify(manifestBody()));
});

const codes = (errors: { code: string }[]) => errors.map((e) => e.code);

describe('validatePack — happy paths', () => {
  test('bundled example pack (examples/minimal) validates as ok', async () => {
    const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'minimal');
    const result = await validatePack(exampleDir);
    expect(result.ok).toBe(true);
  });

  test('tmp dir with manifest + asset file validates as ok', async () => {
    const result = await validatePack(packRoot);
    expect(result.ok).toBe(true);
  });
});

describe('validatePack — manifest problems', () => {
  test('missing manifest.json → MANIFEST_MISSING', async () => {
    await rm(join(packRoot, 'manifest.json'));
    const result = await validatePack(packRoot);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codes(result.errors)).toContain('MANIFEST_MISSING');
  });

  test('broken JSON → MANIFEST_PARSE', async () => {
    await writeFile(join(packRoot, 'manifest.json'), '{ not json ]');
    const result = await validatePack(packRoot);
    if (!result.ok) expect(codes(result.errors)).toContain('MANIFEST_PARSE');
  });

  test('schema errors come back with field paths', async () => {
    await writeFile(join(packRoot, 'manifest.json'), JSON.stringify(manifestBody({ players: { min: 5, max: 1 } })));
    const result = await validatePack(packRoot);
    if (!result.ok) {
      expect(result.errors[0]?.field).toBe('players');
    }
  });
});

describe('validatePack — path security', () => {
  test('traversal path `../secret.png` → PATH_TRAVERSAL + ASSET_EXT? (traversal wins)', async () => {
    await writeFile(join(packRoot, 'manifest.json'), JSON.stringify(manifestBody({ assets: { 's-1': '../secret.png' } })));
    const result = await validatePack(packRoot);
    if (!result.ok) expect(codes(result.errors)).toContain('PATH_TRAVERSAL');
  });

  test('absolute path `/etc/passwd` → PATH_ABSOLUTE', async () => {
    await writeFile(join(packRoot, 'manifest.json'), JSON.stringify(manifestBody({ assets: { 's-1': '/etc/passwd' } })));
    const result = await validatePack(packRoot);
    if (!result.ok) expect(codes(result.errors)).toContain('PATH_ABSOLUTE');
  });

  test('disallowed extension `.exe` → ASSET_EXT_NOT_ALLOWED', async () => {
    await writeFile(join(packRoot, 'manifest.json'), JSON.stringify(manifestBody({ assets: { 's-1': 'assets/run.exe' } })));
    const result = await validatePack(packRoot);
    if (!result.ok) expect(codes(result.errors)).toContain('ASSET_EXT_NOT_ALLOWED');
  });

  test('missing asset file → ASSET_MISSING', async () => {
    await writeFile(join(packRoot, 'manifest.json'), JSON.stringify(manifestBody({ assets: { 'ghost-1': 'assets/ghost.png' } })));
    const result = await validatePack(packRoot);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === 'ASSET_MISSING');
      expect(err?.path).toBe('assets/ghost.png');
    }
  });

  test('asset a symlink → SYMLINK_FORBIDDEN', async () => {
    await writeFile(join(packRoot, 'assets', 'target.png'), FAKE_ASSET);
    await writeFile(join(packRoot, 'manifest.json'), JSON.stringify(manifestBody({ assets: { 'link-1': 'assets/link.png' } })));
    await symlink(join(packRoot, 'assets', 'target.png'), join(packRoot, 'assets', 'link.png'));
    const result = await validatePack(packRoot);
    if (!result.ok) expect(codes(result.errors)).toContain('SYMLINK_FORBIDDEN');
  });

  test('asset referencing undeclared logical name → ASSET_REF_UNKNOWN', async () => {
    await writeFile(join(packRoot, 'manifest.json'), JSON.stringify(manifestBody({ components: [{ id: 'c-1', kind: 'die', assetRef: 'nope' }] })));
    const result = await validatePack(packRoot);
    if (!result.ok) expect(codes(result.errors)).toContain('ASSET_REF_UNKNOWN');
  });

  test('two logical names pointing to the same file → ASSET_DUPLICATE_PATH', async () => {
    await writeFile(
      join(packRoot, 'manifest.json'),
      JSON.stringify(manifestBody({ assets: { 'a-1': 'assets/./die-d6.json', 'a-2': 'assets/die-d6.json' } })),
    );
    const result = await validatePack(packRoot);
    if (!result.ok) expect(codes(result.errors)).toContain('ASSET_DUPLICATE_PATH');
  });
});

describe('validatePack — limits', () => {
  test('single file larger than maxFileBytes → FILE_TOO_LARGE (sparse file)', async () => {
    await writeFile(join(packRoot, 'manifest.json'), JSON.stringify(manifestBody({ assets: { 'big-1': 'assets/big.png' } })));
    const fh = await openForTruncate(join(packRoot, 'assets', 'big.png'));
    await fh.truncate(51 * 1024 * 1024 + 1); // sparse: no real 51MB written
    await fh.close();
    const result = await validatePack(packRoot);
    if (!result.ok) expect(codes(result.errors)).toContain('FILE_TOO_LARGE');
  });

  test('total pack size above maxTotalBytes → PACK_SIZE_EXCEEDED (with tiny custom limit)', async () => {
    const result = await validatePack(packRoot, { maxTotalBytes: 4, maxFiles: 2000, maxFileBytes: 50e6, maxManifestBytes: 1e6 });
    if (!result.ok) expect(codes(result.errors)).toContain('PACK_SIZE_EXCEEDED');
  });

  test('more files than maxFiles → FILE_COUNT_EXCEEDED (with tiny custom limit)', async () => {
    // pack has manifest.json + 1 asset = 2 files; limit 1
    const result = await validatePack(packRoot, { maxTotalBytes: 200e6, maxFiles: 1, maxFileBytes: 50e6, maxManifestBytes: 1e6 });
    if (!result.ok) expect(codes(result.errors)).toContain('FILE_COUNT_EXCEEDED');
  });
});

async function openForTruncate(path: string): Promise<import('node:fs/promises').FileHandle> {
  const { mkdir, open } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
  return open(path, 'w');
}
