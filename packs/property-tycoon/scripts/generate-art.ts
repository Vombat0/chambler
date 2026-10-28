#!/usr/bin/env tsx
/**
 * Generates every visual asset of the property-tycoon pack from code.
 * NO downloads, NO image dependencies: vector art is emitted as SVG text and
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

const INK = hex('#2A2320');
const CREAM = hex('#FBF4E6');
const PARCHMENT = hex('#F2E7D5');
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

  polygon(points: readonly (readonly [number, number])[], c: RGB, a = 1): this {
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

  /**
   * Deterministic paper grain. Keeps flat art from looking like a placeholder and
   * makes every raster carry real texture (also keeps each PNG comfortably >1 KiB).
   */
  grain(seed: number, strength = 5): this {
    let state = seed >>> 0 || 1;
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

  /** Supersampled render: draw at `scale`x, then box-downsample for clean edges. */
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
interface Cell {
  index: number;
  slug: string;
  type: string;
  side: 'bottom' | 'left' | 'top' | 'right';
  slot: number;
  groupId?: string;
  price?: number;
  rent?: number[];
}
interface Group {
  id: string;
  color: string;
  members: number[];
  size: number;
}

const board = JSON.parse(readFileSync(join(PACK, 'board/board.json'), 'utf8')) as {
  grid: { cols: number; rows: number };
  cells: Cell[];
};
const groups = (
  JSON.parse(readFileSync(join(PACK, 'board/groups.json'), 'utf8')) as { groups: Group[] }
).groups;
const tr = JSON.parse(readFileSync(join(PACK, 'i18n/tr.json'), 'utf8')) as Record<string, string>;
const groupColor = new Map(groups.map((g) => [g.id, hex(g.color)]));
const HARBOUR = hex('#2C6FA8');
const ENERGY = hex('#B8862B');

/* ------------------------------------------------------------------ geometry */
const BOARD = 1440;
const CW = BOARD / board.grid.cols;

function cellRect(cell: Cell, size: number): { x: number; y: number } {
  switch (cell.side) {
    case 'bottom':
      return {
        x: size - (cell.slot + 1) * (size / board.grid.cols),
        y: size - size / board.grid.cols,
      };
    case 'left':
      return { x: 0, y: size - (cell.slot + 1) * (size / board.grid.cols) };
    case 'top':
      return { x: cell.slot * (size / board.grid.cols), y: 0 };
    default:
      return { x: size - size / board.grid.cols, y: cell.slot * (size / board.grid.cols) };
  }
}

const cellInk = (cell: Cell): RGB => {
  if (cell.groupId && groupColor.has(cell.groupId)) return groupColor.get(cell.groupId)!;
  switch (cell.type) {
    case 'start':
      return hex('#3E6B4F');
    case 'tax':
      return hex('#8C3B3B');
    case 'chance':
      return hex('#C2456B');
    case 'community':
      return hex('#2E8B8B');
    case 'jail':
      return hex('#5A5A66');
    case 'free-parking':
      return hex('#4F7A3A');
    case 'go-to-jail':
      return hex('#7A3B3B');
    default:
      return hex('#8A6B4A');
  }
};

/* ---------------------------------------------------------------- svg helpers */
const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const svgDoc = (w: number, h: number, body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
  <title id="t">Mülk Tycoon — generated board art</title>
  <desc id="d">Procedurally generated by packs/property-tycoon/scripts/generate-art.ts. Original artwork, MIT licensed with the pack. No third-party images, fonts or trademarks are embedded; every shape is drawn from primitives.</desc>
  <metadata>{"generator":"scripts/generate-art.ts","pack":"property-tycoon","license":"MIT","width":${w},"height":${h},"origin":"procedural"}</metadata>
${body}
</svg>
`;

const FONT = 'DejaVu Sans, Helvetica, Arial, sans-serif';

/* --------------------------------------------------------------------- board */
function drawBoardPlate(size: number): Canvas {
  const cell = size / board.grid.cols;
  return Canvas.render(size, size, 2, (c) => {
    c.fill(PARCHMENT);
    // paper grain
    for (let i = 0; i < 5200; i++) {
      const x = (i * 7919) % size;
      const y = (i * 104729) % size;
      c.rect(x, y, 2, 2, shade(PARCHMENT, 0.04), 0.5);
    }
    c.frame(0, 0, size, size, INK, 10);
    c.frame(10, 10, size - 20, size - 20, GOLD, 4);

    for (const cellDef of board.cells) {
      const { x, y } = cellRect(cellDef, size);
      const ink = cellInk(cellDef);
      c.rect(x, y, cell, cell, CREAM);
      c.frame(x, y, cell, cell, INK, 2);
      // group colour band on the inner edge
      const band = Math.max(6, cell * 0.16);
      if (cellDef.side === 'bottom') c.rect(x + 2, y + 2, cell - 4, band, ink);
      if (cellDef.side === 'top') c.rect(x + 2, y + cell - band - 2, cell - 4, band, ink);
      if (cellDef.side === 'left') c.rect(x + cell - band - 2, y + 2, band, cell - 4, ink);
      if (cellDef.side === 'right') c.rect(x + 2, y + 2, band, cell - 4, ink);
      if ([0, 10, 20, 30].includes(cellDef.index)) {
        c.rect(x + 2, y + 2, cell - 4, cell - 4, tint(ink, 0.78));
        c.ring(x + cell / 2, y + cell / 2, cell * 0.28, 3, ink);
        c.rect(x + cell / 2 - cell * 0.1, y + cell / 2 - cell * 0.1, cell * 0.2, cell * 0.2, ink);
      } else {
        // price/rent plate line
        c.rect(x + cell * 0.18, y + cell * 0.55, cell * 0.64, 3, shade(CREAM, 0.35));
      }
    }

    // centre emblem
    const mid = size / 2;
    c.circle(mid, mid, size * 0.24, tint(PARCHMENT, 0.45));
    c.ring(mid, mid, size * 0.24, 6, INK);
    c.ring(mid, mid, size * 0.2, 3, GOLD);
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      c.polygon(
        [
          [mid + dx * size * 0.13, mid + dy * size * 0.13],
          [mid + dx * size * 0.19, mid + dy * size * 0.13],
          [mid + dx * size * 0.13, mid + dy * size * 0.19],
        ],
        INK,
        0.85,
      );
    }
    c.polygon(
      [
        [mid, mid - size * 0.1],
        [mid + size * 0.1, mid],
        [mid, mid + size * 0.1],
        [mid - size * 0.1, mid],
      ],
      hex('#B4552D'),
    );
    c.polygon(
      [
        [mid, mid - size * 0.05],
        [mid + size * 0.05, mid],
        [mid, mid + size * 0.05],
        [mid - size * 0.05, mid],
      ],
      CREAM,
    );
  });
}

function boardSvg(): string {
  const size = BOARD;
  const cell = CW;
  const parts: string[] = [`<rect width="${size}" height="${size}" fill="${css(PARCHMENT)}"/>`];
  parts.push(
    `<rect x="5" y="5" width="${size - 10}" height="${size - 10}" fill="none" stroke="${css(INK)}" stroke-width="10"/>`,
  );
  parts.push(
    `<rect x="12" y="12" width="${size - 24}" height="${size - 24}" fill="none" stroke="${css(GOLD)}" stroke-width="4"/>`,
  );
  for (const cellDef of board.cells) {
    const { x, y } = cellRect(cellDef, size);
    const ink = css(cellInk(cellDef));
    parts.push(
      `<g><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${css(CREAM)}" stroke="${css(INK)}" stroke-width="2"/>`,
    );
    const band = Math.max(6, cell * 0.16);
    if (cellDef.side === 'bottom')
      parts.push(
        `<rect x="${(x + 2).toFixed(1)}" y="${(y + 2).toFixed(1)}" width="${(cell - 4).toFixed(1)}" height="${band.toFixed(1)}" fill="${ink}"/>`,
      );
    if (cellDef.side === 'top')
      parts.push(
        `<rect x="${(x + 2).toFixed(1)}" y="${(y + cell - band - 2).toFixed(1)}" width="${(cell - 4).toFixed(1)}" height="${band.toFixed(1)}" fill="${ink}"/>`,
      );
    if (cellDef.side === 'left')
      parts.push(
        `<rect x="${(x + cell - band - 2).toFixed(1)}" y="${(y + 2).toFixed(1)}" width="${band.toFixed(1)}" height="${(cell - 4).toFixed(1)}" fill="${ink}"/>`,
      );
    if (cellDef.side === 'right')
      parts.push(
        `<rect x="${(x + 2).toFixed(1)}" y="${(y + 2).toFixed(1)}" width="${band.toFixed(1)}" height="${(cell - 4).toFixed(1)}" fill="${ink}"/>`,
      );
    const label = tr[`cell.${cellDef.index}.name`] ?? cellDef.slug;
    const rot = cellDef.side === 'left' ? -90 : cellDef.side === 'right' ? 90 : 0;
    const tx = x + cell / 2;
    const ty =
      cellDef.side === 'bottom'
        ? y + cell * 0.66
        : cellDef.side === 'top'
          ? y + cell * 0.42
          : y + cell / 2;
    parts.push(
      `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${rot} ${tx.toFixed(1)} ${ty.toFixed(1)})" font-family="${FONT}" font-size="${(cell * 0.115).toFixed(1)}" font-weight="600" fill="${css(INK)}" text-anchor="middle">${esc(label)}</text>`,
    );
    if (cellDef.price !== undefined) {
      const py =
        cellDef.side === 'bottom'
          ? y + cell * 0.8
          : cellDef.side === 'top'
            ? y + cell * 0.3
            : ty + cell * 0.14;
      parts.push(
        `<text x="${tx.toFixed(1)}" y="${py.toFixed(1)}" transform="rotate(${rot} ${tx.toFixed(1)} ${py.toFixed(1)})" font-family="${FONT}" font-size="${(cell * 0.095).toFixed(1)}" fill="${ink}" text-anchor="middle">${cellDef.price} ₡</text>`,
      );
    }
    parts.push('</g>');
  }
  const mid = size / 2;
  parts.push(
    `<circle cx="${mid}" cy="${mid}" r="${(size * 0.24).toFixed(1)}" fill="${css(tint(PARCHMENT, 0.5))}" stroke="${css(INK)}" stroke-width="6"/>`,
  );
  parts.push(
    `<circle cx="${mid}" cy="${mid}" r="${(size * 0.2).toFixed(1)}" fill="none" stroke="${css(GOLD)}" stroke-width="3"/>`,
  );
  parts.push(
    `<text x="${mid}" y="${mid - size * 0.045}" font-family="${FONT}" font-size="${(size * 0.055).toFixed(1)}" font-weight="700" letter-spacing="6" fill="${css(INK)}" text-anchor="middle">MÜLK TYCOON</text>`,
  );
  parts.push(
    `<text x="${mid}" y="${mid + size * 0.02}" font-family="${FONT}" font-size="${(size * 0.022).toFixed(1)}" letter-spacing="4" fill="${css(shade(PARCHMENT, 0.55))}" text-anchor="middle">ŞEHİR KUR · KİRA TOPLA · DAYAN</text>`,
  );
  parts.push(
    `<path d="M ${mid} ${mid + size * 0.05} l ${size * 0.06} ${size * 0.06} l ${-size * 0.06} ${size * 0.06} l ${-size * 0.06} ${-size * 0.06} z" fill="${css(hex('#B4552D'))}"/>`,
  );
  return svgDoc(size, size, parts.join('\n'));
}

