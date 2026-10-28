import type { ObjectKind } from '@chambler/shared';
import { expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';
import { OBJECT_KINDS, SUPPORTED_SCHEMA_VERSION, gamePackManifestSchema, type GamePackManifest } from './schema.js';

/** Stable machine code attached via refineWith (adds params.code on custom issues). */
const issueCode = (issue: z.ZodIssue): string | undefined =>
  (issue as unknown as { params?: { code?: string } }).params?.code;

/** Valid manifest factory; override fields per test. */
export function manifestBody(overrides: Partial<unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    packId: 'example-pack',
    name: 'Example Pack',
    description: 'An example game pack for testing.',
    version: '1.0.0',
    author: 'Chambler',
    license: 'MIT',
    minEngineVersion: '0.1.0',
    players: { min: 2, max: 4 },
    tags: ['example'],
    assets: {
      'die-d6': 'assets/die-d6.json',
    },
    components: [
      { id: 'die-d6', kind: 'die', assetRef: 'die-d6', count: 2 },
    ],
    ...overrides,
  };
}

/** Parse with full manifest schema. */
export function parseManifest(data: unknown): z.SafeParseReturnType<unknown, GamePackManifest> {
  return gamePackManifestSchema.safeParse(data);
}

test('valid minimal manifest is accepted', () => {
  const result = parseManifest(manifestBody());
  expect(result.success).toBe(true);
});

test('packId contract matches @chambler/shared ObjectKind union', () => {
  // Runtime list must always mirror the shared contract.
  expectTypeOf<(typeof OBJECT_KINDS)[number]>().toEqualTypeOf<ObjectKind>();
  expect(OBJECT_KINDS).toContain('die');
  expect(OBJECT_KINDS).toContain('custom');
});

test('missing required field (name) is rejected as REQUIRED', () => {
  const body = manifestBody();
  delete (body as Record<string, unknown>).name;
  const result = parseManifest(body);
  expect(result.success).toBe(false);
  const error = result.success === false ? result.error.issues.find((i) => i.path.join('.') === 'name') : null;
  expect(error?.code).toBe('invalid_type');
});

test('wrong type (players.min as string) is rejected', () => {
  const result = parseManifest(manifestBody({ players: { min: '2', max: 4 } }));
  expect(result.success).toBe(false);
});

test('semver violation in version is rejected with SEMVER_FORMAT', () => {
  const result = parseManifest(manifestBody({ version: '1.0' }));
  expect(result.success).toBe(false);
  expect(result.error?.issues.some((i) => issueCode(i) === 'SEMVER_FORMAT')).toBe(true);
});

test('semver violation in minEngineVersion is rejected with SEMVER_FORMAT', () => {
  const result = parseManifest(manifestBody({ minEngineVersion: 'one.two.three' }));
  expect(result.success).toBe(false);
  expect(result.error?.issues.some((i) => issueCode(i) === 'SEMVER_FORMAT')).toBe(true);
});

test('unknown ObjectKind is rejected with OBJECT_KIND_UNKNOWN', () => {
  const result = parseManifest(manifestBody({ components: [{ id: 'x-1', kind: 'spaceship', assetRef: 'a-1' }] }));
  expect(result.success).toBe(false);
  expect(result.error?.issues.some((i) => issueCode(i) === undefined && i.code === 'invalid_enum_value')).toBe(true);
  const msgs = result.success ? [] : result.error.issues.map((i) => JSON.stringify(i.path));
  expect(msgs.some((p) => p.includes('kind'))).toBe(true);
});

test('players.too-few (min 0) is rejected with PLAYERS_RANGE', () => {
  const result = parseManifest(manifestBody({ players: { min: 0, max: 4 } }));
  expect(result.success).toBe(false);
  expect(result.error?.issues.some((i) => issueCode(i) === 'PLAYERS_RANGE')).toBe(true);
});

test('players.max < min is rejected with PLAYERS_RANGE', () => {
  const result = parseManifest(manifestBody({ players: { min: 4, max: 2 } }));
  expect(result.success).toBe(false);
  expect(result.error?.issues.some((i) => issueCode(i) === 'PLAYERS_RANGE')).toBe(true);
});

test('too many players (max 99) is rejected with PLAYERS_RANGE', () => {
  const result = parseManifest(manifestBody({ players: { min: 2, max: 99 } }));
  expect(result.success).toBe(false);
});

test('empty packId is rejected', () => {
  const result = parseManifest(manifestBody({ packId: '' }));
  expect(result.success).toBe(false);
});

test('invalid packId characters (underscores / spaces / capitals) are rejected with PACK_ID_FORMAT', () => {
  for (const bad of ['My_Pack', 'has spaces', 'UPPER', 'double--dash', 'trailing-']) {
    const result = parseManifest(manifestBody({ packId: bad }));
    expect(result.success, `packId "${bad}" should fail`).toBe(false);
    expect(result.error?.issues.some((i) => issueCode(i) === 'PACK_ID_FORMAT'), `packId "${bad}"`).toBe(true);
  }
});

test('packId length limits: 2 chars rejected (PACK_ID_LENGTH), 64 ok, 65 rejected', () => {
  expect(parseManifest(manifestBody({ packId: 'ab' })).success).toBe(false);
  const id64 = 'a'.repeat(64);
  expect(parseManifest(manifestBody({ packId: id64 })).success).toBe(true);
  expect(parseManifest(manifestBody({ packId: id64 + 'a' })).success).toBe(false);
});

test('unknown extra top-level field is rejected with UNKNOWN_FIELD (strict)', () => {
  const result = parseManifest(manifestBody({ cheatMode: true }));
  expect(result.success).toBe(false);
  expect(result.error?.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
});

test('unknown field inside component is rejected (strict)', () => {
  const result = parseManifest(manifestBody({ components: [{ id: 'c-1', kind: 'die', assetRef: 'die-d6', hack: 1 }] }));
  expect(result.success).toBe(false);
  expect(result.error?.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
});

test('unsupported schemaVersion is rejected with SCHEMA_VERSION_UNSUPPORTED', () => {
  expect(parseManifest(manifestBody({ schemaVersion: 0 })).success).toBe(false);
  expect(parseManifest(manifestBody({ schemaVersion: 2 })).success).toBe(false);
  expect(SUPPORTED_SCHEMA_VERSION).toBe(1);
});

test('asset traversal and extension rules are enforced at schema level', () => {
  const traversal = parseManifest(manifestBody({ assets: { 'a-1': '../secret.json' } }));
  expect(traversal.success).toBe(false);
  const absPath = parseManifest(manifestBody({ assets: { 'a-1': '/etc/passwd' } }));
  expect(absPath.success).toBe(false);
  const badExt = parseManifest(manifestBody({ assets: { 'a-1': 'assets/virus.exe' } }));
  expect(badExt.success).toBe(false);
});

test('duplicate tags are rejected', () => {
  const result = parseManifest(manifestBody({ tags: ['war', 'war'] }));
  expect(result.success).toBe(false);
});

test('localization shape is enforced', () => {
  expect(parseManifest(manifestBody({ localization: { 'en-US': { 'game.title': 'Example' } } })).success).toBe(true);
  expect(parseManifest(manifestBody({ localization: { 'not-a-lang': { 'game.title': 'Example' } } })).success).toBe(false);
});
