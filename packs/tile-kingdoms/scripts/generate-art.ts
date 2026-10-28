#!/usr/bin/env tsx
/**
 * Generates every visual asset of the tile-kingdoms pack from code.
 * NO downloads, NO image dependencies: tiles, workers and the table mat are
 * drawn from primitives on a tiny CPU canvas; vector twins are emitted as SVG
 * text and rasters encoded by a built-in PNG writer (zlib only).
 *
 * The artwork is original: "Tile Kingdoms / Kare Krallıklar" is an invented
 * theme; no third-party names, logos or tile illustrations are reproduced.
 *
 * Run:  ../../packages/modkit/node_modules/.bin/tsx scripts/generate-art.ts
 * Out:  assets/*.png (manifest assets) + assets/svg/*.svg (vector sources)
 *       + assets/art-index.json (inventory with sha256 + size)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, '..');
const OUT = join(PACK, 'assets');
const SVG_OUT = join(OUT, 'svg');

/* ------------------------------------------------------------------ colours */
type RGB = readonly [number, number, number];
type Pt = readonly [number, number];
const hex = (value: string): RGB => {
  const h = value.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const shade = (c: RGB, t: number): RGB => mix(c, [0, 0, 0], t);
const tint = (c: RGB, t: number): RGB => mix(c, [255, 255, 255], t);
const css = (c: RGB): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const INK = hex('#2B2620');
const CREAM = hex('#F5EEDC');
const GOLD = hex('#C9A227');
const MEADOW = hex('#6F9A58');
const STONE = hex('#D8CDAD');
const STONE_DARK = hex('#8A7F5C');
const ROAD = hex('#C7A76B');
const ROAD_DARK = hex('#8A6B3F');
const SHRINE = hex('#7E5FA3');
const SHRINE_DARK = hex('#4A3563');
const ROOF = hex('#9A3B3B');
const PARCHMENT = hex('#EFE6D2');

/* ------------------------------------------------------------------- canvas */
class Canvas {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  private blend(x: number, y: number, c: RGB, a: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    const src = Math.min(1, a);
    d[i] = (d[i] ?? 0) + (c[0] - (d[i] ?? 0)) * src;
    d[i + 1] = (d[i + 1] ?? 0) + (c[1] - (d[i + 1] ?? 0)) * src;
    d[i + 2] = (d[i + 2] ?? 0) + (c[2] - (d[i + 2] ?? 0)) * src;
    d[i + 3] = Math.min(255, (d[i + 3] ?? 0) + 255 * src);
  }

  fill(c: RGB): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.blend(x, y, c, 1);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): this {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) this.blend(px, py, c, a);
    return this;
  }

  frame(x: number, y: number, w: number, h: number, c: RGB, t = 2, a = 1): this {
    this.rect(x, y, w, t, c, a);
    this.rect(x, y + h - t, w, t, c, a);
    this.rect(x, y, t, h, c, a);
    this.rect(x + w - t, y, t, h, c, a);
    return this;
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB, a = 1): this {
    const rad = Math.min(r, w / 2, h / 2);
    this.rect(x + rad, y, w - rad * 2, h, c, a);
    this.rect(x, y + rad, rad, h - rad * 2, c, a);
    this.rect(x + w - rad, y + rad, rad, h - rad * 2, c, a);
    for (let i = 0; i < rad; i++) {
      const dy = rad - i - 0.5;
      const dx = Math.sqrt(Math.max(0, rad * rad - dy * dy));
      this.rect(x + rad - dx, y + i, dx, 1, c, a);
      this.rect(x + w - rad, y + i, dx, 1, c, a);
      this.rect(x + rad - dx, y + h - i - 1, dx, 1, c, a);
      this.rect(x + w - rad, y + h - i - 1, dx, 1, c, a);
    }
    return this;
  }

  circle(cx: number, cy: number, r: number, c: RGB, a = 1): this {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.blend(x, y, c, a);
      }
    }
    return this;
  }

  ring(cx: number, cy: number, r: number, t: number, c: RGB, a = 1): this {
    const outer = r * r;
    const inner = (r - t) * (r - t);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = dx * dx + dy * dy;
        if (d <= outer && d >= inner) this.blend(x, y, c, a);
      }
    }
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, t: number, c: RGB, a = 1): this {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2) + 1;
    for (let i = 0; i <= steps; i++) {
      const t0 = i / steps;
      this.circle(x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0, t / 2, c, a);
    }
    return this;
  }

  polygon(points: readonly Pt[], c: RGB, a = 1): this {
    const ys = points.map((p) => p[1]);
    const y0 = Math.floor(Math.min(...ys));
    const y1 = Math.ceil(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const p = points[i]!;
        const q = points[(i + 1) % points.length]!;
        if ((p[1] <= sy && q[1] > sy) || (q[1] <= sy && p[1] > sy)) {
          xs.push(p[0] + ((sy - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
        }
      }
      xs.sort((m, n) => m - n);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        for (let x = Math.round(xs[i]!); x < Math.round(xs[i + 1]!); x++) this.blend(x, y, c, a);
      }
    }
    return this;
  }

  /** Deterministic paper grain: texture, and keeps flat rasters comfortably >1 KiB. */
  grain(seed: number, strength = 5): this {
    let state = (seed >>> 0) || 1;
    const next = (): number => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0xffffffff;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        if ((this.data[i + 3] ?? 0) === 0) continue;
        const delta = (next() - 0.5) * strength * 2;
        this.data[i] = Math.max(0, Math.min(255, (this.data[i] ?? 0) + delta));
        this.data[i + 1] = Math.max(0, Math.min(255, (this.data[i + 1] ?? 0) + delta));
        this.data[i + 2] = Math.max(0, Math.min(255, (this.data[i + 2] ?? 0) + delta * 0.8));
      }
    }
    return this;
  }
}

/* ---------------------------------------------------------------- PNG writer */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};