/* ---------------------------------------------------------------------- tiles */
function tileGlyph(c: Canvas, type: string, cx: number, cy: number, s: number, ink: RGB): void {
  switch (type) {
    case 'start':
      c.polygon(
        [
          [cx - s, cy],
          [cx, cy - s * 0.8],
          [cx, cy + s * 0.8],
        ],
        ink,
      );
      c.polygon(
        [
          [cx, cy],
          [cx + s, cy - s * 0.8],
          [cx + s, cy + s * 0.8],
        ],
        shade(ink, 0.2),
      );
      break;
    case 'property':
      c.rect(cx - s * 0.8, cy - s * 0.1, s * 1.6, s * 1.1, ink);
      c.polygon(
        [
          [cx - s, cy - s * 0.1],
          [cx, cy - s],
          [cx + s, cy - s * 0.1],
        ],
        shade(ink, 0.25),
      );
      c.rect(cx - s * 0.15, cy + s * 0.35, s * 0.3, s * 0.65, CREAM);
      break;
    case 'transport':
      c.circle(cx, cy - s * 0.55, s * 0.22, ink);
      c.rect(cx - s * 0.09, cy - s * 0.5, s * 0.18, s * 1.2, ink);
      c.ring(cx, cy + s * 0.1, s * 0.7, s * 0.16, ink);
      c.rect(cx - s * 0.7, cy - s * 0.1, s * 1.4, s * 0.14, ink);
      break;
    case 'energy':
      c.polygon(
        [
          [cx + s * 0.1, cy - s],
          [cx - s * 0.6, cy + s * 0.15],
          [cx - s * 0.05, cy + s * 0.15],
          [cx - s * 0.2, cy + s],
          [cx + s * 0.65, cy - s * 0.2],
          [cx + s * 0.08, cy - s * 0.2],
        ],
        ink,
      );
      break;
    case 'tax':
      for (let i = 0; i < 3; i++) {
        c.circle(cx, cy + s * 0.5 - i * s * 0.35, s * 0.55 - i * 0.04 * s, tint(ink, i * 0.12));
        c.ring(cx, cy + s * 0.5 - i * s * 0.35, s * 0.55 - i * 0.04 * s, s * 0.07, shade(ink, 0.3));
      }
      break;
    case 'chance':
      c.polygon(
        [
          [cx, cy - s],
          [cx + s, cy],
          [cx, cy + s],
          [cx - s, cy],
        ],
        ink,
      );
      c.polygon(
        [
          [cx, cy - s * 0.45],
          [cx + s * 0.45, cy],
          [cx, cy + s * 0.45],
          [cx - s * 0.45, cy],
        ],
        CREAM,
      );
      break;
    case 'community':
      c.rect(cx - s * 0.85, cy - s * 0.35, s * 1.7, s * 1.2, ink);
      c.roundRect(cx - s * 0.85, cy - s * 0.75, s * 1.7, s * 0.5, s * 0.22, shade(ink, 0.25));
      c.rect(cx - s * 0.12, cy - s * 0.2, s * 0.24, s * 0.6, CREAM);
      break;
    case 'jail':
      c.rect(cx - s * 0.85, cy - s * 0.9, s * 1.7, s * 1.8, tint(ink, 0.15));
      for (let i = 0; i < 4; i++)
        c.rect(cx - s * 0.65 + i * s * 0.4, cy - s * 0.9, s * 0.16, s * 1.8, CREAM);
      break;
    case 'free-parking':
      c.ring(cx, cy, s * 0.85, s * 0.16, ink);
      c.rect(cx - s * 0.5, cy - s * 0.45, s * 0.2, s * 0.9, ink);
      c.circle(cx - s * 0.4, cy - s * 0.2, s * 0.28, ink);
      break;
    default:
      c.rect(cx - s * 0.8, cy - s * 0.8, s * 1.6, s * 1.6, tint(ink, 0.1));
      c.frame(cx - s * 0.8, cy - s * 0.8, s * 1.6, s * 1.6, CREAM, s * 0.12);
      c.polygon(
        [
          [cx - s * 0.4, cy],
          [cx + s * 0.4, cy],
          [cx, cy + s * 0.5],
        ],
        CREAM,
      );
  }
}

