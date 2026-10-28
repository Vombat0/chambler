/**
 * Art tests: every asset must be generated (no downloads), indexed, intact
 * and big enough to be real artwork (every file > 1 KiB, at least 20 files).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = <T>(rel: string): T => JSON.parse(readFileSync(join(PACK, rel), 'utf8')) as T;

interface ArtEntry {
  key: string;
  path: string;
  kind: 'png' | 'svg';
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}
interface ArtIndex {
  generator: string;
  pngCount: number;
  svgCount: number;
  files: ArtEntry[];
}

const manifest = read<{ assets: Record<string, string> }>('manifest.json');
const index = read<ArtIndex>('assets/art-index.json');
const tiles = read<{ types: { id: string }[] }>('tiles/tiles.json').types;
const workers = read<{ roles: { id: string }[]; colors: { id: string }[] }>('tokens/workers.json');
const ALLOWED_EXT = ['.glb', '.gltf', '.png', '.jpg', '.webp', '.json', '.mp3', '.ogg'];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) return walk(abs);
    return [abs];
  });

const relPath = (abs: string): string => relative(PACK, abs).split('\\').join('/');
const files = walk(PACK).map(relPath);
const artFiles = files.filter((f) => f.startsWith('assets/') && (f.endsWith('.png') || f.endsWith('.svg')));

/** Minimal well-formedness check: balanced tags, one root. */
function xmlWellFormed(xml: string): { ok: boolean; reason?: string } {
  const stack: string[] = [];
  let roots = 0;
  const re =
    /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = re.exec(xml)) !== null) {
    const text = xml.slice(lastIndex, match.index);
    if (stack.length === 0 && text.trim().length > 0 && roots > 0) return { ok: false, reason: 'text outside root' };
    lastIndex = match.index + match[0].length;
    const [, closing, name, , selfClosing] = match;
    if (name === undefined) continue;
    if (closing === '/') {
      const open = stack.pop();
      if (open !== name) return { ok: false, reason: `mismatched </${name}> (open: ${open})` };
      continue;
    }
    if (stack.length === 0) roots += 1;
    if (selfClosing === '/') continue;
    stack.push(name);
  }
  if (stack.length > 0) return { ok: false, reason: `unclosed <${stack[stack.length - 1]}>` };
  if (roots !== 1) return { ok: false, reason: `expected exactly one root, found ${roots}` };
  return { ok: true };
}

describe('assets', () => {
  test('the art set is large: at least 20 generated files, every one above 1 KiB', () => {
    expect(artFiles.length).toBeGreaterThanOrEqual(20);
    for (const path of artFiles) {
      const size = readFileSync(join(PACK, path)).length;
      expect(size, path).toBeGreaterThan(1024);
    }
  });

  test('art-index lists exactly the generated files, with matching counts', () => {
    const indexed = index.files.map((f) => f.path).sort();
    expect(indexed).toEqual([...artFiles].sort());
    expect(index.pngCount).toBe(index.files.filter((f) => f.kind === 'png').length);
    expect(index.svgCount).toBe(index.files.filter((f) => f.kind === 'svg').length);
    expect(index.generator).toBe('scripts/generate-art.ts');
  });

  test('art-index hashes and sizes match the files on disk', () => {
    for (const entry of index.files) {
      const buf = readFileSync(join(PACK, entry.path));
      expect(buf.length, entry.path).toBe(entry.bytes);
      expect(createHash('sha256').update(buf).digest('hex'), entry.path).toBe(entry.sha256);
    }
  });

  test('every raster is a real PNG with the indexed dimensions', () => {
    const pngs = artFiles.filter((f) => f.endsWith('.png'));
    expect(pngs.length).toBeGreaterThanOrEqual(20);
    for (const path of pngs) {
      const buf = readFileSync(join(PACK, path));
      expect([...buf.subarray(0, 8)], path).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
      const entry = index.files.find((f) => f.path === path)!;
      expect(buf.readUInt32BE(16), path).toBe(entry.width);
      expect(buf.readUInt32BE(20), path).toBe(entry.height);
      expect(buf.subarray(buf.length - 8, buf.length - 4).toString('ascii')).toBe('IEND');
    }
  });

  test('every vector source is well-formed XML', () => {
    const svgs = artFiles.filter((f) => f.endsWith('.svg'));
    expect(svgs.length).toBeGreaterThanOrEqual(20);
    for (const path of svgs) {
      const xml = readFileSync(join(PACK, path), 'utf8');
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), path).toBe(true);
      const result = xmlWellFormed(xml);
      if (!result.ok) throw new Error(`${path}: ${result.reason}`);
      expect(xml).toContain('<svg');
      expect(xml).toContain('</svg>');
    }
  });

  test('families are complete: 24 tiles, 5 workers, 4 roles, back, marker, mat', () => {
    const names = artFiles.map((f) => f.split('/').pop()!);
    for (const t of tiles) {
      expect(names).toContain(`tile-${t.id}.png`);
      expect(names).toContain(`tile-${t.id}.svg`);
    }
    for (const color of workers.colors) expect(names).toContain(`worker-${color.id}.png`);
    for (const role of workers.roles) expect(names).toContain(`role-${role.id}.png`);
    expect(names).toContain('tile-back.png');
    expect(names).toContain('start-marker.png');
    expect(names).toContain('playmat.png');
    expect(names).toContain('playmat.svg');
  });

  test('manifest assets match the png/json files on disk one to one', () => {
    const declared = new Set(Object.values(manifest.assets));
    const onDisk = files.filter((f) => f.startsWith('assets/') && ALLOWED_EXT.some((ext) => f.endsWith(ext)));
    for (const path of onDisk) expect(declared.has(path), path).toBe(true);
    for (const path of declared) expect(files).toContain(path);
  });
});
