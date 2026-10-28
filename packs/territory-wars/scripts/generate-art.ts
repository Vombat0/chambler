#!/usr/bin/env tsx
/**
 * Generates every visual asset of the territory-wars pack from code.
 * NO downloads, NO image dependencies: the region map is a Voronoi partition of
 * the anchor points in board/board.json; vector art is emitted as SVG text and
 * rasterised by a tiny built-in PNG encoder (zlib only).
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

const INK = hex('#27211C');
const PARCHMENT = hex('#EFE6D2');
const CREAM = hex('#FAF3E3');
const GOLD = hex('#B98A3C');

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

  dotted(x1: number, y1: number, x2: number, y2: number, t: number, c: RGB, gap = 14): this {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.round(len / gap));
    for (let i = 1; i < steps; i++) {
      const t0 = i / steps;
      this.circle(x1 + (x2 - x1) * t0, y1 + (y2 - y1) * t0, t / 2, c, 0.9);
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

  static render(w: number, h: number, scale: number, draw: (c: Canvas) => void): Canvas {
    const big = new Canvas(w * scale, h * scale);
    draw(big);
    const out = new Canvas(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const i = ((y * scale + sy) * big.w + (x * scale + sx)) * 4;
            r += big.data[i] ?? 0;
            g += big.data[i + 1] ?? 0;
            b += big.data[i + 2] ?? 0;
            a += big.data[i + 3] ?? 0;
          }
        }
        const n = scale * scale;
        const j = (y * w + x) * 4;
        out.data[j] = r / n;
        out.data[j + 1] = g / n;
        out.data[j + 2] = b / n;
        out.data[j + 3] = a / n;
      }
    }
    return out;
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
interface Region {
  id: string;
  continent: string;
  nameKey: string;
  anchor: [number, number];
  neighbors: string[];
  fortress?: boolean;
}
interface Continent {
  id: string;
  nameKey: string;
  color: string;
  bonus: number;
  members: string[];
}

const board = JSON.parse(readFileSync(join(PACK, 'board/board.json'), 'utf8')) as {
  canvas: { width: number; height: number };
  regions: Region[];
};
const continents = (
  JSON.parse(readFileSync(join(PACK, 'board/continents.json'), 'utf8')) as {
    continents: Continent[];
  }
).continents;
const tr = JSON.parse(readFileSync(join(PACK, 'i18n/tr.json'), 'utf8')) as Record<string, string>;
const en = JSON.parse(readFileSync(join(PACK, 'i18n/en.json'), 'utf8')) as Record<string, string>;

const MAP_W = board.canvas.width;
const MAP_H = board.canvas.height;
const regionById = new Map(board.regions.map((r) => [r.id, r]));
const colorOf = new Map(continents.map((c) => [c.id, hex(c.color)]));
const display = (slug: string): string =>
  slug
    .split('-')
    .map((w0) => w0.charAt(0).toUpperCase() + w0.slice(1))
    .join(' ');
const seedOf = (key: string): number => [...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/* --------------------------------------------------------- voronoi partition */
function clipHalf(poly: Pt[], nx: number, ny: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const fp = nx * p[0] + ny * p[1] - c;
    const fq = nx * q[0] + ny * q[1] - c;
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

const seeds = board.regions.map((r) => r.anchor as Pt);
const cells: Pt[][] = seeds.map((s, i) => {
  let poly: Pt[] = [
    [0, 0],
    [MAP_W, 0],
    [MAP_W, MAP_H],
    [0, MAP_H],
  ];
  for (let j = 0; j < seeds.length && poly.length > 2; j++) {
    if (j === i) continue;
    const t = seeds[j]!;
    poly = clipHalf(
      poly,
      t[0] - s[0],
      t[1] - s[1],
      (t[0] * t[0] + t[1] * t[1] - s[0] * s[0] - s[1] * s[1]) / 2,
    );
  }
  return poly;
});
const cellOf = new Map(board.regions.map((r, i) => [r.id, cells[i]!]));

const fillOf = (region: Region): RGB => {
  const base = colorOf.get(region.continent) ?? GOLD;
  const jitter = ((seedOf(region.id) % 13) / 13) * 0.14;
  return tint(base, 0.5 + jitter);
};

/** Unique neighbour pairs, drawn once. */
const pairs: [Region, Region][] = [];
for (const r of board.regions) {
  for (const n of r.neighbors) {
    if (r.id < n) pairs.push([r, regionById.get(n)!]);
  }
}

/* ---------------------------------------------------------------- svg helpers */
const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const svgDoc = (w: number, h: number, title: string, body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
  <title id="t">${esc(title)}</title>
  <desc id="d">Procedurally generated by packs/territory-wars/scripts/generate-art.ts. The region map is a Voronoi partition of the anchors in board/board.json — an entirely original chart of the invented world of Aetheris. Original artwork, MIT licensed with the pack. No third-party images, fonts or trademarks are embedded; every shape is drawn from primitives.</desc>
  <metadata>{"generator":"scripts/generate-art.ts","pack":"territory-wars","world":"aetheris","license":"MIT","width":${w},"height":${h},"origin":"procedural"}</metadata>
${body}
</svg>
`;

const FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';
const polyPts = (pts: readonly Pt[]): string => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

/* ----------------------------------------------------------------------- map */
function fortressGlyph(c: Canvas, cx: number, cy: number, s: number, ink: RGB): void {
  c.rect(cx - s * 0.7, cy - s * 0.3, s * 1.4, s * 1.0, ink);
  for (let i = 0; i < 3; i++) c.rect(cx - s * 0.7 + i * s * 0.55, cy - s * 0.6, s * 0.3, s * 0.4, ink);
  c.rect(cx - s * 0.18, cy + s * 0.15, s * 0.36, s * 0.55, tint(ink, 0.8));
}

function mapPng(): Canvas {
  return Canvas.render(MAP_W, MAP_H, 2, (c) => {
    c.fill(PARCHMENT);
    for (let i = 0; i < 7000; i++) {
      const x = (i * 7919) % (MAP_W * 2);
      const y = (i * 104729) % (MAP_H * 2);
      c.rect(x, y, 2, 2, shade(PARCHMENT, 0.05), 0.5);
    }
    // cells
    for (const region of board.regions) {
      const poly = cellOf.get(region.id)!;
      c.polygon(poly, fillOf(region), 0.92);
      // hatch every third row a touch darker so neighbouring cells never merge
      c.polygon(
        poly.map((p) => [p[0], p[1]]) as Pt[],
        shade(colorOf.get(region.continent) ?? GOLD, 0.08),
        0.06,
      );
    }
    // cell borders
    for (const region of board.regions) {
      const poly = cellOf.get(region.id)!;
      const ink = shade(colorOf.get(region.continent) ?? GOLD, 0.45);
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        c.line(p[0], p[1], q[0], q[1], 3, ink, 0.9);
      }
    }
    // adjacency routes: solid inside a continent, dotted across sea
    for (const [a, b] of pairs) {
      const [ax, ay] = a.anchor;
      const [bx, by] = b.anchor;
      if (a.continent === b.continent) c.line(ax, ay, bx, by, 5, INK, 0.55);
      else c.dotted(ax, ay, bx, by, 7, shade(GOLD, 0.15), 18);
      for (const [x, y] of [
        [ax, ay],
        [bx, by],
      ] as const)
        c.ring(x, y, 9, 3, INK, 0.5);
    }
    // fortress keeps
    for (const region of board.regions) {
      if (!region.fortress) continue;
      const [x, y] = region.anchor;
      c.circle(x, y + 26, 26, tint(PARCHMENT, 0.5), 0.9);
      c.ring(x, y + 26, 26, 3, INK, 0.9);
      fortressGlyph(c, x, y + 26, 12, shade(colorOf.get(region.continent) ?? GOLD, 0.3));
    }
    // compass rose (bottom centre-left) and corner ticks
    const cx = 130;
    const cy = MAP_H - 130;
    c.ring(cx, cy, 52, 4, INK, 0.85);
    c.ring(cx, cy, 40, 2, shade(GOLD, 0.1), 0.9);
    for (let i = 0; i < 4; i++) {
      const ang = (Math.PI / 2) * i;
      const dx = Math.sin(ang);
      const dy = -Math.cos(ang);
      c.polygon(
        [
          [cx + dx * 44, cy + dy * 44],
          [cx + dy * 10, cy - dx * 10],
          [cx - dy * 10, cy + dx * 10],
        ],
        i % 2 === 0 ? INK : shade(GOLD, 0.2),
        0.9,
      );
    }
    c.frame(0, 0, MAP_W, MAP_H, INK, 12);
    c.frame(12, 12, MAP_W - 24, MAP_H - 24, GOLD, 4);
  });
}

function mapSvg(): string {
  const parts: string[] = [`<rect width="${MAP_W}" height="${MAP_H}" fill="${css(PARCHMENT)}"/>`];
  for (const region of board.regions) {
    const poly = cellOf.get(region.id)!;
    parts.push(
      `<g data-region="${region.id}" data-continent="${region.continent}"><polygon points="${polyPts(poly)}" fill="${css(fillOf(region))}" stroke="${css(shade(colorOf.get(region.continent) ?? GOLD, 0.45))}" stroke-width="3"/></g>`,
    );
  }
  for (const [a, b] of pairs) {
    const sea = a.continent !== b.continent;
    parts.push(
      `<line x1="${a.anchor[0]}" y1="${a.anchor[1]}" x2="${b.anchor[0]}" y2="${b.anchor[1]}" stroke="${sea ? css(shade(GOLD, 0.15)) : css(INK)}" stroke-width="${sea ? 5 : 4}" stroke-opacity="${sea ? 0.9 : 0.55}"${sea ? ' stroke-dasharray="14 12"' : ''}/>`,
    );
  }
  for (const region of board.regions) {
    if (!region.fortress) continue;
    const [x, y] = region.anchor;
    parts.push(
      `<g data-fortress="${region.id}" transform="translate(${x} ${y + 26})"><circle r="26" fill="${css(tint(PARCHMENT, 0.5))}" stroke="${css(INK)}" stroke-width="3"/><rect x="-8" y="-4" width="16" height="12" fill="${css(shade(colorOf.get(region.continent) ?? GOLD, 0.3))}"/><rect x="-8" y="-10" width="4" height="6" fill="${css(shade(colorOf.get(region.continent) ?? GOLD, 0.3))}"/><rect x="-2" y="-10" width="4" height="6" fill="${css(shade(colorOf.get(region.continent) ?? GOLD, 0.3))}"/><rect x="4" y="-10" width="4" height="6" fill="${css(shade(colorOf.get(region.continent) ?? GOLD, 0.3))}"/></g>`,
    );
  }
  const cx = 130;
  const cy = MAP_H - 130;
  parts.push(
    `<g transform="translate(${cx} ${cy})"><circle r="52" fill="none" stroke="${css(INK)}" stroke-width="4"/><circle r="40" fill="none" stroke="${css(shade(GOLD, 0.1))}" stroke-width="2"/>`,
  );
  for (let i = 0; i < 4; i++) {
    const ang = (Math.PI / 2) * i;
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    parts.push(
      `<polygon points="${(dx * 44).toFixed(1)},${(dy * 44).toFixed(1)} ${(dy * 10).toFixed(1)},${(-dx * 10).toFixed(1)} ${(-dy * 10).toFixed(1)},${(dx * 10).toFixed(1)}" fill="${i % 2 === 0 ? css(INK) : css(shade(GOLD, 0.2))}"/>`,
    );
  }
  parts.push('</g>');
  parts.push(
    `<text x="${MAP_W - 40}" y="60" font-family="${FONT}" font-size="34" font-weight="700" letter-spacing="8" fill="${css(INK)}" text-anchor="end">TERRITORY WARS</text>`,
    `<text x="${MAP_W - 40}" y="92" font-family="${FONT}" font-size="18" letter-spacing="6" fill="${css(shade(PARCHMENT, 0.5))}" text-anchor="end">CHART OF AETHERIS — 28 REGIONS, 5 CONTINENTS</text>`,
  );
  parts.push(
    `<rect x="6" y="6" width="${MAP_W - 12}" height="${MAP_H - 12}" fill="none" stroke="${css(INK)}" stroke-width="12"/>`,
    `<rect x="14" y="14" width="${MAP_W - 28}" height="${MAP_H - 28}" fill="none" stroke="${css(GOLD)}" stroke-width="4"/>`,
  );
  return svgDoc(MAP_W, MAP_H, 'Territory Wars — chart of Aetheris', parts.join('\n'));
}

/** Bare polygons for the engine to own; no parchment, no text. */
function regionsSvg(): string {
  const parts: string[] = [`<rect width="${MAP_W}" height="${MAP_H}" fill="none"/>`];
  for (const region of board.regions) {
    parts.push(
      `<polygon id="${region.id}" data-region="${region.id}" data-continent="${region.continent}" data-fortress="${region.fortress === true}" data-anchor-x="${region.anchor[0]}" data-anchor-y="${region.anchor[1]}" data-neighbors="${region.neighbors.join(' ')}" points="${polyPts(cellOf.get(region.id)!)}" fill="${css(colorOf.get(region.continent) ?? GOLD)}" fill-opacity="0.55" stroke="${css(INK)}" stroke-width="2"/>`,
    );
  }
  return svgDoc(MAP_W, MAP_H, 'Aetheris region polygons', parts.join('\n'));
}

function continentSvg(continent: Continent): string {
  const ink = hex(continent.color);
  const parts = board.regions
    .filter((r) => r.continent === continent.id)
    .map(
      (r) =>
        `<polygon data-region="${r.id}" points="${polyPts(cellOf.get(r.id)!)}" fill="${css(ink)}" fill-opacity="0.75" stroke="${css(shade(ink, 0.4))}" stroke-width="3"/>`,
    );
  return svgDoc(
    MAP_W,
    MAP_H,
    `Continent colour layer: ${display(continent.id)}`,
    `<g id="layer-${continent.id}" data-bonus="${continent.bonus}">\n${parts.join('\n')}\n</g>`,
  );
}

function labelsSvg(lang: 'tr' | 'en', dict: Record<string, string>): string {
  const parts = board.regions.map((r) => {
    const label = dict[r.nameKey] ?? display(r.id);
    const [x, y] = r.anchor;
    return `<g data-region="${r.id}"><text x="${x}" y="${y}" font-family="${FONT}" font-size="21" font-weight="600" fill="${css(INK)}" text-anchor="middle">${esc(label)}</text></g>`;
  });
  return svgDoc(
    MAP_W,
    MAP_H,
    `Region labels (${lang})`,
    `<g id="labels-${lang}">\n${parts.join('\n')}\n</g>`,
  );
}

function adjacencySvg(): string {
  const parts: string[] = [];
  for (const [a, b] of pairs) {
    parts.push(
      `<line data-from="${a.id}" data-to="${b.id}" x1="${a.anchor[0]}" y1="${a.anchor[1]}" x2="${b.anchor[0]}" y2="${b.anchor[1]}" stroke="${css(INK)}" stroke-width="3"/>`,
    );
  }
  for (const r of board.regions) {
    parts.push(`<circle data-region="${r.id}" cx="${r.anchor[0]}" cy="${r.anchor[1]}" r="7" fill="${css(shade(GOLD, 0.2))}"/>`);
  }
  return svgDoc(
    MAP_W,
    MAP_H,
    'Adjacency graph of Aetheris',
    `<g id="adjacency">\n${parts.join('\n')}\n</g>`,
  );
}

/* -------------------------------------------------------------- legion icons */
function iconSpear(c: Canvas, cx: number, cy: number, s: number, ink: RGB): void {
  c.circle(cx, cy + s * 0.2, s * 0.72, tint(ink, 0.55));
  c.ring(cx, cy + s * 0.2, s * 0.72, s * 0.12, ink);
  c.circle(cx, cy + s * 0.2, s * 0.2, shade(ink, 0.2));
  c.line(cx + s * 0.35, cy - s, cx - s * 0.1, cy + s * 0.9, s * 0.14, shade(ink, 0.25));
  c.polygon(
    [
      [cx + s * 0.55, cy - s * 1.1],
      [cx + s * 0.15, cy - s * 0.55],
      [cx + s * 0.5, cy - s * 0.42],
    ],
    ink,
  );
}

function iconWing(c: Canvas, cx: number, cy: number, s: number, ink: RGB): void {
  c.polygon(
    [
      [cx + s * 0.15, cy - s],
      [cx - s * 0.55, cy + s * 0.15],
      [cx - s * 0.02, cy + s * 0.15],
      [cx - s * 0.25, cy + s],
      [cx + s * 0.6, cy - s * 0.25],
      [cx + s * 0.08, cy - s * 0.25],
    ],
    ink,
  );
  for (let i = 0; i < 3; i++) {
    c.line(cx - s * 0.85, cy - s * 0.5 + i * s * 0.32, cx - s * 0.45, cy - s * 0.68 + i * s * 0.32, s * 0.14, shade(ink, 0.2));
  }
  for (let i = 0; i < 3; i++) {
    c.line(cx + s * 0.5, cy - s * 0.85 + i * s * 0.32, cx + s * 0.9, cy - s * 1.0 + i * s * 0.32, s * 0.14, shade(ink, 0.2));
  }
}

function iconBull(c: Canvas, cx: number, cy: number, s: number, ink: RGB): void {
  c.polygon(
    [
      [cx - s * 0.55, cy - s * 0.35],
      [cx + s * 0.55, cy - s * 0.35],
      [cx + s * 0.35, cy + s * 0.55],
      [cx, cy + s * 0.95],
      [cx - s * 0.35, cy + s * 0.55],
    ],
    ink,
  );
  for (const dir of [-1, 1]) {
    for (let i = 0; i <= 10; i++) {
      const t0 = i / 10;
      const ang = Math.PI * (0.08 + 0.84 * t0);
      c.circle(cx + dir * (s * 0.4 + Math.cos(ang) * s * 0.5), cy - s * 0.45 - Math.sin(ang) * s * 0.5, s * 0.11, shade(ink, 0.15));
    }
  }
  c.circle(cx, cy + s * 0.45, s * 0.14, tint(ink, 0.75));
}

const UNIT_ICONS: Record<string, (c: Canvas, cx: number, cy: number, s: number, ink: RGB) => void> = {
  spearwatch: iconSpear,
  stormwing: iconWing,
  ironbull: iconBull,
};

const LEGION_INK: Record<string, RGB> = {
  spearwatch: hex('#3D5A9E'),
  stormwing: hex('#6B4A8C'),
  ironbull: hex('#8F5B2C'),
};

function iconSvgPath(kind: string, s: number, ink: RGB): string {
  const fill = css(ink);
  const dark = css(shade(ink, 0.2));
  const light = css(tint(ink, 0.6));
  if (kind === 'spearwatch') {
    return `<circle cx="0" cy="${s * 0.2}" r="${s * 0.72}" fill="${light}" stroke="${fill}" stroke-width="${s * 0.12}"/><circle cx="0" cy="${s * 0.2}" r="${s * 0.2}" fill="${dark}"/><line x1="${s * 0.35}" y1="${-s}" x2="${-s * 0.1}" y2="${s * 0.9}" stroke="${dark}" stroke-width="${s * 0.14}"/><path d="M${s * 0.55} ${-s * 1.1}L${s * 0.15} ${-s * 0.55}L${s * 0.5} ${-s * 0.42}Z" fill="${fill}"/>`;
  }
  if (kind === 'stormwing') {
    const chevrons = [0, 1, 2]
      .map(
        (i) =>
          `<line x1="${-s * 0.85}" y1="${-s * 0.5 + i * s * 0.32}" x2="${-s * 0.45}" y2="${-s * 0.68 + i * s * 0.32}" stroke="${dark}" stroke-width="${s * 0.14}"/><line x1="${s * 0.5}" y1="${-s * 0.85 + i * s * 0.32}" x2="${s * 0.9}" y2="${-s + i * s * 0.32}" stroke="${dark}" stroke-width="${s * 0.14}"/>`,
      )
      .join('');
    return `<path d="M${s * 0.15} ${-s}L${-s * 0.55} ${s * 0.15}L${-s * 0.02} ${s * 0.15}L${-s * 0.25} ${s}L${s * 0.6} ${-s * 0.25}L${s * 0.08} ${-s * 0.25}Z" fill="${fill}"/>${chevrons}`;
  }
  const horns = [-1, 1]
    .map((dir) => {
      const pts: string[] = [];
      for (let i = 0; i <= 10; i++) {
        const ang = Math.PI * (0.08 + 0.84 * (i / 10));
        pts.push(`${(dir * (s * 0.4 + Math.cos(ang) * s * 0.5)).toFixed(1)},${(-s * 0.45 - Math.sin(ang) * s * 0.5).toFixed(1)}`);
      }
      return `<polyline points="${pts.join(' ')}" fill="none" stroke="${dark}" stroke-width="${s * 0.16}"/>`;
    })
    .join('');
  return `<path d="M${-s * 0.55} ${-s * 0.35}L${s * 0.55} ${-s * 0.35}L${s * 0.35} ${s * 0.55}L0 ${s * 0.95}L${-s * 0.35} ${s * 0.55}Z" fill="${fill}"/>${horns}<circle cx="0" cy="${s * 0.45}" r="${s * 0.14}" fill="${light}"/>`;
}

/* --------------------------------------------------------------------- cards */
const CARD_W = 320;
const CARD_H = 440;

function legionCardPng(legionId: string): Canvas {
  const ink = LEGION_INK[legionId] ?? INK;
  return Canvas.render(CARD_W, CARD_H, 3, (c) => {
    c.roundRect(8, 8, CARD_W - 16, CARD_H - 16, 16, CREAM);
    c.frame(8, 8, CARD_W - 16, CARD_H - 16, INK, 3);
    c.roundRect(8, 8, CARD_W - 16, 96, 16, ink);
    c.rect(8, 80, CARD_W - 16, 24, ink);
    c.rect(8, 340, CARD_W - 16, 92, tint(ink, 0.82));
    c.frame(8, 8, CARD_W - 16, CARD_H - 16, INK, 3);
    UNIT_ICONS[legionId]!(c, CARD_W / 2, 208, 64, ink);
    c.ring(CARD_W / 2, 208, 96, 4, shade(ink, 0.25));
    for (const [x, y] of [
      [40, 372],
      [CARD_W - 40, 372],
    ] as const)
      c.circle(x, y, 12, ink, 0.8);
    for (let i = 0; i < 4; i++) c.rect(70 + i * 26, 366, 14, 14, shade(ink, 0.15), 0.5);
  });
}

function legionCardSvg(legionId: string, name: string): string {
  const ink = LEGION_INK[legionId] ?? INK;
  return svgDoc(
    CARD_W,
    CARD_H,
    `Legion writ: ${name}`,
    [
      `<rect x="8" y="8" width="${CARD_W - 16}" height="${CARD_H - 16}" rx="16" fill="${css(CREAM)}" stroke="${css(INK)}" stroke-width="3"/>`,
      `<path d="M24 8h272a16 16 0 0 1 16 16v72H8V24A16 16 0 0 1 24 8z" fill="${css(ink)}"/>`,
      `<text x="${CARD_W / 2}" y="66" font-family="${FONT}" font-size="20" font-weight="700" letter-spacing="2" fill="${css(CREAM)}" text-anchor="middle">${esc(name.toUpperCase())}</text>`,
      `<g transform="translate(${CARD_W / 2} 208)">${iconSvgPath(legionId, 64, ink)}</g>`,
      `<circle cx="${CARD_W / 2}" cy="208" r="96" fill="none" stroke="${css(shade(ink, 0.25))}" stroke-width="4"/>`,
      `<rect x="8" y="340" width="${CARD_W - 16}" height="92" fill="${css(tint(ink, 0.82))}"/>`,
      `<text x="${CARD_W / 2}" y="392" font-family="${FONT}" font-size="15" fill="${css(shade(ink, 0.45))}" text-anchor="middle" letter-spacing="3">LEGION WRIT</text>`,
    ].join('\n'),
  );
}

function territoryCardPng(): Canvas {
  return Canvas.render(CARD_W, CARD_H, 3, (c) => {
    c.roundRect(8, 8, CARD_W - 16, CARD_H - 16, 16, CREAM);
    c.frame(8, 8, CARD_W - 16, CARD_H - 16, INK, 3);
    c.roundRect(8, 8, CARD_W - 16, 84, 16, shade(GOLD, 0.18));
    c.rect(8, 76, CARD_W - 16, 16, shade(GOLD, 0.18));
    // cartouche for the region banner
    c.roundRect(44, 150, CARD_W - 88, 170, 22, PARCHMENT);
    c.frame(44, 150, CARD_W - 88, 170, shade(GOLD, 0.1), 5);
    for (let i = 0; i < 6; i++) {
      c.rect(56 + i * 38, 132, 22, 8, shade(GOLD, 0.25), 0.7);
      c.rect(56 + i * 38, 330, 22, 8, shade(GOLD, 0.25), 0.7);
    }
    c.circle(CARD_W / 2, 235, 44, tint(GOLD, 0.65));
    c.ring(CARD_W / 2, 235, 44, 4, shade(GOLD, 0.15));
    c.polygon(
      [
        [CARD_W / 2, 205],
        [CARD_W / 2 + 26, 235],
        [CARD_W / 2, 265],
        [CARD_W / 2 - 26, 235],
      ],
      shade(GOLD, 0.25),
    );
    c.rect(44, 352, CARD_W - 88, 6, shade(CREAM, 0.4));
    c.rect(70, 376, CARD_W - 140, 6, shade(CREAM, 0.55));
    c.rect(96, 400, CARD_W - 192, 6, shade(CREAM, 0.7));
  });
}

function territoryCardSvg(): string {
  return svgDoc(
    CARD_W,
    CARD_H,
    'Territory banner card (template)',
    [
      `<rect x="8" y="8" width="${CARD_W - 16}" height="${CARD_H - 16}" rx="16" fill="${css(CREAM)}" stroke="${css(INK)}" stroke-width="3"/>`,
      `<path d="M24 8h272a16 16 0 0 1 16 16v60H8V24A16 16 0 0 1 24 8z" fill="${css(shade(GOLD, 0.18))}"/>`,
      `<text x="${CARD_W / 2}" y="58" font-family="${FONT}" font-size="18" font-weight="700" letter-spacing="4" fill="${css(CREAM)}" text-anchor="middle">AETHERIS BANNER</text>`,
      `<rect x="44" y="150" width="${CARD_W - 88}" height="170" rx="22" fill="${css(PARCHMENT)}" stroke="${css(shade(GOLD, 0.1))}" stroke-width="5"/>`,
      ...Array.from(
        { length: 6 },
        (_, i) =>
          `<rect x="${56 + i * 38}" y="132" width="22" height="8" fill="${css(shade(GOLD, 0.25))}" opacity="0.7"/><rect x="${56 + i * 38}" y="330" width="22" height="8" fill="${css(shade(GOLD, 0.25))}" opacity="0.7"/>`,
      ),
      `<circle cx="${CARD_W / 2}" cy="235" r="44" fill="${css(tint(GOLD, 0.65))}" stroke="${css(shade(GOLD, 0.15))}" stroke-width="4"/>`,
      `<path d="M${CARD_W / 2} 205L${CARD_W / 2 + 26} 235L${CARD_W / 2} 265L${CARD_W / 2 - 26} 235Z" fill="${css(shade(GOLD, 0.25))}"/>`,
      `<line x1="44" y1="352" x2="${CARD_W - 44}" y2="352" stroke="${css(shade(CREAM, 0.4))}" stroke-width="6"/>`,
      `<line x1="70" y1="376" x2="${CARD_W - 70}" y2="376" stroke="${css(shade(CREAM, 0.55))}" stroke-width="6"/>`,
      `<line x1="96" y1="400" x2="${CARD_W - 96}" y2="400" stroke="${css(shade(CREAM, 0.7))}" stroke-width="6"/>`,
    ].join('\n'),
  );
}

function jokerPng(): Canvas {
  return Canvas.render(CARD_W, CARD_H, 3, (c) => {
    c.roundRect(8, 8, CARD_W - 16, CARD_H - 16, 16, tint(GOLD, 0.72));
    c.frame(8, 8, CARD_W - 16, CARD_H - 16, INK, 3);
    c.roundRect(8, 8, CARD_W - 16, 96, 16, shade(GOLD, 0.28));
    c.rect(8, 80, CARD_W - 16, 16, shade(GOLD, 0.28));
    c.ring(CARD_W / 2, 224, 92, 6, shade(GOLD, 0.3));
    c.ring(CARD_W / 2, 224, 112, 2, shade(GOLD, 0.1), 0.6);
    c.polygon(
      [
        [CARD_W / 2, 224 - 64],
        [CARD_W / 2 + 64, 224],
        [CARD_W / 2, 224 + 64],
        [CARD_W / 2 - 64, 224],
      ],
      shade(GOLD, 0.4),
    );
    c.polygon(
      [
        [CARD_W / 2, 224 - 34],
        [CARD_W / 2 + 34, 224],
        [CARD_W / 2, 224 + 34],
        [CARD_W / 2 - 34, 224],
      ],
      CREAM,
    );
    for (let i = 0; i < 12; i++) {
      const ang = (Math.PI / 6) * i;
      c.circle(CARD_W / 2 + Math.cos(ang) * 102, 224 + Math.sin(ang) * 102, 5, shade(GOLD, 0.2), 0.85);
    }
    c.rect(56, 360, CARD_W - 112, 60, tint(GOLD, 0.5));
    c.frame(56, 360, CARD_W - 112, 60, shade(GOLD, 0.3), 3);
  });
}

function jokerSvg(): string {
  const dots = Array.from(
    { length: 12 },
    (_, i) => {
      const ang = (Math.PI / 6) * i;
      return `<circle cx="${(CARD_W / 2 + Math.cos(ang) * 102).toFixed(1)}" cy="${(224 + Math.sin(ang) * 102).toFixed(1)}" r="5" fill="${css(shade(GOLD, 0.2))}"/>`;
    },
  ).join('');
  return svgDoc(
    CARD_W,
    CARD_H,
    'Banner of Aetheris (wild card)',
    [
      `<rect x="8" y="8" width="${CARD_W - 16}" height="${CARD_H - 16}" rx="16" fill="${css(tint(GOLD, 0.72))}" stroke="${css(INK)}" stroke-width="3"/>`,
      `<path d="M24 8h272a16 16 0 0 1 16 16v72H8V24A16 16 0 0 1 24 8z" fill="${css(shade(GOLD, 0.28))}"/>`,
      `<text x="${CARD_W / 2}" y="66" font-family="${FONT}" font-size="19" font-weight="700" letter-spacing="3" fill="${css(CREAM)}" text-anchor="middle">BANNER OF AETHERIS</text>`,
      `<circle cx="${CARD_W / 2}" cy="224" r="92" fill="none" stroke="${css(shade(GOLD, 0.3))}" stroke-width="6"/>`,
      `<circle cx="${CARD_W / 2}" cy="224" r="112" fill="none" stroke="${css(shade(GOLD, 0.1))}" stroke-width="2" opacity="0.6"/>`,
      `<path d="M${CARD_W / 2} 160L${CARD_W / 2 + 64} 224L${CARD_W / 2} 288L${CARD_W / 2 - 64} 224Z" fill="${css(shade(GOLD, 0.4))}"/>`,
      `<path d="M${CARD_W / 2} 190L${CARD_W / 2 + 34} 224L${CARD_W / 2} 258L${CARD_W / 2 - 34} 224Z" fill="${css(CREAM)}"/>`,
      dots,
      `<rect x="56" y="360" width="${CARD_W - 112}" height="60" fill="${css(tint(GOLD, 0.5))}" stroke="${css(shade(GOLD, 0.3))}" stroke-width="3"/>`,
      `<text x="${CARD_W / 2}" y="396" font-family="${FONT}" font-size="16" letter-spacing="3" fill="${css(shade(GOLD, 0.45))}" text-anchor="middle">WILD • HER BÖLGE</text>`,
    ].join('\n'),
  );
}

function cardBackPng(base: RGB, accent: RGB): Canvas {
  return Canvas.render(CARD_W, CARD_H, 2, (c) => {
    c.roundRect(6, 6, CARD_W - 12, CARD_H - 12, 18, base);
    c.roundRect(16, 16, CARD_W - 32, CARD_H - 32, 14, shade(base, 0.08));
    c.frame(16, 16, CARD_W - 32, CARD_H - 32, accent, 3);
    for (let i = -CARD_H; i < CARD_W; i += 26) {
      c.line(i, 16, i + CARD_H, CARD_H - 16, 2, accent, 0.16);
      c.line(i, CARD_H - 16, i + CARD_H, 16, 2, accent, 0.08);
    }
    c.circle(CARD_W / 2, CARD_H / 2, 88, shade(base, 0.22), 0.9);
    c.ring(CARD_W / 2, CARD_H / 2, 88, 4, accent);
    c.polygon(
      [
        [CARD_W / 2, CARD_H / 2 - 66],
        [CARD_W / 2 + 66, CARD_H / 2],
        [CARD_W / 2, CARD_H / 2 + 66],
        [CARD_W / 2 - 66, CARD_H / 2],
      ],
      accent,
      0.92,
    );
    c.polygon(
      [
        [CARD_W / 2, CARD_H / 2 - 38],
        [CARD_W / 2 + 38, CARD_H / 2],
        [CARD_W / 2, CARD_H / 2 + 38],
        [CARD_W / 2 - 38, CARD_H / 2],
      ],
      tint(base, 0.6),
    );
    for (const [x, y] of [
      [40, 40],
      [CARD_W - 40, 40],
      [40, CARD_H - 40],
      [CARD_W - 40, CARD_H - 40],
    ] as const) {
      c.circle(x, y, 9, accent, 0.85);
      c.ring(x, y, 15, 2, accent, 0.5);
    }
  });
}

function cardBackSvg(base: RGB, accent: RGB, title: string): string {
  return svgDoc(
    CARD_W,
    CARD_H,
    `Card back: ${title}`,
    [
      `<rect x="6" y="6" width="${CARD_W - 12}" height="${CARD_H - 12}" rx="18" fill="${css(base)}"/>`,
      `<rect x="16" y="16" width="${CARD_W - 32}" height="${CARD_H - 32}" rx="14" fill="${css(shade(base, 0.08))}" stroke="${css(accent)}" stroke-width="3"/>`,
      `<defs><pattern id="weave" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="26" stroke="${css(accent)}" stroke-width="2" opacity="0.16"/></pattern></defs>`,
      `<rect x="16" y="16" width="${CARD_W - 32}" height="${CARD_H - 32}" rx="14" fill="url(#weave)"/>`,
      `<circle cx="${CARD_W / 2}" cy="${CARD_H / 2}" r="88" fill="${css(shade(base, 0.22))}" stroke="${css(accent)}" stroke-width="4"/>`,
      `<path d="M${CARD_W / 2} ${CARD_H / 2 - 66}L${CARD_W / 2 + 66} ${CARD_H / 2}L${CARD_W / 2} ${CARD_H / 2 + 66}L${CARD_W / 2 - 66} ${CARD_H / 2}Z" fill="${css(accent)}"/>`,
      `<path d="M${CARD_W / 2} ${CARD_H / 2 - 38}L${CARD_W / 2 + 38} ${CARD_H / 2}L${CARD_W / 2} ${CARD_H / 2 + 38}L${CARD_W / 2 - 38} ${CARD_H / 2}Z" fill="${css(tint(base, 0.6))}"/>`,
      `<text x="${CARD_W / 2}" y="${CARD_H - 44}" font-family="${FONT}" font-size="16" letter-spacing="4" fill="${css(accent)}" text-anchor="middle">${esc(title.toUpperCase())}</text>`,
    ].join('\n'),
  );
}

/* -------------------------------------------------------- dice, tokens, army */
const PIP_LAYOUT: Record<number, readonly (readonly [number, number])[]> = {
  1: [[0.5, 0.5]],
  2: [[0.3, 0.3], [0.7, 0.7]],
  3: [[0.28, 0.28], [0.5, 0.5], [0.72, 0.72]],
  4: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]],
  5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
  6: [[0.3, 0.26], [0.7, 0.26], [0.3, 0.5], [0.7, 0.5], [0.3, 0.74], [0.7, 0.74]],
};

function diePng(value: number): Canvas {
  const S = 128;
  return Canvas.render(S, S, 3, (c) => {
    c.roundRect(12, 12, S - 24, S - 24, 20, shade(GOLD, 0.05));
    c.roundRect(17, 17, S - 34, S - 34, 16, CREAM);
    c.frame(12, 12, S - 24, S - 24, INK, 3);
    for (const [px, py] of PIP_LAYOUT[value]!) {
      c.circle(S * px, S * py, 9, INK);
      c.circle(S * px - 2, S * py - 2, 3, tint(INK, 0.4), 0.7);
    }
  });
}

function dieSvg(value: number): string {
  const S = 128;
  return svgDoc(
    S,
    S,
    `Conflict die face ${value}`,
    [
      `<rect x="12" y="12" width="${S - 24}" height="${S - 24}" rx="20" fill="${css(shade(GOLD, 0.05))}"/>`,
      `<rect x="17" y="17" width="${S - 34}" height="${S - 34}" rx="16" fill="${css(CREAM)}" stroke="${css(INK)}" stroke-width="3"/>`,
      PIP_LAYOUT[value]!
        .map(
          ([px, py]) =>
            `<circle cx="${(S * px).toFixed(1)}" cy="${(S * py).toFixed(1)}" r="9" fill="${css(INK)}"/>`,
        )
        .join(''),
      `<text x="${S - 24}" y="${S - 18}" font-family="${FONT}" font-size="12" fill="${css(shade(CREAM, 0.4))}" text-anchor="end">d6</text>`,
    ].join('\n'),
  );
}

function tokenPng(color: RGB): Canvas {
  const S = 128;
  return Canvas.render(S, S, 3, (c) => {
    c.circle(S / 2, S / 2 + 3, S * 0.46, shade(color, 0.4));
    c.circle(S / 2, S / 2, S * 0.42, color);
    c.circle(S / 2 - S * 0.1, S / 2 - S * 0.12, S * 0.18, tint(color, 0.5), 0.75);
    c.ring(S / 2, S / 2, S * 0.42, 3, shade(color, 0.5));
    c.ring(S / 2, S / 2, S * 0.28, 2, tint(color, 0.55), 0.5);
    c.polygon(
      [
        [S / 2, S * 0.32],
        [S * 0.62, S / 2],
        [S / 2, S * 0.68],
        [S * 0.38, S / 2],
      ],
      shade(color, 0.3),
    );
  });
}

function tokenSvg(color: RGB, label: string): string {
  const S = 128;
  return svgDoc(
    S,
    S,
    `Commander pawn: ${label}`,
    [
      `<defs><radialGradient id="p" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="${css(tint(color, 0.55))}"/><stop offset="0.65" stop-color="${css(color)}"/><stop offset="1" stop-color="${css(shade(color, 0.45))}"/></radialGradient></defs>`,
      `<circle cx="${S / 2}" cy="${S / 2 + 3}" r="${S * 0.46}" fill="${css(shade(color, 0.45))}"/>`,
      `<circle cx="${S / 2}" cy="${S / 2}" r="${S * 0.42}" fill="url(#p)" stroke="${css(shade(color, 0.5))}" stroke-width="3"/>`,
      `<path d="M${S / 2} ${S * 0.32}L${S * 0.62} ${S / 2}L${S / 2} ${S * 0.68}L${S * 0.38} ${S / 2}Z" fill="${css(shade(color, 0.3))}"/>`,
      `<text x="${S / 2}" y="${S - 6}" font-family="${FONT}" font-size="10" fill="${css(tint(color, 0.85))}" text-anchor="middle">${esc(label)}</text>`,
    ].join('\n'),
  );
}

function armyDiscPng(): Canvas {
  const S = 128;
  const ink = hex('#5A5448');
  return Canvas.render(S, S, 3, (c) => {
    c.circle(S / 2, S / 2, S * 0.47, shade(ink, 0.35));
    c.circle(S / 2, S / 2, S * 0.43, tint(ink, 0.45));
    c.ring(S / 2, S / 2, S * 0.43, 4, ink);
    c.polygon(
      [
        [S * 0.32, S * 0.28],
        [S * 0.68, S * 0.28],
        [S * 0.68, S * 0.55],
        [S / 2, S * 0.76],
        [S * 0.32, S * 0.55],
      ],
      ink,
    );
    c.line(S / 2, S * 0.36, S / 2, S * 0.62, 5, CREAM);
    c.line(S * 0.42, S * 0.44, S * 0.58, S * 0.44, 5, CREAM);
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI / 4) * i + Math.PI / 8;
      c.circle(S / 2 + Math.cos(ang) * S * 0.43, S / 2 + Math.sin(ang) * S * 0.43, 3, CREAM, 0.8);
    }
  });
}

function armyDiscSvg(): string {
  const S = 128;
  const ink = hex('#5A5448');
  const ticks = Array.from(
    { length: 8 },
    (_, i) => {
      const ang = (Math.PI / 4) * i + Math.PI / 8;
      return `<circle cx="${(S / 2 + Math.cos(ang) * S * 0.43).toFixed(1)}" cy="${(S / 2 + Math.sin(ang) * S * 0.43).toFixed(1)}" r="3" fill="${css(CREAM)}"/>`;
    },
  ).join('');
  return svgDoc(
    S,
    S,
    'Army disc counter',
    [
      `<circle cx="${S / 2}" cy="${S / 2}" r="${S * 0.47}" fill="${css(shade(ink, 0.35))}"/>`,
      `<circle cx="${S / 2}" cy="${S / 2}" r="${S * 0.43}" fill="${css(tint(ink, 0.45))}" stroke="${css(ink)}" stroke-width="4"/>`,
      `<path d="M${S * 0.32} ${S * 0.28}H${S * 0.68}V${S * 0.55}L${S / 2} ${S * 0.76}L${S * 0.32} ${S * 0.55}Z" fill="${css(ink)}"/>`,
      `<line x1="${S / 2}" y1="${S * 0.36}" x2="${S / 2}" y2="${S * 0.62}" stroke="${css(CREAM)}" stroke-width="5"/>`,
      `<line x1="${S * 0.42}" y1="${S * 0.44}" x2="${S * 0.58}" y2="${S * 0.44}" stroke="${css(CREAM)}" stroke-width="5"/>`,
      ticks,
    ].join('\n'),
  );
}

function unitMarkerPng(legionId: string): Canvas {
  const S = 128;
  const ink = LEGION_INK[legionId] ?? INK;
  return Canvas.render(S, S, 3, (c) => {
    c.circle(S / 2, S / 2, S * 0.47, shade(ink, 0.4));
    c.circle(S / 2, S / 2, S * 0.43, tint(ink, 0.72));
    c.ring(S / 2, S / 2, S * 0.43, 4, ink);
    UNIT_ICONS[legionId]!(c, S / 2, S / 2, 26, ink);
  });
}

function unitMarkerSvg(legionId: string, label: string): string {
  const S = 128;
  const ink = LEGION_INK[legionId] ?? INK;
  return svgDoc(
    S,
    S,
    `Legion marker: ${label}`,
    [
      `<circle cx="${S / 2}" cy="${S / 2}" r="${S * 0.47}" fill="${css(shade(ink, 0.4))}"/>`,
      `<circle cx="${S / 2}" cy="${S / 2}" r="${S * 0.43}" fill="${css(tint(ink, 0.72))}" stroke="${css(ink)}" stroke-width="4"/>`,
      `<g transform="translate(${S / 2} ${S / 2})">${iconSvgPath(legionId, 26, ink)}</g>`,
      `<text x="${S / 2}" y="${S - 6}" font-family="${FONT}" font-size="10" fill="${css(shade(ink, 0.35))}" text-anchor="middle">${esc(label)}</text>`,
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

// 1. the world map (raster + vector + bare polygons + per-continent layers)
emitPng('map-plate', 'map.png', mapPng());
emitSvg('map-vector', 'map.svg', mapSvg(), MAP_W, MAP_H);
emitSvg('map-regions', 'map-regions.svg', regionsSvg(), MAP_W, MAP_H);
emitSvg('map-adjacency', 'adjacency.svg', adjacencySvg(), MAP_W, MAP_H);
for (const continent of continents) {
  emitSvg(
    `continent-${continent.id}`,
    `continent-${continent.id}.svg`,
    continentSvg(continent),
    MAP_W,
    MAP_H,
  );
}
emitSvg('region-labels-tr', 'region-labels-tr.svg', labelsSvg('tr', tr), MAP_W, MAP_H);
emitSvg('region-labels-en', 'region-labels-en.svg', labelsSvg('en', en), MAP_W, MAP_H);

// 2. conflict dice faces
for (let face = 1; face <= 6; face++) {
  emitPng(`dice-${face}`, `dice-${face}.png`, diePng(face));
  emitSvg(`dice-${face}-vector`, `dice-${face}.svg`, dieSvg(face), 128, 128);
}

// 3. commander pawns + army disc
const tokens = (
  JSON.parse(readFileSync(join(PACK, 'tokens/tokens.json'), 'utf8')) as {
    tokens: { id: string; color: string; nameKey: string }[];
    armies: { id: string; nameKey: string };
  }
).tokens;
for (const token of tokens) {
  const color = hex(token.color);
  const label = tr[token.nameKey] ?? token.id;
  emitPng(token.id, `${token.id}.png`, tokenPng(color));
  emitSvg(`${token.id}-vector`, `${token.id}.svg`, tokenSvg(color, label), 128, 128);
}
emitPng('army-disc', 'army-disc.png', armyDiscPng());
emitSvg('army-disc-vector', 'army-disc.svg', armyDiscSvg(), 128, 128);

// 4. cards
const backs: readonly [string, RGB, RGB, string][] = [
  ['card-back-territory', hex('#4A1F2B'), hex('#E0C27A'), tr['deck.territory.name'] ?? 'Banners'],
  ['card-back-legions', hex('#1F3D3A'), hex('#BFD8CB'), tr['deck.legions.name'] ?? 'Legions'],
];
for (const [id, base, accent, title] of backs) {
  emitPng(id, `${id}.png`, cardBackPng(base, accent));
  emitSvg(`${id}-vector`, `${id}.svg`, cardBackSvg(base, accent, title), CARD_W, CARD_H);
}
emitPng('territory-card', 'territory-card.png', territoryCardPng());
emitSvg('territory-card-vector', 'territory-card.svg', territoryCardSvg(), CARD_W, CARD_H);
emitPng('joker-banner', 'joker-banner.png', jokerPng());
emitSvg('joker-banner-vector', 'joker-banner.svg', jokerSvg(), CARD_W, CARD_H);

// 5. legion writs (card faces) + unit markers
const LEGION_IDS = ['spearwatch', 'stormwing', 'ironbull'] as const;
for (const legionId of LEGION_IDS) {
  const name = tr[`legion.${legionId}.name`] ?? legionId;
  emitPng(`legion-${legionId}`, `legion-${legionId}.png`, legionCardPng(legionId));
  emitSvg(
    `legion-${legionId}-vector`,
    `legion-${legionId}.svg`,
    legionCardSvg(legionId, name),
    CARD_W,
    CARD_H,
  );
  emitPng(`unit-${legionId}`, `unit-${legionId}.png`, unitMarkerPng(legionId));
  emitSvg(
    `unit-${legionId}-vector`,
    `unit-${legionId}.svg`,
    unitMarkerSvg(legionId, name),
    128,
    128,
  );
}

// 6. inventory
const index = {
  generator: 'scripts/generate-art.ts',
  note: 'All art is generated procedurally: the region polygons are a Voronoi partition of the board anchors, rasters are encoded by the built-in PNG writer. No third-party images.',
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