function tilePng(type: string, ink: RGB): Canvas {
  const W = 200;
  const H = 260;
  return Canvas.render(W, H, 3, (c) => {
    c.roundRect(6, 6, W - 12, H - 12, 14, CREAM);
    c.roundRect(6, 6, W - 12, 46, 14, ink);
    c.rect(6, 34, W - 12, 18, ink);
    c.frame(6, 6, W - 12, H - 12, INK, 3);
    tileGlyph(c, type, W / 2, 118, 42, ink);
    c.rect(30, 182, W - 60, 3, shade(CREAM, 0.4));
    c.rect(46, 196, W - 92, 3, shade(CREAM, 0.55));
    c.rect(46, 208, W - 92, 3, shade(CREAM, 0.55));
    c.rect(60, 226, W - 120, 3, shade(CREAM, 0.7));
    c.rect(24, 236, W - 48, 2, tint(ink, 0.4), 0.5);
  });
}

function tileSvg(type: string, ink: RGB, label: string): string {
  const W = 200;
  const H = 260;
  const parts = [
    `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="14" fill="${css(CREAM)}" stroke="${css(INK)}" stroke-width="3"/>`,
    `<path d="M20 6h160a14 14 0 0 1 14 14v26H6V20a14 14 0 0 1 14-14z" fill="${css(ink)}"/>`,
    `<text x="${W / 2}" y="36" font-family="${FONT}" font-size="17" font-weight="700" fill="${css(CREAM)}" text-anchor="middle" letter-spacing="1">${esc(label.toUpperCase())}</text>`,
    `<g transform="translate(${W / 2} 118)">`,
    glyphSvg(type, 42, ink),
    '</g>',
    `<line x1="30" y1="182" x2="${W - 30}" y2="182" stroke="${css(shade(CREAM, 0.4))}" stroke-width="3"/>`,
    `<line x1="46" y1="196" x2="${W - 46}" y2="196" stroke="${css(shade(CREAM, 0.55))}" stroke-width="3"/>`,
    `<line x1="46" y1="208" x2="${W - 46}" y2="208" stroke="${css(shade(CREAM, 0.55))}" stroke-width="3"/>`,
    `<line x1="60" y1="226" x2="${W - 60}" y2="226" stroke="${css(shade(CREAM, 0.7))}" stroke-width="3"/>`,
  ];
  return svgDoc(W, H, parts.join('\n'));
}

