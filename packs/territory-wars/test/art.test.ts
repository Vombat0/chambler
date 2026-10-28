/**
 * Art tests: everything under assets/ must be generated, indexed, intact and
 * big enough to be real artwork (every file > 1 KiB). No downloads are allowed.
 */
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
  generator: string;
  pngCount: number;
  svgCount: number;
  files: ArtEntry[];
}

const manifest = read<{ assets: Record<string, string> }>('manifest.json');
const index = read<ArtIndex>('assets/art-index.json');
const board = read<{ regions: { id: string; neighbors: string[] }[] }>('board/board.json');
const continents = read<{ continents: { id: string }[] }>('board/continents.json').continents;
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
    expect(new Set(paths).size).toBe(paths.length);
    for (const [key, path] of Object.entries(manifest.assets)) {
      expect(ALLOWED_EXT.some((ext) => path.endsWith(ext))).toBe(true);
      const size = statSync(join(PACK, path)).size;
      expect(size, key).toBeGreaterThan(0);
    }
  });

  test('manifest assets match the files on disk one to one', () => {
    const declared = new Set(Object.values(manifest.assets));
    const onDisk = files.filter(
      (f) => f.startsWith('assets/') && ALLOWED_EXT.some((ext) => f.endsWith(ext)),
    );
    for (const path of onDisk) expect(declared.has(path)).toBe(true);
    for (const path of declared) expect(files).toContain(path);
  });

  test('art-index lists exactly the generated art files (at least 15)', () => {
    const indexed = index.files.map((f) => f.path).sort();
    expect(indexed).toEqual([...artFiles].sort());
    expect(artFiles.length).toBeGreaterThanOrEqual(15);
    expect(index.pngCount).toBe(index.files.filter((f) => f.kind === 'png').length);
    expect(index.svgCount).toBe(index.files.filter((f) => f.kind === 'svg').length);
  });

  test('art-index hashes and sizes match the files on disk', () => {
    for (const entry of index.files) {
      const buf = readFileSync(join(PACK, entry.path));
      expect(buf.length, entry.path).toBe(entry.bytes);
      expect(createHash('sha256').update(buf).digest('hex')).toBe(entry.sha256);
    }
  });

  test('every raster is a real PNG above 1 KiB with the indexed dimensions', () => {
    const pngs = artFiles.filter((f) => f.endsWith('.png'));
    expect(pngs.length).toBeGreaterThanOrEqual(14);
    for (const path of pngs) {
      const buf = readFileSync(join(PACK, path));
      expect(buf.length, path).toBeGreaterThan(1024);
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
    expect(svgs.length).toBeGreaterThanOrEqual(15);
    for (const path of svgs) {
      const xml = readFileSync(join(PACK, path), 'utf8');
      expect(xml.length, path).toBeGreaterThan(1024);
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      const result = xmlWellFormed(xml);
      if (!result.ok) throw new Error(`${path}: ${result.reason}`);
      expect(xml).toContain('<svg');
      expect(xml).toContain('</svg>');
    }
  });

  test('art families are complete: map, 5 continent layers, 6 dice, 3 legions, 6 pawns', () => {
    const names = artFiles.map((f) => f.split('/').pop()!);
    expect(names).toContain('map.png');
    expect(names).toContain('map.svg');
    expect(names).toContain('map-regions.svg');
    expect(names).toContain('adjacency.svg');
    for (const continent of continents) expect(names).toContain(`continent-${continent.id}.svg`);
    for (const face of [1, 2, 3, 4, 5, 6]) expect(names).toContain(`dice-${face}.png`);
    for (const legion of ['spearwatch', 'stormwing', 'ironbull']) {
      expect(names).toContain(`legion-${legion}.png`);
      expect(names).toContain(`unit-${legion}.png`);
    }
    for (const token of [
      'token-scarlet',
      'token-indigo',
      'token-jade',
      'token-umber',
      'token-silver',
      'token-amber',
    ])
      expect(names).toContain(`${token}.png`);
    expect(names).toContain('army-disc.png');
    expect(names).toContain('territory-card.png');
    expect(names).toContain('joker-banner.png');
    expect(names).toContain('card-back-territory.png');
    expect(names).toContain('card-back-legions.png');
    expect(names).toContain('region-labels-tr.svg');
    expect(names).toContain('region-labels-en.svg');
  });

  test('the vector map carries every region, neighbour list and label', () => {
    const regionsSvg = readFileSync(join(ASSETS, 'svg', 'map-regions.svg'), 'utf8');
    for (const region of board.regions) {
      expect(regionsSvg.includes(`data-region="${region.id}"`)).toBe(true);
      expect(regionsSvg.includes(`data-neighbors="${region.neighbors.join(' ')}"`)).toBe(true);
    }
    const edges = board.regions.reduce((sum, r) => sum + r.neighbors.length, 0) / 2;
    const adjacency = readFileSync(join(ASSETS, 'svg', 'adjacency.svg'), 'utf8');
    expect((adjacency.match(/data-from="/g) ?? []).length).toBe(edges);
    for (const lang of ['tr', 'en']) {
      const labels = readFileSync(join(ASSETS, 'svg', `region-labels-${lang}.svg`), 'utf8');
      expect((labels.match(/data-region="/g) ?? []).length).toBe(board.regions.length);
      expect(labels).toContain(`id="labels-${lang}"`);
    }
  });

  test('no downloaded blobs: the index points at the generator script only', () => {
    expect(index.generator).toBe('scripts/generate-art.ts');
    expect(index.files.every((f) => f.path.startsWith('assets/'))).toBe(true);
  });
});