function encodePng(canvas: Canvas): Buffer {
  const { w, h, data } = canvas;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * stride + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------- content */
type EdgeValue = 'city' | 'road' | 'field' | 'shrine';
interface TileType {
  id: string;
  count: number;
  centre: 'city' | 'road' | 'field' | 'shrine' | 'none';
  edges: { north: EdgeValue; east: EdgeValue; south: EdgeValue; west: EdgeValue };
  special?: 'start';
  pennants?: number;
  fortress?: boolean;
}
interface WorkersFile {
  roles: { id: string; feature: string; assetKey: string }[];
  colors: { id: string; color: string }[];
}

const tiles = JSON.parse(readFileSync(join(PACK, 'tiles/tiles.json'), 'utf8')) as { types: TileType[] };
const workers = JSON.parse(readFileSync(join(PACK, 'tokens/workers.json'), 'utf8')) as WorkersFile;
const tr = JSON.parse(readFileSync(join(PACK, 'i18n/tr.json'), 'utf8')) as Record<string, string>;

const seedOf = (key: string): number => [...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/* ---------------------------------------------------------------- svg helpers */
const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const svgDoc = (w: number, h: number, title: string, body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
  <title id="t">${esc(title)}</title>
  <desc id="d">Procedurally generated by packs/tile-kingdoms/scripts/generate-art.ts. Tile Kingdoms (Kare Kralliklar) is an original theme for a tile-laying worker-placement game; every feature here is drawn from geometric primitives. Original artwork, MIT licensed with the pack. No third-party images, fonts or trademarks are embedded.</desc>
  <metadata>{"generator":"scripts/generate-art.ts","pack":"tile-kingdoms","theme":"tile-kingdoms","license":"MIT","width":${w},"height":${h},"origin":"procedural"}</metadata>
${body}
</svg>
`;

const FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';
const polyPts = (pts: readonly Pt[]): string => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

/* ------------------------------------------------------------------ tiles */
const TILE = 176;
const MID = TILE / 2;
const BAND_W: Record<Exclude<EdgeValue, 'field'>, number> = { city: 32, road: 15, shrine: 20 };

/** Band rectangle from the tile edge to the centre for a direction, width w. */
const bandRect = (dir: 'north' | 'east' | 'south' | 'west', w: number) => {
  const half = w / 2;
  switch (dir) {
    case 'north':
      return { x: MID - half, y: 0, w, h: MID };
    case 'south':
      return { x: MID - half, y: MID, w, h: MID };
    case 'west':
      return { x: 0, y: MID - half, w: MID, h: w };
    case 'east':
      return { x: MID, y: MID - half, w: MID, h: w };
  }
};

const EDGE_ORDER = ['north', 'east', 'south', 'west'] as const;

function drawBandPng(c: Canvas, dir: (typeof EDGE_ORDER)[number], value: EdgeValue): void {
  if (value === 'field') return;
  const r = bandRect(dir, BAND_W[value]);
  const vertical = dir === 'north' || dir === 'south';
  if (value === 'city') {
    c.rect(r.x, r.y, r.w, r.h, STONE);
    // side kerbs + merlons so walls read as walls
    if (vertical) {
      c.rect(r.x, r.y, 4, r.h, STONE_DARK);
      c.rect(r.x + r.w - 4, r.y, 4, r.h, STONE_DARK);
      for (let y = 6; y < r.h; y += 22) {
        c.rect(r.x + 6, y, r.w - 12, 5, tint(STONE, 0.35), 0.9);
        c.rect(r.x + 6, y + 6, r.w - 12, 2, shade(STONE, 0.18), 0.7);
      }
    } else {
      c.rect(r.x, r.y, r.w, 4, STONE_DARK);
      c.rect(r.x, r.y + r.h - 4, r.w, 4, STONE_DARK);
      for (let x = 6; x < r.w; x += 22) {
        c.rect(x, r.y + 6, 5, r.h - 12, tint(STONE, 0.35), 0.9);
        c.rect(x + 6, r.y + 6, 2, r.h - 12, shade(STONE, 0.18), 0.7);
      }
    }
  } else if (value === 'road') {
    c.rect(r.x, r.y, r.w, r.h, ROAD);
    if (vertical) {
      c.rect(r.x, r.y, 3, r.h, ROAD_DARK);
      c.rect(r.x + r.w - 3, r.y, 3, r.h, ROAD_DARK);
      for (let y = 8; y < r.h; y += 24) c.rect(r.x + r.w / 2 - 2, y, 4, 10, tint(ROAD, 0.6), 0.85);
    } else {
      c.rect(r.x, r.y, r.w, 3, ROAD_DARK);
      c.rect(r.x, r.y + r.h - 3, r.w, 3, ROAD_DARK);
      for (let x = 8; x < r.w; x += 24) c.rect(x, r.y + r.h / 2 - 2, 10, 4, tint(ROAD, 0.6), 0.85);
    }
  } else {
    // shrine march: violet border road with gold waymarkers
    c.rect(r.x, r.y, r.w, r.h, SHRINE);
    if (vertical) {
      c.rect(r.x, r.y, 3, r.h, SHRINE_DARK);
      c.rect(r.x + r.w - 3, r.y, 3, r.h, SHRINE_DARK);
      for (let y = 10; y < r.h; y += 20) c.circle(r.x + r.w / 2, y, 3, GOLD, 0.95);
    } else {
      c.rect(r.x, r.y, r.w, 3, SHRINE_DARK);
      c.rect(r.x, r.y + r.h - 3, r.w, 3, SHRINE_DARK);
      for (let x = 10; x < r.w; x += 20) c.circle(x, r.y + r.h / 2, 3, GOLD, 0.95);
    }
  }
}

function pennantPng(c: Canvas, x: number, y: number, s: number): void {
  c.line(x, y, x, y - s * 2.1, Math.max(2, s * 0.22), INK);
  c.polygon(
    [
      [x, y - s * 2.1],
      [x + s * 1.15, y - s * 1.72],
      [x, y - s * 1.3],
    ],
    ROOF,
  );
  c.circle(x, y, s * 0.32, GOLD);
}

function drawCentrePng(c: Canvas, t: TileType): void {
  const s = 13;
  if (t.centre === 'city') {
    if (t.fortress) {
      c.frame(MID - 30, MID - 30, 60, 60, STONE_DARK, 5);
      for (let i = 0; i < 4; i++) {
        const ang = (Math.PI / 2) * i;
        c.circle(MID + Math.cos(ang) * 30, MID + Math.sin(ang) * 30, 7, STONE);
      }
    }
    c.circle(MID, MID, s * 1.75, shade(STONE, 0.28));
    c.circle(MID, MID, s * 1.55, STONE);
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI / 4) * i;
      c.circle(MID + Math.cos(ang) * s * 1.55, MID + Math.sin(ang) * s * 1.55, 3.5, STONE_DARK);
    }
    c.circle(MID, MID, s * 0.95, ROOF);
    c.circle(MID - 3, MID - 3, s * 0.4, tint(ROOF, 0.35), 0.8);
    c.circle(MID, MID, s * 0.28, shade(ROOF, 0.35));
    const flags = t.pennants ?? 0;
    if (flags >= 1) pennantPng(c, MID + s * 1.15, MID - s * 1.15, 6);
    if (flags >= 2) pennantPng(c, MID - s * 1.15, MID - s * 1.15, 6);
  } else if (t.centre === 'road') {
    c.circle(MID, MID, s * 1.15, ROAD);
    c.ring(MID, MID, s * 1.15, 3, ROAD_DARK);
    c.circle(MID, MID, s * 0.45, tint(ROAD, 0.65));
    for (let i = 0; i < 4; i++) {
      const ang = (Math.PI / 2) * i + Math.PI / 4;
      c.line(MID + Math.cos(ang) * s * 0.6, MID + Math.sin(ang) * s * 0.6, MID + Math.cos(ang) * s * 1.1, MID + Math.sin(ang) * s * 1.1, 3, tint(ROAD, 0.4), 0.8);
    }
  } else if (t.centre === 'shrine') {
    c.circle(MID, MID, s * 1.9, tint(STONE, 0.15));
    c.ring(MID, MID, s * 1.9, 3, SHRINE_DARK);
    // hip-roof seen from above: square + diagonals
    c.rect(MID - s, MID - s, s * 2, s * 2, SHRINE);
    c.frame(MID - s, MID - s, s * 2, s * 2, SHRINE_DARK, 2.5);
    c.line(MID - s, MID - s, MID + s, MID + s, 2, SHRINE_DARK, 0.9);
    c.line(MID + s, MID - s, MID - s, MID + s, 2, SHRINE_DARK, 0.9);
    c.circle(MID, MID, 4.5, GOLD);
  } else if (t.centre === 'field') {
    if (t.id === 'field-pasture') {
      for (const [tx, ty, tr] of [
        [MID - 14, MID - 8, 11],
        [MID + 12, MID + 4, 9],
      ] as const) {
        c.circle(tx, ty, tr, hex('#3F6B3A'));
        c.circle(tx - tr * 0.3, ty - tr * 0.3, tr * 0.4, tint(hex('#3F6B3A'), 0.3), 0.7);
      }
      c.circle(MID + 14, MID - 12, 4.5, CREAM, 0.95);
      c.circle(MID + 6, MID + 14, 4, CREAM, 0.9);
    } else {
      for (const [wx, wy] of [
        [MID - 12, MID - 10],
        [MID + 12, MID - 4],
        [MID - 4, MID + 13],
        [MID + 10, MID + 14],
      ] as const) {
        c.line(wx, wy + 10, wx, wy - 8, 2.6, hex('#B89B3E'));
        for (let i = 0; i < 3; i++) {
          c.circle(wx - 3, wy - 2 + i * 4, 2.4, GOLD, 0.9);
          c.circle(wx + 3, wy - 2 + i * 4, 2.4, GOLD, 0.9);
        }
      }
    }
  }
}

function tileBasePng(c: Canvas, t: TileType, scale: number): void {
  const jitter = ((seedOf(t.id) % 11) / 11) * 0.1;
  c.fill(mix(MEADOW, hex('#5E8A4A'), 0.35 + jitter));
  for (let y = 0; y < c.h; y += 6 * scale) c.rect(0, y, c.w, 2 * scale, shade(MEADOW, 0.06), 0.35);
  for (let i = 0; i < 90; i++) {
    const seed = seedOf(t.id) + i * 7919;
    const x = (seed * 31) % c.w;
    const y = (seed * 17) % c.h;
    c.rect(x, y, 3 * scale, 3 * scale, tint(MEADOW, 0.18), 0.28);
  }
  for (const dir of EDGE_ORDER) drawBandPng(c, dir, t.edges[dir]);
  const nonField = EDGE_ORDER.filter((d) => t.edges[d] !== 'field').length;
  if (nonField >= 2 && t.centre !== 'city') {
    // junction patch keeps crossing features visually connected
    c.circle(MID, MID, 18, t.edges.north !== 'field' ? STONE : nonFieldColor(t), 0.9);
  }
  drawCentrePng(c, t);
  if (t.special === 'start') {
    c.ring(MID, MID, 76, 5, GOLD, 0.9);
    for (const [x, y] of [
      [12, 12],
      [TILE - 12, 12],
      [12, TILE - 12],
      [TILE - 12, TILE - 12],
    ] as const) {
      c.ring(x, y, 5, 2, GOLD, 0.95);
    }
  }
  c.frame(0, 0, c.w, c.h, tint(MEADOW, 0.75), 2 * scale);
}

const nonFieldColor = (t: TileType): RGB =>
  EDGE_ORDER.some((d) => t.edges[d] === 'shrine') ? SHRINE : ROAD;

function tilePng(t: TileType): Canvas {
  // drawn straight at face size: band widths (15-32 px) stay crisp at 176 px
  const c = new Canvas(TILE, TILE);
  tileBasePng(c, t, 1);
  return c;
}

/* tile SVG: same primitives, vector twins */
function bandSvg(dir: (typeof EDGE_ORDER)[number], value: EdgeValue): string {
  if (value === 'field') return '';
  const r = bandRect(dir, BAND_W[value]);
  const vertical = dir === 'north' || dir === 'south';
  if (value === 'city') {
    const merlons = vertical
      ? Array.from({ length: 4 }, (_, i) => `<rect x="${r.x + 6}" y="${8 + i * 22}" width="${r.w - 12}" height="5" fill="${css(tint(STONE, 0.35))}" opacity="0.9"/>`).join('')
      : Array.from({ length: 4 }, (_, i) => `<rect x="${8 + i * 22}" y="${r.y + 6}" width="5" height="${r.h - 12}" fill="${css(tint(STONE, 0.35))}" opacity="0.9"/>`).join('');
    return `<g data-edge="${dir}" data-kind="city"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${css(STONE)}" stroke="${css(STONE_DARK)}" stroke-width="4"/>${merlons}</g>`;
  }
  if (value === 'road') {
    return `<g data-edge="${dir}" data-kind="road"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${css(ROAD)}" stroke="${css(ROAD_DARK)}" stroke-width="3"/></g>`;
  }
  const studs = vertical
    ? Array.from({ length: 4 }, (_, i) => `<circle cx="${r.x + r.w / 2}" cy="${12 + i * 20}" r="3" fill="${css(GOLD)}"/>`).join('')
    : Array.from({ length: 4 }, (_, i) => `<circle cx="${12 + i * 20}" cy="${r.y + r.h / 2}" r="3" fill="${css(GOLD)}"/>`).join('');
  return `<g data-edge="${dir}" data-kind="shrine"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${css(SHRINE)}" stroke="${css(SHRINE_DARK)}" stroke-width="3"/>${studs}</g>`;
}

function centreSvg(t: TileType): string {
  const s = 13;
  if (t.centre === 'city') {
    const flags = t.pennants ?? 0;
    const flag = (x: number, dirn: number): string =>
      `<line x1="${x}" y1="${MID - s * 1.15}" x2="${x}" y2="${MID - s * 3.2}" stroke="${css(INK)}" stroke-width="2.5"/><path d="M${x} ${MID - s * 3.2}L${x + dirn * s * 1.15} ${MID - s * 2.7}L${x} ${MID - s * 2.25}Z" fill="${css(ROOF)}"/>`;
    const fort = t.fortress
      ? `<rect x="${MID - 30}" y="${MID - 30}" width="60" height="60" fill="none" stroke="${css(STONE_DARK)}" stroke-width="5"/>`
      : '';
    return `<g data-centre="city">${fort}<circle cx="${MID}" cy="${MID}" r="${s * 1.55}" fill="${css(STONE)}" stroke="${css(shade(STONE, 0.28))}" stroke-width="4"/><circle cx="${MID}" cy="${MID}" r="${s * 0.95}" fill="${css(ROOF)}"/><circle cx="${MID}" cy="${MID}" r="${s * 0.28}" fill="${css(shade(ROOF, 0.35))}"/>${flags >= 1 ? flag(MID + s * 1.15, 1) : ''}${flags >= 2 ? flag(MID - s * 1.15, -1) : ''}</g>`;
  }
  if (t.centre === 'road') {
    return `<g data-centre="road"><circle cx="${MID}" cy="${MID}" r="${s * 1.15}" fill="${css(ROAD)}" stroke="${css(ROAD_DARK)}" stroke-width="3"/><circle cx="${MID}" cy="${MID}" r="${s * 0.45}" fill="${css(tint(ROAD, 0.65))}"/></g>`;
  }
  if (t.centre === 'shrine') {
    return `<g data-centre="shrine"><circle cx="${MID}" cy="${MID}" r="${s * 1.9}" fill="${css(tint(STONE, 0.15))}" stroke="${css(SHRINE_DARK)}" stroke-width="3"/><rect x="${MID - s}" y="${MID - s}" width="${s * 2}" height="${s * 2}" fill="${css(SHRINE)}" stroke="${css(SHRINE_DARK)}" stroke-width="2.5"/><line x1="${MID - s}" y1="${MID - s}" x2="${MID + s}" y2="${MID + s}" stroke="${css(SHRINE_DARK)}" stroke-width="2"/><line x1="${MID + s}" y1="${MID - s}" x2="${MID - s}" y2="${MID + s}" stroke="${css(SHRINE_DARK)}" stroke-width="2"/><circle cx="${MID}" cy="${MID}" r="4.5" fill="${css(GOLD)}"/></g>`;
  }
  if (t.centre === 'field') {
    if (t.id === 'field-pasture') {
      return `<g data-centre="field"><circle cx="${MID - 14}" cy="${MID - 8}" r="11" fill="#3F6B3A"/><circle cx="${MID + 12}" cy="${MID + 4}" r="9" fill="#3F6B3A"/><circle cx="${MID + 14}" cy="${MID - 12}" r="4.5" fill="${css(CREAM)}"/><circle cx="${MID + 6}" cy="${MID + 14}" r="4" fill="${css(CREAM)}"/></g>`;
    }
    const wheat = [
      [MID - 12, MID - 10],
      [MID + 12, MID - 4],
      [MID - 4, MID + 13],
      [MID + 10, MID + 14],
    ]
      .map(
        ([wx, wy]) =>
          `<line x1="${wx}" y1="${wy + 10}" x2="${wx}" y2="${wy - 8}" stroke="#B89B3E" stroke-width="2.6"/><circle cx="${wx - 3}" cy="${wy}" r="2.4" fill="${css(GOLD)}"/><circle cx="${wx + 3}" cy="${wy}" r="2.4" fill="${css(GOLD)}"/><circle cx="${wx - 3}" cy="${wy + 4}" r="2.4" fill="${css(GOLD)}"/><circle cx="${wx + 3}" cy="${wy + 4}" r="2.4" fill="${css(GOLD)}"/>`,
      )
      .join('');
    return `<g data-centre="field">${wheat}</g>`;
  }
  return `<g data-centre="none"/>`;
}

function tileSvg(t: TileType): string {
  const edges = EDGE_ORDER.map((d) => bandSvg(d, t.edges[d])).join('\n');
  const start =
    t.special === 'start'
      ? `<circle cx="${MID}" cy="${MID}" r="76" fill="none" stroke="${css(GOLD)}" stroke-width="5" opacity="0.9"/>`
      : '';
  return svgDoc(
    TILE,
    TILE,
    `Tile ${t.id} — ${tr[`tile.${t.id}.name`] ?? t.id}`,
    `<rect width="${TILE}" height="${TILE}" fill="${css(MEADOW)}"/>
${Array.from({ length: 29 }, (_, i) => `<line x1="0" y1="${i * 6 + 3}" x2="${TILE}" y2="${i * 6 + 3}" stroke="${css(shade(MEADOW, 0.12))}" stroke-width="1.5" opacity="0.3"/>`).join('\n')}
${edges}
${centreSvg(t)}
${start}
<rect x="1" y="1" width="${TILE - 2}" height="${TILE - 2}" fill="none" stroke="${css(tint(MEADOW, 0.75))}" stroke-width="2"/>
<text x="6" y="${TILE - 6}" font-family="${FONT}" font-size="9" fill="${css(tint(MEADOW, 0.85))}">${esc(`${t.edges.north}/${t.edges.east}/${t.edges.south}/${t.edges.west}`)}</text>`,
  );
}

/* --------------------------------------------------------------- workers */
function workerPng(color: RGB): Canvas {
  const S = 128;
  const c = new Canvas(S, S);
  c.circle(S / 2, S / 2 + 4, S * 0.46, shade(color, 0.5), 0.6); // drop shadow
  // hooded worker silhouette
  c.polygon(
    [
      [S * 0.3, S * 0.82],
      [S * 0.7, S * 0.82],
      [S * 0.63, S * 0.44],
      [S * 0.37, S * 0.44],
    ],
    color,
  );
  c.circle(S / 2, S * 0.33, S * 0.155, color);
  c.ring(S / 2, S * 0.33, S * 0.155, S * 0.045, shade(color, 0.35));
  c.circle(S / 2, S * 0.345, S * 0.095, tint(color, 0.6)); // face light
  c.rect(S * 0.24, S * 0.5, S * 0.1, S * 0.24, shade(color, 0.2), 0.9); // arms
  c.rect(S * 0.66, S * 0.5, S * 0.1, S * 0.24, shade(color, 0.2), 0.9);
  c.rect(S * 0.34, S * 0.82, S * 0.32, S * 0.07, shade(color, 0.45)); // base
  c.polygon(
    [
      [S * 0.42, S * 0.56],
      [S * 0.58, S * 0.56],
      [S * 0.5, S * 0.7],
    ],
    tint(color, 0.45),
  ); // chest badge
  c.ring(S / 2, S * 0.6, 8, 4, shade(color, 0.4));
  return c;
}

function workerSvg(color: RGB, label: string): string {
  const S = 128;
  return svgDoc(
    S,
    S,
    `Worker pawn: ${label}`,
    [
      `<circle cx="${S / 2}" cy="${S / 2 + 4}" r="${S * 0.46}" fill="${css(shade(color, 0.5))}" opacity="0.35"/>`,
      `<polygon points="${S * 0.3},${S * 0.82} ${S * 0.7},${S * 0.82} ${S * 0.63},${S * 0.44} ${S * 0.37},${S * 0.44}" fill="${css(color)}" stroke="${css(shade(color, 0.35))}" stroke-width="3"/>`,
      `<circle cx="${S / 2}" cy="${S * 0.33}" r="${S * 0.155}" fill="${css(color)}" stroke="${css(shade(color, 0.35))}" stroke-width="4"/>`,
      `<circle cx="${S / 2}" cy="${S * 0.345}" r="${S * 0.095}" fill="${css(tint(color, 0.6))}"/>`,
      `<polygon points="${S * 0.42},${S * 0.56} ${S * 0.58},${S * 0.56} ${S * 0.5},${S * 0.7}" fill="${css(tint(color, 0.45))}"/>`,
      `<text x="${S / 2}" y="${S - 4}" font-family="${FONT}" font-size="10" fill="${css(tint(color, 0.8))}" text-anchor="middle">${esc(label)}</text>`,
    ].join('\n'),
  );
}

/* role badges: 128px medallions with an original glyph per worker role */
const ROLE_INK: Record<string, RGB> = { scout: hex('#2E7D9E'), guard: hex('#B3402A'), monk: hex('#7A4A6B'), farmer: hex('#5E7D3A') };

function rolePng(role: string): Canvas {
  const S = 128;
  const ink = ROLE_INK[role] ?? INK;
  const c = new Canvas(S, S);
  c.circle(S / 2, S / 2, S * 0.46, shade(ink, 0.45));
  c.circle(S / 2, S / 2, S * 0.4, PARCHMENT);
  c.ring(S / 2, S / 2, S * 0.4, 6, ink);
  const cx = S / 2;
  const cy = S / 2;
    if (role === 'scout') {
      // open eye with road-spoke pupil
      c.polygon(
        [
          [cx - 30, cy],
          [cx, cy - 20],
          [cx + 30, cy],
          [cx, cy + 20],
        ],
        tint(ink, 0.75),
      );
      c.circle(cx, cy, 11, ink);
      c.circle(cx, cy, 4.5, CREAM);
      for (let i = 0; i < 4; i++) {
        const ang = (Math.PI / 2) * i + Math.PI / 4;
        c.line(cx + Math.cos(ang) * 12, cy + Math.sin(ang) * 12, cx + Math.cos(ang) * 17, cy + Math.sin(ang) * 17, 2.5, ink);
      }
    } else if (role === 'guard') {
      // shield with chevron
      c.polygon(
        [
          [cx - 22, cy - 24],
          [cx + 22, cy - 24],
          [cx + 22, cy + 6],
          [cx, cy + 28],
          [cx - 22, cy + 6],
        ],
        ink,
      );
      c.polygon(
        [
          [cx - 13, cy - 12],
          [cx + 13, cy - 12],
          [cx, cy + 8],
        ],
        tint(ink, 0.7),
      );
    } else if (role === 'monk') {
      // bell
      c.polygon(
        [
          [cx - 20, cy + 14],
          [cx + 20, cy + 14],
          [cx + 12, cy - 14],
          [cx - 12, cy - 14],
        ],
        ink,
      );
      c.circle(cx, cy - 16, 7, ink);
      c.rect(cx - 24, cy + 14, 48, 6, shade(ink, 0.25));
      c.circle(cx, cy + 24, 5, ink);
      c.circle(cx, cy - 24, 4, GOLD);
    } else {
      // wheat sheaf
      c.line(cx, cy + 26, cx, cy - 22, 4, hex('#B89B3E'));
      for (let i = 0; i < 4; i++) {
        const y = cy - 14 + i * 10;
        c.polygon(
          [
            [cx, y - 5],
            [cx - 14, y + 3],
            [cx, y + 7],
          ],
          ink,
        );
        c.polygon(
          [
            [cx, y - 5],
            [cx + 14, y + 3],
            [cx, y + 7],
          ],
          ink,
        );
      }
    }
  return c;
}

function roleSvg(role: string, label: string): string {
  const S = 128;
  const ink = ROLE_INK[role] ?? INK;
  const cx = S / 2;
  const cy = S / 2;
  let glyph = '';
  if (role === 'scout') {
    glyph = `<polygon points="${cx - 30},${cy} ${cx},${cy - 20} ${cx + 30},${cy} ${cx},${cy + 20}" fill="${css(tint(ink, 0.75))}" stroke="${css(ink)}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="11" fill="${css(ink)}"/><circle cx="${cx}" cy="${cy}" r="4.5" fill="${css(CREAM)}"/>`;
  } else if (role === 'guard') {
    glyph = `<polygon points="${cx - 22},${cy - 24} ${cx + 22},${cy - 24} ${cx + 22},${cy + 6} ${cx},${cy + 28} ${cx - 22},${cy + 6}" fill="${css(ink)}"/><polygon points="${cx - 13},${cy - 12} ${cx + 13},${cy - 12} ${cx},${cy + 8}" fill="${css(tint(ink, 0.7))}"/>`;
  } else if (role === 'monk') {
    glyph = `<polygon points="${cx - 20},${cy + 14} ${cx + 20},${cy + 14} ${cx + 12},${cy - 14} ${cx - 12},${cy - 14}" fill="${css(ink)}"/><circle cx="${cx}" cy="${cy - 16}" r="7" fill="${css(ink)}"/><rect x="${cx - 24}" y="${cy + 14}" width="48" height="6" fill="${css(shade(ink, 0.25))}"/><circle cx="${cx}" cy="${cy + 24}" r="5" fill="${css(ink)}"/><circle cx="${cx}" cy="${cy - 24}" r="4" fill="${css(GOLD)}"/>`;
  } else {
    const grains = Array.from(
      { length: 4 },
      (_, i) => {
        const y = cy - 14 + i * 10;
        return `<polygon points="${cx},${y - 5} ${cx - 14},${y + 3} ${cx},${y + 7}" fill="${css(ink)}"/><polygon points="${cx},${y - 5} ${cx + 14},${y + 3} ${cx},${y + 7}" fill="${css(ink)}"/>`;
      },
    ).join('');
    glyph = `<line x1="${cx}" y1="${cy + 26}" x2="${cx}" y2="${cy - 22}" stroke="#B89B3E" stroke-width="4"/>${grains}`;
  }
  return svgDoc(
    S,
    S,
    `Worker role badge: ${label}`,
    [
      `<circle cx="${cx}" cy="${cy}" r="${S * 0.46}" fill="${css(shade(ink, 0.45))}"/>`,
      `<circle cx="${cx}" cy="${cy}" r="${S * 0.4}" fill="${css(PARCHMENT)}" stroke="${css(ink)}" stroke-width="6"/>`,
      glyph,
      `<text x="${cx}" y="${S - 4}" font-family="${FONT}" font-size="10" fill="${css(shade(ink, 0.2))}" text-anchor="middle">${esc(label)}</text>`,
    ].join('\n'),
  );
}

/* ------------------------------------------------------- back, marker, mat */
function tileBackPng(): Canvas {
  const base = hex('#23324E');
  const accent = hex('#D8B863');
  const c = new Canvas(TILE, TILE);
  c.roundRect(4, 4, TILE - 8, TILE - 8, 14, base);
  c.frame(4, 4, TILE - 8, TILE - 8, accent, 3);
  for (let i = -TILE; i < TILE; i += 16) {
    c.line(i, 8, i + TILE, TILE - 8, 2, accent, 0.14);
    c.line(i, TILE - 8, i + TILE, 8, 2, accent, 0.07);
  }
  c.circle(MID, MID, 52, shade(base, 0.25), 0.9);
  c.ring(MID, MID, 52, 3, accent);
  c.polygon(
    [
      [MID, MID - 38],
      [MID + 38, MID],
      [MID, MID + 38],
      [MID - 38, MID],
    ],
    accent,
    0.92,
  );
  c.polygon(
    [
      [MID, MID - 22],
      [MID + 22, MID],
      [MID, MID + 22],
      [MID - 22, MID],
    ],
    base,
  );
  c.circle(MID, MID, 8, accent);
  return c;
}

function tileBackSvg(): string {
  const base = hex('#23324E');
  const accent = hex('#D8B863');
  return svgDoc(
    TILE,
    TILE,
    'Tile back (bag side)',
    [
      `<rect x="4" y="4" width="${TILE - 8}" height="${TILE - 8}" rx="14" fill="${css(base)}" stroke="${css(accent)}" stroke-width="3"/>`,
      `<defs><pattern id="weave" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="16" stroke="${css(accent)}" stroke-width="2" opacity="0.14"/></pattern></defs>`,
      `<rect x="8" y="8" width="${TILE - 16}" height="${TILE - 16}" rx="12" fill="url(#weave)"/>`,
      `<circle cx="${MID}" cy="${MID}" r="52" fill="${css(shade(base, 0.25))}" stroke="${css(accent)}" stroke-width="3"/>`,
      `<polygon points="${MID},${MID - 38} ${MID + 38},${MID} ${MID},${MID + 38} ${MID - 38},${MID}" fill="${css(accent)}"/>`,
      `<polygon points="${MID},${MID - 22} ${MID + 22},${MID} ${MID},${MID + 22} ${MID - 22},${MID}" fill="${css(base)}"/>`,
      `<text x="${MID}" y="${TILE - 10}" font-family="${FONT}" font-size="9" letter-spacing="2" fill="${css(accent)}" text-anchor="middle">TILE KINGDOMS</text>`,
    ].join('\n'),
  );
}

function startMarkerPng(): Canvas {
  const c = new Canvas(TILE, TILE);
  c.ring(MID, MID, 80, 5, GOLD, 0.95);
  c.ring(MID, MID, 72, 2, tint(GOLD, 0.4), 0.8);
  // crown of the throne city
  const w = 56;
  const x0 = MID - w / 2;
  const y0 = MID + 26;
  c.rect(x0, y0, w, 12, GOLD, 0.95);
  c.polygon(
    [
      [x0, y0],
      [x0, y0 - 20],
      [x0 + w * 0.25, y0 - 8],
      [MID, y0 - 24],
      [x0 + w * 0.75, y0 - 8],
      [x0 + w, y0 - 20],
      [x0 + w, y0],
    ],
    GOLD,
    0.95,
  );
  c.circle(x0, y0 - 20, 4, GOLD);
  c.circle(MID, y0 - 24, 4, GOLD);
  c.circle(x0 + w, y0 - 20, 4, GOLD);
  c.circle(MID - 14, y0 + 6, 3, shade(GOLD, 0.4));
  c.circle(MID + 14, y0 + 6, 3, shade(GOLD, 0.4));
  return c;
}

function startMarkerSvg(): string {
  const w = 56;
  const x0 = MID - w / 2;
  const y0 = MID + 26;
  return svgDoc(
    TILE,
    TILE,
    'Start cell marker (throne ring)',
    [
      `<circle cx="${MID}" cy="${MID}" r="80" fill="none" stroke="${css(GOLD)}" stroke-width="5" opacity="0.95"/>`,
      `<circle cx="${MID}" cy="${MID}" r="72" fill="none" stroke="${css(tint(GOLD, 0.4))}" stroke-width="2" opacity="0.8"/>`,
      `<rect x="${x0}" y="${y0}" width="${w}" height="12" fill="${css(GOLD)}"/>`,
      `<polygon points="${x0},${y0} ${x0},${y0 - 20} ${x0 + w * 0.25},${y0 - 8} ${MID},${y0 - 24} ${x0 + w * 0.75},${y0 - 8} ${x0 + w},${y0 - 20} ${x0 + w},${y0}" fill="${css(GOLD)}"/>`,
      `<circle cx="${x0}" cy="${y0 - 20}" r="4" fill="${css(GOLD)}"/><circle cx="${MID}" cy="${y0 - 24}" r="4" fill="${css(GOLD)}"/><circle cx="${x0 + w}" cy="${y0 - 20}" r="4" fill="${css(GOLD)}"/>`,
    ].join('\n'),
  );
}

const MAT = 920;
function playmatPng(): Canvas {
  const felt = hex('#3E5340');
  const c = new Canvas(MAT, MAT);
  c.fill(felt);
  for (let i = 0; i < 4200; i++) {
    const x = (i * 7919) % MAT;
    const y = (i * 104729) % MAT;
    c.rect(x, y, 2, 2, i % 2 ? tint(felt, 0.08) : shade(felt, 0.1), 0.5);
  }
  for (let i = 0; i <= 23; i++) {
    const p = 20 + i * 40;
    c.rect(p, 20, 1.4, 920 - 40, tint(felt, 0.22), 0.35);
    c.rect(20, p, 920 - 40, 1.4, tint(felt, 0.22), 0.35);
  }
  c.frame(0, 0, MAT, MAT, shade(felt, 0.5), 14);
  c.frame(12, 12, MAT - 24, MAT - 24, GOLD, 3);
  c.ring(MAT / 2, MAT / 2, 56, 3, GOLD, 0.55);
  c.ring(MAT / 2, MAT / 2, 48, 1.5, GOLD, 0.35);
  c.polygon(
    [
      [MAT / 2, MAT / 2 - 30],
      [MAT / 2 + 30, MAT / 2],
      [MAT / 2, MAT / 2 + 30],
      [MAT / 2 - 30, MAT / 2],
    ],
    GOLD,
    0.35,
  );
  for (const [x, y] of [
    [30, 30],
    [MAT - 30, 30],
    [30, MAT - 30],
    [MAT - 30, MAT - 30],
  ] as const)
    c.ring(x, y, 8, 3, GOLD, 0.7);
  return c;
}

function playmatSvg(): string {
  const felt = hex('#3E5340');
  const lines = Array.from(
    { length: 24 },
    (_, i) =>
      `<line x1="${20 + i * 40}" y1="20" x2="${20 + i * 40}" y2="${MAT - 20}" stroke="${css(tint(felt, 0.22))}" stroke-width="1.4" opacity="0.35"/><line x1="20" y1="${20 + i * 40}" x2="${MAT - 20}" y2="${20 + i * 40}" stroke="${css(tint(felt, 0.22))}" stroke-width="1.4" opacity="0.35"/>`,
  ).join('\n');
  return svgDoc(
    MAT,
    MAT,
    'Kingdom table mat (23x23 snap grid)',
    [
      `<rect width="${MAT}" height="${MAT}" fill="${css(felt)}"/>`,
      lines,
      `<rect x="7" y="7" width="${MAT - 14}" height="${MAT - 14}" fill="none" stroke="${css(shade(felt, 0.5))}" stroke-width="14"/>`,
      `<rect x="13" y="13" width="${MAT - 26}" height="${MAT - 26}" fill="none" stroke="${css(GOLD)}" stroke-width="3"/>`,
      `<circle cx="${MAT / 2}" cy="${MAT / 2}" r="56" fill="none" stroke="${css(GOLD)}" stroke-width="3" opacity="0.55"/>`,
      `<polygon points="${MAT / 2},${MAT / 2 - 30} ${MAT / 2 + 30},${MAT / 2} ${MAT / 2},${MAT / 2 + 30} ${MAT / 2 - 30},${MAT / 2}" fill="${css(GOLD)}" opacity="0.35"/>`,
      `<text x="${MAT / 2}" y="46" font-family="${FONT}" font-size="22" font-weight="700" letter-spacing="8" fill="${css(GOLD)}" text-anchor="middle" opacity="0.8">TILE KINGDOMS</text>`,
      `<text x="${MAT / 2}" y="${MAT - 30}" font-family="${FONT}" font-size="13" letter-spacing="4" fill="${css(GOLD)}" text-anchor="middle" opacity="0.6">23 x 23 SNAP GRID - START CELL AT 11,11</text>`,
    ].join('\n'),
  );
}

/* --------------------------------------------------------------------- emit */
interface ArtFile {
  key: string;
  path: string;
  kind: 'png' | 'svg';
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

const written: ArtFile[] = [];

function emitPng(key: string, file: string, canvas: Canvas): void {
  const abs = join(OUT, file);
  const buf = encodePng(canvas.grain(seedOf(key), 6));
  writeFileSync(abs, buf);
  written.push({
    key,
    path: `assets/${file}`,
    kind: 'png',
    width: canvas.w,
    height: canvas.h,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  });
}

function emitSvg(key: string, file: string, svg: string, width: number, height: number): void {
  const abs = join(SVG_OUT, file);
  const buf = Buffer.from(svg, 'utf8');
  writeFileSync(abs, buf);
  written.push({
    key,
    path: `assets/svg/${file}`,
    kind: 'svg',
    width,
    height,
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(SVG_OUT, { recursive: true });

// 1. the 24 tile faces (rasters + vector twins)
for (const t of tiles.types) {
  emitPng(`tile-${t.id}`, `tile-${t.id}.png`, tilePng(t));
  emitSvg(`tile-${t.id}-vector`, `tile-${t.id}.svg`, tileSvg(t), TILE, TILE);
}

// 2. worker pawns (5 colours)
for (const color of workers.colors) {
  const rgb = hex(color.color);
  const label = tr[`color.${color.id}.name`] ?? color.id;
  emitPng(`worker-${color.id}`, `worker-${color.id}.png`, workerPng(rgb));
  emitSvg(`worker-${color.id}-vector`, `worker-${color.id}.svg`, workerSvg(rgb, `${label} worker`), 128, 128);
}

// 3. role badges (4 features)
for (const role of workers.roles) {
  const label = tr[`worker.${role.id}.name`] ?? role.id;
  emitPng(`role-${role.id}`, `role-${role.id}.png`, rolePng(role.id));
  emitSvg(`role-${role.id}-vector`, `role-${role.id}.svg`, roleSvg(role.id, label), 128, 128);
}

// 4. bag back, start-cell marker, table mat
emitPng('tile-back', 'tile-back.png', tileBackPng());
emitSvg('tile-back-vector', 'tile-back.svg', tileBackSvg(), TILE, TILE);
emitPng('start-marker', 'start-marker.png', startMarkerPng());
emitSvg('start-marker-vector', 'start-marker.svg', startMarkerSvg(), TILE, TILE);
emitPng('playmat', 'playmat.png', playmatPng());
emitSvg('playmat-vector', 'playmat.svg', playmatSvg(), MAT, MAT);

// 5. inventory
const index = {
  generator: 'scripts/generate-art.ts',
  note: 'All art is generated procedurally from primitives: tile faces derive straight from the edge arrays in tiles/tiles.json, rasters are encoded by the built-in PNG writer. No third-party images.',
  pngCount: written.filter((f) => f.kind === 'png').length,
  svgCount: written.filter((f) => f.kind === 'svg').length,
  files: written.sort((a, b) => a.path.localeCompare(b.path)),
};
writeFileSync(join(OUT, 'art-index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');

const total = written.reduce((sum, f) => sum + f.bytes, 0);
console.log(
  `generated ${written.length} art files (${index.pngCount} png, ${index.svgCount} svg), ${(total / 1024).toFixed(1)} KiB`,
);
const smallest = [...written].sort((a, b) => a.bytes - b.bytes)[0];
console.log(`smallest: ${smallest?.path} ${smallest?.bytes} bytes`);