function glyphSvg(type: string, s: number, ink: RGB): string {
  const fill = css(ink);
  const dark = css(shade(ink, 0.25));
  switch (type) {
    case 'start':
      return `<path d="M${-s} 0L0 ${-s * 0.8}L0 ${s * 0.8}Z" fill="${fill}"/><path d="M0 0L${s} ${-s * 0.8}L${s} ${s * 0.8}Z" fill="${dark}"/>`;
    case 'property':
      return `<rect x="${-s * 0.8}" y="${-s * 0.1}" width="${s * 1.6}" height="${s * 1.1}" fill="${fill}"/><path d="M${-s} ${-s * 0.1}L0 ${-s}L${s} ${-s * 0.1}Z" fill="${dark}"/><rect x="${-s * 0.15}" y="${s * 0.35}" width="${s * 0.3}" height="${s * 0.65}" fill="${css(CREAM)}"/>`;
    case 'transport':
      return `<circle cx="0" cy="${-s * 0.55}" r="${s * 0.22}" fill="${fill}"/><rect x="${-s * 0.09}" y="${-s * 0.5}" width="${s * 0.18}" height="${s * 1.2}" fill="${fill}"/><path d="M${-s * 0.7} ${s * 0.1}a${s * 0.7} ${s * 0.7} 0 0 1 ${s * 1.4} 0" fill="none" stroke="${fill}" stroke-width="${s * 0.16}"/><rect x="${-s * 0.7}" y="${-s * 0.1}" width="${s * 1.4}" height="${s * 0.14}" fill="${fill}"/>`;
    case 'energy':
      return `<path d="M${s * 0.1} ${-s}L${-s * 0.6} ${s * 0.15}L${-s * 0.05} ${s * 0.15}L${-s * 0.2} ${s}L${s * 0.65} ${-s * 0.2}L${s * 0.08} ${-s * 0.2}Z" fill="${fill}"/>`;
    case 'tax':
      return [0, 1, 2]
        .map(
          (i) =>
            `<circle cx="0" cy="${s * 0.5 - i * s * 0.35}" r="${s * 0.55 - i * 0.04 * s}" fill="${css(tint(ink, i * 0.12))}" stroke="${css(shade(ink, 0.3))}" stroke-width="${s * 0.07}"/>`,
        )
        .join('');
    case 'chance':
      return `<path d="M0 ${-s}L${s} 0L0 ${s}L${-s} 0Z" fill="${fill}"/><path d="M0 ${-s * 0.45}L${s * 0.45} 0L0 ${s * 0.45}L${-s * 0.45} 0Z" fill="${css(CREAM)}"/>`;
    case 'community':
      return `<rect x="${-s * 0.85}" y="${-s * 0.35}" width="${s * 1.7}" height="${s * 1.2}" fill="${fill}"/><rect x="${-s * 0.85}" y="${-s * 0.75}" width="${s * 1.7}" height="${s * 0.5}" rx="${s * 0.22}" fill="${dark}"/><rect x="${-s * 0.12}" y="${-s * 0.2}" width="${s * 0.24}" height="${s * 0.6}" fill="${css(CREAM)}"/>`;
    case 'jail':
      return `<rect x="${-s * 0.85}" y="${-s * 0.9}" width="${s * 1.7}" height="${s * 1.8}" fill="${css(tint(ink, 0.15))}"/>${[
        0, 1, 2, 3,
      ]
        .map(
          (i) =>
            `<rect x="${-s * 0.65 + i * s * 0.4}" y="${-s * 0.9}" width="${s * 0.16}" height="${s * 1.8}" fill="${css(CREAM)}"/>`,
        )
        .join('')}`;
    case 'free-parking':
      return `<circle cx="0" cy="0" r="${s * 0.85}" fill="none" stroke="${fill}" stroke-width="${s * 0.16}"/><rect x="${-s * 0.5}" y="${-s * 0.45}" width="${s * 0.2}" height="${s * 0.9}" fill="${fill}"/><circle cx="${-s * 0.4}" cy="${-s * 0.2}" r="${s * 0.28}" fill="${fill}"/>`;
    default:
      return `<rect x="${-s * 0.8}" y="${-s * 0.8}" width="${s * 1.6}" height="${s * 1.6}" fill="${css(tint(ink, 0.1))}" stroke="${css(CREAM)}" stroke-width="${s * 0.12}"/><path d="M${-s * 0.4} 0L${s * 0.4} 0L0 ${s * 0.5}Z" fill="${css(CREAM)}"/>`;
  }
}

