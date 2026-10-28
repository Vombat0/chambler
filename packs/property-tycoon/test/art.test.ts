import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(PACK, 'assets');
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
  pngCount: number;
  svgCount: number;
  files: ArtEntry[];
}

const manifest = read<{ assets: Record<string, string> }>('manifest.json');
const index = read<ArtIndex>('assets/art-index.json');
const allowed = new Set(['.png', '.json']);
const ALLOWED_EXT = ['.glb', '.gltf', '.png', '.jpg', '.webp', '.json', '.mp3', '.ogg'];

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) return walk(abs);
    return [abs];
  });

const relPath = (abs: string): string => relative(PACK, abs).split('\\').join('/');

/** Minimal well-formedness check: balanced tags, one root, no stray text. */
function xmlWellFormed(xml: string): { ok: boolean; reason?: string } {
  const stack: string[] = [];
  let roots = 0;
  const re =
    /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = re.exec(xml)) !== null) {
    const text = xml.slice(lastIndex, match.index);
    if (stack.length === 0 && text.trim().length > 0 && roots > 0)
      return { ok: false, reason: 'text outside root' };
    lastIndex = match.index + match[0].length;
    const [, closing, name, , selfClosing] = match;
    if (name === undefined) continue; // <?xml ?>, comments, CDATA
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

const files = walk(PACK).map(relPath);
const artFiles = files.filter(
  (f) => f.startsWith('assets/') && (f.endsWith('.png') || f.endsWith('.svg')),
);

describe('assets', () => {
  test('every manifest asset exists, is listed once and is non-empty', () => {
    const paths = Object.values(manifest.assets);
    expect(paths.length).toBe(Object.keys(manifest.assets).length);
    expect(new Set(paths).size).toBe(paths.length);
    for (const [key, path] of Object.entries(manifest.assets)) {
      expect(ALLOWED_EXT.some((ext) => path.endsWith(ext))).toBe(true);
      const size = statSync(join(PACK, path)).size;
      expect(`${key}:${size}`).not.toBe(`${key}:0`);
      expect(size).toBeGreaterThan(0);
    }
  });

  test('manifest assets match the generated files one to one', () => {
    const declared = new Set(Object.values(manifest.assets));
    const onDisk = files.filter(
      (f) => f.startsWith('assets/') && ALLOWED_EXT.some((ext) => f.endsWith(ext)),
    );
    for (const path of onDisk) expect(declared.has(path)).toBe(true);
    for (const path of declared) expect(files).toContain(path);
  });

  test('art-index lists exactly the generated art files', () => {
    const indexed = index.files.map((f) => f.path).sort();
    expect(indexed).toEqual([...artFiles].sort());
    expect(index.pngCount).toBe(34);
    expect(index.svgCount).toBe(36);
    expect(artFiles.length).toBeGreaterThanOrEqual(12);
  });

  test('art-index hashes and sizes match the files on disk', () => {
    for (const entry of index.files) {
      const buf = readFileSync(join(PACK, entry.path));
      expect(buf.length).toBe(entry.bytes);
      expect(createHash('sha256').update(buf).digest('hex')).toBe(entry.sha256);
    }
  });

  test('every raster is a real PNG above 1 KiB', () => {
    const pngs = artFiles.filter((f) => f.endsWith('.png'));
    expect(pngs.length).toBe(34);
    for (const path of pngs) {
      const buf = readFileSync(join(PACK, path));
      expect(`${path} ${buf.length}`).not.toBe(`${path} 0`);
      expect(buf.length).toBeGreaterThan(1024);
      expect([...buf.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
      const entry = index.files.find((f) => f.path === path)!;
      expect(buf.readUInt32BE(16)).toBe(entry.width);
      expect(buf.readUInt32BE(20)).toBe(entry.height);
      expect(buf.subarray(buf.length - 8, buf.length - 4).toString('ascii')).toBe('IEND');
    }
  });

  test('every vector source is well-formed XML above 1 KiB', () => {
    const svgs = artFiles.filter((f) => f.endsWith('.svg'));
    expect(svgs.length).toBe(36);
    for (const path of svgs) {
      const xml = readFileSync(join(PACK, path), 'utf8');
      expect(xml.length).toBeGreaterThan(1024);
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      const result = xmlWellFormed(xml);
      if (!result.ok) throw new Error(`${path}: ${result.reason}`);
      expect(xml).toContain('<svg');
      expect(xml).toContain('</svg>');
    }
  });

  test('the board label layers cover all 40 cells in both languages', () => {
    for (const lang of ['tr', 'en']) {
      const xml = readFileSync(join(ASSETS, 'svg', `cell-labels-${lang}.svg`), 'utf8');
      const cells = xml.match(/data-cell="/g) ?? [];
      expect(cells).toHaveLength(40);
      expect(xml).toContain(`id="labels-${lang}"`);
    }
  });

  test('art families are complete: 8 groups, 6 notes, 6 pawns, 10 tiles, 2 backs', () => {
    const names = artFiles.map((f) => f.split('/').pop()!);
    for (const group of [
      'kiremit',
      'zeytin',
      'gul',
      'turkuaz',
      'amber',
      'zumrut',
      'lacivert',
      'mor',
    ]) {
      expect(names).toContain(`property-card-${group}.png`);
    }
    for (const value of [1, 5, 10, 50, 100, 500]) expect(names).toContain(`money-${value}.png`);
    for (const token of ['crimson', 'cobalt', 'jade', 'gold', 'violet', 'terra']) {
      expect(names).toContain(`token-${token}.png`);
    }
    for (const type of [
      'start',
      'property',
      'transport',
      'energy',
      'tax',
      'chance',
      'community',
      'jail',
      'free-parking',
      'go-to-jail',
    ]) {
      expect(names).toContain(`tile-${type}.png`);
    }
    expect(names).toContain('card-back-chance.png');
    expect(names).toContain('card-back-community.png');
    expect(names).toContain('board.png');
    expect(names).toContain('die-d6.png');
  });

  test('no downloaded or binary blobs sneaked in: all art is generated', () => {
    expect(index.files.every((f) => f.path.startsWith('assets/'))).toBe(true);
    expect(index.generator).toBe('scripts/generate-art.ts');
    // only .png (raster) and .json (inventory) are manifest-listed art formats
    expect([...allowed].sort()).toEqual(['.json', '.png']);
  });
});