/* ------------------------------------------------------------ property cards */
function propertyCardPng(group: Group): Canvas {
  const W = 320;
  const H = 440;
  const ink = hex(group.color);
  return Canvas.render(W, H, 3, (c) => {
    c.roundRect(8, 8, W - 16, H - 16, 16, CREAM);
    c.frame(8, 8, W - 16, H - 16, INK, 3);
    c.roundRect(8, 8, W - 16, 108, 16, ink);
    c.rect(8, 90, W - 16, 26, ink);
    c.circle(W / 2, 74, 30, tint(ink, 0.25));
    c.ring(W / 2, 74, 30, 3, shade(ink, 0.3));
    c.rect(W / 2 - 10, 60, 20, 28, shade(ink, 0.35));
    c.rect(40, 136, W - 80, 4, shade(CREAM, 0.35));
    // rent ladder: bars grow with the tier
    for (let i = 0; i < 6; i++) {
      const y = 160 + i * 34;
      c.rect(38, y, 26 + i * 12, 8, tint(ink, 0.55 - i * 0.05));
      c.rect(150, y + 1, 60 + i * 12, 6, shade(CREAM, 0.25));
      c.rect(W - 96, y + 1, 58, 6, shade(CREAM, 0.15));
    }
    c.rect(38, 372, W - 76, 2, shade(CREAM, 0.4));
    c.rect(38, 386, W - 76, 22, tint(ink, 0.8));
    c.rect(38, 386, 6, 22, ink);
  });
}

function propertyCardSvg(group: Group, label: string, trName: string): string {
  const W = 320;
  const H = 440;
  const ink = hex(group.color);
  const rows = [trName, ...Array.from({ length: 6 }, (_, i) => `Kademe ${i + 1}`)];
  return svgDoc(
    W,
    H,
    [
      `<rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="16" fill="${css(CREAM)}" stroke="${css(INK)}" stroke-width="3"/>`,
      `<path d="M24 8h272a16 16 0 0 1 16 16v82H8V24A16 16 0 0 1 24 8z" fill="${css(ink)}"/>`,
      `<circle cx="${W / 2}" cy="74" r="30" fill="${css(tint(ink, 0.25))}" stroke="${css(shade(ink, 0.3))}" stroke-width="3"/>`,
      `<rect x="${W / 2 - 10}" y="60" width="20" height="28" fill="${css(shade(ink, 0.35))}"/>`,
      `<text x="${W / 2}" y="132" font-family="${FONT}" font-size="15" font-weight="700" letter-spacing="2" fill="${css(ink)}" text-anchor="middle">${esc(label.toUpperCase())}</text>`,
      rows
        .map(
          (row, i) =>
            `<text x="38" y="${168 + i * 34}" font-family="${FONT}" font-size="13" fill="${css(INK)}">${esc(row)}</text><line x1="196" y1="${164 + i * 34}" x2="${W - 38}" y2="${164 + i * 34}" stroke="${css(shade(CREAM, 0.35))}" stroke-width="2"/>`,
        )
        .join(''),
      `<rect x="38" y="386" width="${W - 76}" height="22" fill="${css(tint(ink, 0.8))}"/><rect x="38" y="386" width="6" height="22" fill="${css(ink)}"/>`,
      `<text x="${W - 46}" y="402" font-family="${FONT}" font-size="13" font-weight="700" fill="${css(shade(ink, 0.4))}" text-anchor="end">₡</text>`,
    ].join('\n'),
  );
}

/* ---------------------------------------------------------------- card backs */
function cardBackPng(base: RGB, accent: RGB): Canvas {
  const W = 360;
  const H = 520;
  return Canvas.render(W, H, 2, (c) => {
    c.roundRect(6, 6, W - 12, H - 12, 18, base);
    c.roundRect(16, 16, W - 32, H - 32, 14, shade(base, 0.08));
    c.frame(16, 16, W - 32, H - 32, accent, 3);
    for (let i = -H; i < W; i += 26) {
      c.line(i, 16, i + H, H - 16, 2, accent, 0.18);
      c.line(i, H - 16, i + H, 16, 2, accent, 0.1);
    }
    const mid = { x: W / 2, y: H / 2 };
    c.circle(mid.x, mid.y, 96, shade(base, 0.2), 0.85);
    c.ring(mid.x, mid.y, 96, 4, accent);
    c.polygon(
      [
        [mid.x, mid.y - 72],
        [mid.x + 72, mid.y],
        [mid.x, mid.y + 72],
        [mid.x - 72, mid.y],
      ],
      accent,
      0.9,
    );
    c.polygon(
      [
        [mid.x, mid.y - 44],
        [mid.x + 44, mid.y],
        [mid.x, mid.y + 44],
        [mid.x - 44, mid.y],
      ],
      tint(base, 0.6),
    );
    c.ring(mid.x, mid.y, 120, 2, accent, 0.5);
    for (const [x, y] of [
      [40, 40],
      [W - 40, 40],
      [40, H - 40],
      [W - 40, H - 40],
    ] as const) {
      c.circle(x, y, 10, accent, 0.8);
      c.ring(x, y, 16, 2, accent, 0.5);
    }
  });
}

function cardBackSvg(base: RGB, accent: RGB, title: string): string {
  const W = 360;
  const H = 520;
  return svgDoc(
    W,
    H,
    [
      `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="18" fill="${css(base)}"/>`,
      `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="14" fill="${css(shade(base, 0.08))}" stroke="${css(accent)}" stroke-width="3"/>`,
      `<defs><pattern id="lat" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="26" stroke="${css(accent)}" stroke-width="2" opacity="0.18"/></pattern></defs>`,
      `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="14" fill="url(#lat)"/>`,
      `<circle cx="${W / 2}" cy="${H / 2}" r="96" fill="${css(shade(base, 0.2))}" stroke="${css(accent)}" stroke-width="4"/>`,
      `<circle cx="${W / 2}" cy="${H / 2}" r="120" fill="none" stroke="${css(accent)}" stroke-width="2" opacity="0.5"/>`,
      `<path d="M${W / 2} ${H / 2 - 72}L${W / 2 + 72} ${H / 2}L${W / 2} ${H / 2 + 72}L${W / 2 - 72} ${H / 2}Z" fill="${css(accent)}"/>`,
      `<path d="M${W / 2} ${H / 2 - 44}L${W / 2 + 44} ${H / 2}L${W / 2} ${H / 2 + 44}L${W / 2 - 44} ${H / 2}Z" fill="${css(tint(base, 0.6))}"/>`,
      `<text x="${W / 2}" y="${H / 2 + 8}" font-family="${FONT}" font-size="22" font-weight="700" letter-spacing="3" fill="${css(shade(base, 0.35))}" text-anchor="middle">${esc(title)}</text>`,
      ...[
        [40, 40],
        [W - 40, 40],
        [40, H - 40],
        [W - 40, H - 40],
      ].map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="10" fill="${css(accent)}"/><circle cx="${x}" cy="${y}" r="16" fill="none" stroke="${css(accent)}" stroke-width="2" opacity="0.5"/>`,
      ),
    ].join('\n'),
  );
}

/* -------------------------------------------------------------------- money */
const NOTES: readonly { value: number; base: string; accent: string }[] = [
  { value: 1, base: '#7FA36B', accent: '#3E5C36' },
  { value: 5, base: '#C08A3E', accent: '#6B4A1E' },
  { value: 10, base: '#4E7FA8', accent: '#23465F' },
  { value: 50, base: '#8C5A8C', accent: '#4E2E4E' },
  { value: 100, base: '#B4552D', accent: '#632B14' },
  { value: 500, base: '#3E6B4F', accent: '#1E3A29' },
];

function notePng(note: (typeof NOTES)[number], pips: number): Canvas {
  const W = 360;
  const H = 160;
  const base = hex(note.base);
  const accent = hex(note.accent);
  return Canvas.render(W, H, 3, (c) => {
    c.roundRect(4, 4, W - 8, H - 8, 12, base);
    c.roundRect(14, 14, W - 28, H - 28, 8, tint(base, 0.18));
    c.frame(14, 14, W - 28, H - 28, accent, 3);
    for (let i = 0; i < 7; i++) c.ring(W / 2, H / 2, 22 + i * 8, 1.4, accent, 0.25);
    c.circle(W / 2, H / 2, 30, tint(base, 0.45));
    c.ring(W / 2, H / 2, 30, 3, accent);
    // denomination ladder: one pip per rung of the money ladder
    for (let i = 0; i < pips; i++) {
      c.roundRect(40 + i * 24, H - 46, 16, 22, 3, accent, 0.85);
    }
    for (const [x, y] of [
      [34, 34],
      [W - 34, 34],
      [34, H - 34],
      [W - 34, H - 34],
    ] as const) {
      c.ring(x, y, 9, 2, accent, 0.6);
    }
  });
}

function noteSvg(note: (typeof NOTES)[number], pips: number): string {
  const W = 360;
  const H = 160;
  const base = hex(note.base);
  const accent = hex(note.accent);
  return svgDoc(
    W,
    H,
    [
      `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="12" fill="${css(base)}"/>`,
      `<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="8" fill="${css(tint(base, 0.18))}" stroke="${css(accent)}" stroke-width="3"/>`,
      ...Array.from(
        { length: 7 },
        (_, i) =>
          `<circle cx="${W / 2}" cy="${H / 2}" r="${22 + i * 8}" fill="none" stroke="${css(accent)}" stroke-width="1.4" opacity="0.25"/>`,
      ),
      `<circle cx="${W / 2}" cy="${H / 2}" r="30" fill="${css(tint(base, 0.45))}" stroke="${css(accent)}" stroke-width="3"/>`,
      `<text x="${W / 2}" y="${H / 2 + 11}" font-family="${FONT}" font-size="26" font-weight="700" fill="${css(accent)}" text-anchor="middle">${note.value}</text>`,
      ...Array.from(
        { length: pips },
        (_, i) =>
          `<rect x="${40 + i * 24}" y="${H - 46}" width="16" height="22" rx="3" fill="${css(accent)}" opacity="0.85"/>`,
      ),
      ...[
        [34, 34],
        [W - 34, 34],
        [34, H - 34],
        [W - 34, H - 34],
      ].map(
        ([x, y]) =>
          `<circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${css(accent)}" stroke-width="2" opacity="0.6"/>`,
      ),
      `<text x="40" y="42" font-family="${FONT}" font-size="13" letter-spacing="2" fill="${css(accent)}">CHAMBLER</text>`,
      `<text x="${W - 40}" y="${H - 24}" font-family="${FONT}" font-size="13" fill="${css(accent)}" text-anchor="end">₡ ${note.value}</text>`,
    ].join('\n'),
  );
}

/* -------------------------------------------------------------------- pawns */
function pawnPng(color: RGB): Canvas {
  const S = 128;
  return Canvas.render(S, S, 3, (c) => {
    c.circle(S / 2, S / 2, S * 0.46, shade(color, 0.35));
    c.circle(S / 2, S / 2 - 2, S * 0.42, color);
    c.circle(S / 2 - S * 0.1, S / 2 - S * 0.12, S * 0.2, tint(color, 0.45), 0.8);
    c.ring(S / 2, S / 2, S * 0.42, 3, shade(color, 0.5));
    c.ring(S / 2, S / 2, S * 0.3, 2, tint(color, 0.5), 0.45);
    c.circle(S / 2, S / 2, S * 0.12, tint(color, 0.7));
  });
}

function pawnSvg(color: RGB, label: string): string {
  const S = 128;
  return svgDoc(
    S,
    S,
    [
      `<defs><radialGradient id="p" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="${css(tint(color, 0.55))}"/><stop offset="0.65" stop-color="${css(color)}"/><stop offset="1" stop-color="${css(shade(color, 0.45))}"/></radialGradient></defs>`,
      `<circle cx="${S / 2}" cy="${S / 2 + 2}" r="${S * 0.46}" fill="${css(shade(color, 0.45))}"/>`,
      `<circle cx="${S / 2}" cy="${S / 2}" r="${S * 0.42}" fill="url(#p)" stroke="${css(shade(color, 0.5))}" stroke-width="3"/>`,
      `<circle cx="${S / 2}" cy="${S / 2}" r="${S * 0.3}" fill="none" stroke="${css(tint(color, 0.5))}" stroke-width="2" opacity="0.45"/>`,
      `<circle cx="${S / 2}" cy="${S / 2}" r="${S * 0.12}" fill="${css(tint(color, 0.7))}"/>`,
      `<text x="${S / 2}" y="${S - 8}" font-family="${FONT}" font-size="11" fill="${css(tint(color, 0.85))}" text-anchor="middle">${esc(label)}</text>`,
    ].join('\n'),
  );
}

/* ---------------------------------------------------------------------- die */
function diePng(): Canvas {
  const S = 128;
  return Canvas.render(S, S, 3, (c) => {
    c.roundRect(14, 14, S - 28, S - 28, 18, CREAM);
    c.roundRect(14, 14, S - 28, S - 28, 18, tint(hex('#B4552D'), 0.75));
    c.roundRect(18, 18, S - 36, S - 36, 15, CREAM);
    c.frame(14, 14, S - 28, S - 28, INK, 3);
    const pips: readonly (readonly [number, number])[] = [
      [0.32, 0.28],
      [0.68, 0.28],
      [0.32, 0.5],
      [0.68, 0.5],
      [0.32, 0.72],
      [0.68, 0.72],
    ];
    for (const [px, py] of pips) {
      c.circle(S * px, S * py, 7, INK);
      c.circle(S * px - 1.5, S * py - 1.5, 2.5, tint(INK, 0.4), 0.7);
    }
  });
}

function dieSvg(): string {
  const S = 128;
  const pips: readonly (readonly [number, number])[] = [
    [0.32, 0.28],
    [0.68, 0.28],
    [0.32, 0.5],
    [0.68, 0.5],
    [0.32, 0.72],
    [0.68, 0.72],
  ];
  return svgDoc(
    S,
    S,
    [
      `<rect x="14" y="14" width="${S - 28}" height="${S - 28}" rx="18" fill="${css(tint(hex('#B4552D'), 0.75))}"/>`,
      `<rect x="18" y="18" width="${S - 36}" height="${S - 36}" rx="15" fill="${css(CREAM)}" stroke="${css(INK)}" stroke-width="3"/>`,
      ...pips.map(
        ([px, py]) =>
          `<circle cx="${(S * px).toFixed(1)}" cy="${(S * py).toFixed(1)}" r="7" fill="${css(INK)}"/>`,
      ),
      `<text x="${S / 2}" y="${S - 26}" font-family="${FONT}" font-size="11" fill="${css(shade(CREAM, 0.45))}" text-anchor="middle">d6</text>`,
    ].join('\n'),
  );
}

/* ---------------------------------------------------------------- label layer */
function labelLayerSvg(lang: 'tr' | 'en', dict: Record<string, string>): string {
  const size = BOARD;
  const cell = CW;
  const parts: string[] = [];
  for (const cellDef of board.cells) {
    const { x, y } = cellRect(cellDef, size);
    const label = dict[`cell.${cellDef.index}.name`] ?? cellDef.slug;
    const rot = cellDef.side === 'left' ? -90 : cellDef.side === 'right' ? 90 : 0;
    const tx = x + cell / 2;
    const ty =
      cellDef.side === 'bottom'
        ? y + cell * 0.66
        : cellDef.side === 'top'
          ? y + cell * 0.42
          : y + cell / 2;
    parts.push(
      `<g data-cell="${cellDef.index}" data-side="${cellDef.side}"><text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${rot} ${tx.toFixed(1)} ${ty.toFixed(1)})" font-family="${FONT}" font-size="${(cell * 0.115).toFixed(1)}" font-weight="600" fill="${css(INK)}" text-anchor="middle">${esc(label)}</text></g>`,
    );
  }
  return svgDoc(size, size, `<g id="labels-${lang}">\n${parts.join('\n')}\n</g>`);
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
  const seed = [...key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const buf = encodePng(canvas.grain(seed, 6));
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

// 1. board
emitPng('board-plate', 'board.png', drawBoardPlate(BOARD));
emitSvg('board-vector', 'board.svg', boardSvg(), BOARD, BOARD);

// 2. property card backgrounds (8 colour groups)
for (const group of groups) {
  const label = tr[`group.${group.id}.name`] ?? group.id;
  emitPng(`property-card-${group.id}`, `property-card-${group.id}.png`, propertyCardPng(group));
  emitSvg(
    `property-card-${group.id}-vector`,
    `property-card-${group.id}.svg`,
    propertyCardSvg(group, label, label),
    320,
    440,
  );
}

// 3. tile plates (10 cell types)
const tileTypes: readonly [string, RGB][] = [
  ['start', hex('#3E6B4F')],
  ['property', hex('#8A6B4A')],
  ['transport', HARBOUR],
  ['energy', ENERGY],
  ['tax', hex('#8C3B3B')],
  ['chance', hex('#C2456B')],
  ['community', hex('#2E8B8B')],
  ['jail', hex('#5A5A66')],
  ['free-parking', hex('#4F7A3A')],
  ['go-to-jail', hex('#7A3B3B')],
];
for (const [type, ink] of tileTypes) {
  const label = tr[`type.${type}`] ?? type;
  emitPng(`tile-${type}`, `tile-${type}.png`, tilePng(type, ink));
  emitSvg(`tile-${type}-vector`, `tile-${type}.svg`, tileSvg(type, ink, label), 200, 260);
}

// 4. card backs
const decks: readonly [string, RGB, RGB, string][] = [
  ['chance', hex('#7A2338'), hex('#E8C36A'), tr['deck.chance.name'] ?? 'Opportunity'],
  ['community', hex('#2E5F6B'), hex('#CFE3D8'), tr['deck.community.name'] ?? 'Community'],
];
for (const [id, base, accent, title] of decks) {
  emitPng(`card-back-${id}`, `card-back-${id}.png`, cardBackPng(base, accent));
  emitSvg(
    `card-back-${id}-vector`,
    `card-back-${id}.svg`,
    cardBackSvg(base, accent, title),
    360,
    520,
  );
}

// 5. currency notes (6 denominations)
NOTES.forEach((note, i) => {
  emitPng(`money-${note.value}`, `money-${note.value}.png`, notePng(note, i + 1));
  emitSvg(`money-${note.value}-vector`, `money-${note.value}.svg`, noteSvg(note, i + 1), 360, 160);
});

// 6. pawn colours (6 players)
const tokens = (
  JSON.parse(readFileSync(join(PACK, 'tokens/tokens.json'), 'utf8')) as {
    tokens: { id: string; color: string; nameKey: string }[];
  }
).tokens;
for (const token of tokens) {
  const color = hex(token.color);
  const label = tr[token.nameKey] ?? token.id;
  emitPng(token.id, `${token.id}.png`, pawnPng(color));
  emitSvg(`${token.id}-vector`, `${token.id}.svg`, pawnSvg(color, label), 128, 128);
}

// 7. die
emitPng('die-d6', 'die-d6.png', diePng());
emitSvg('die-d6-vector', 'die-d6.svg', dieSvg(), 128, 128);

// 8. localised cell label layers (40 labels each)
const en = JSON.parse(readFileSync(join(PACK, 'i18n/en.json'), 'utf8')) as Record<string, string>;
emitSvg('cell-labels-tr', 'cell-labels-tr.svg', labelLayerSvg('tr', tr), BOARD, BOARD);
emitSvg('cell-labels-en', 'cell-labels-en.svg', labelLayerSvg('en', en), BOARD, BOARD);

// 9. inventory
const index = {
  generator: 'scripts/generate-art.ts',
  note: 'All art is generated procedurally: vector sources in assets/svg, rasters encoded by the built-in PNG writer. No third-party images.',
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
