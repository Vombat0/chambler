/**
 * V2 — Paket dokuları (PNG) için Vite tabanlı yükleyici + önbellek.
 *
 * `packs/<pack>/assets/*.png` dosyaları derleme zamanında URL olarak
 * bağlanır (`import.meta.glob(..., { eager: true, query: '?url' })`),
 * böylece çalışma anında ağ isteği / yol tahmini gerekmez. Dokular
 * `THREE.TextureLoader` ile bir kez yüklenip `TextureCache`'te tutulur;
 * tüm renk dokuları sRGB olarak işaretlenir.
 *
 * Test/SSR ortamında (DOM yok) `getPackTexture` `null` döner; çağıranlar
 * renkli yedek materyale düşer, böylece birim testleri DOM gerektirmez.
 */

import * as THREE from 'three';
import { buildCellGeometry } from '../board2d/boardGeometry.js';
import { BOARD_JSON, cellAccent, cellName } from '../board2d/boardData.js';

/* ------------------------------------------------------------------ */
/* Varlık URL indeksi                                                  */
/* ------------------------------------------------------------------ */

const assetModules = import.meta.glob('../../../../packs/*/assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Mantıksal varlık adı → dosya adı eşlemeleri (manifest ile sanat farkı). */
const ASSET_ALIASES: Readonly<Record<string, string>> = {
  'board-plate': 'board',
};

let assetIndex: Map<string, string> | null = null;

function buildIndex(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [path, url] of Object.entries(assetModules)) {
    if (typeof url !== 'string' || url.length === 0) continue;
    const match = /packs\/([^/]+)\/assets\/([^/]+)\.png$/.exec(path);
    if (!match) continue;
    const packId = match[1]!;
    const name = match[2]!;
    map.set(`${packId}/${name}`, url);
    if (!map.has(name)) map.set(name, url); // paket belirtilmemişse ilk bulunan
  }
  return map;
}

function index(): Map<string, string> {
  assetIndex ??= buildIndex();
  return assetIndex;
}

/** Kayıtlı tüm varlık adları (test/hata ayıklama için). */
export function packAssetNames(): string[] {
  return Array.from(new Set(Array.from(index().keys()).map((key) => key.split('/').pop()!))).sort();
}

/** Mantıksal varlık adını Vite URL'sine çözümler. */
export function packAssetUrl(assetRef: string, packId?: string): string | null {
  if (!assetRef) return null;
  const name = ASSET_ALIASES[assetRef] ?? assetRef;
  const table = index();
  if (packId) {
    const scoped = table.get(`${packId}/${name}`);
    if (scoped) return scoped;
  }
  const bare = table.get(name) ?? (ASSET_ALIASES[name] ? table.get(ASSET_ALIASES[name]!) : undefined);
  return bare ?? null;
}

/* ------------------------------------------------------------------ */
/* Doku önbelleği                                                      */
/* ------------------------------------------------------------------ */

export interface TextureOptions {
  /** Paket kimliği (aynı ada sahip varlıklar için öncelik). */
  readonly packId?: string;
  /** UV tekrarı (kırpma için de kullanılır). */
  readonly repeat?: { readonly x: number; readonly y: number };
  /** UV kaydırma. */
  readonly offset?: { readonly x: number; readonly y: number };
  /** Renk uzayı (varsayılan sRGB; normal/roughness için 'linear'). */
  readonly colorSpace?: 'srgb' | 'linear';
  /**
   * Saydam kenar boşluklarını otomatik kırp (varsayılan: repeat/offset
   * verilmemişse `true`). Paket PNG'leri sanatı tuvalin bir köşesine
   * küçük çizer; kırpma olmadan doku kenarda minicik kalır.
   */
  readonly trim?: boolean;
}

const textureCache = new Map<string, THREE.Texture>();
let textureLoader: THREE.TextureLoader | null = null;

function canUseTextures(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof (document as Document).createElementNS === 'function' &&
    typeof Image !== 'undefined'
  );
}

function cacheKey(assetRef: string, opts: TextureOptions): string {
  const repeat = opts.repeat ? `${opts.repeat.x}x${opts.repeat.y}` : '-';
  const offset = opts.offset ? `${opts.offset.x},${opts.offset.y}` : '-';
  return `${opts.packId ?? '*'}/${assetRef}/${repeat}/${offset}/${opts.colorSpace ?? 'srgb'}`;
}

/**
 * Görselin "gerçek sanat" dikdörtgenini bulur (piksel koordinatı, sol üst).
 *
 * Paket PNG'leri sanatı tuvalin sol üst köşesine 1/2 veya 1/3 ölçekte
 * çizer; gerisi saydamdır. Saydam maskeden satır/sütun kapsama oranına
 * bakarak sanat alanını buluruz (ince süs çizgileri eşiğin altında kalır).
 * Tamamen opak görsellerde (tahta) `null` döner.
 */
function contentRect(image: CanvasImageSource & { width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  const w = 'naturalWidth' in image ? (image as HTMLImageElement).naturalWidth : image.width;
  const h = 'naturalHeight' in image ? (image as HTMLImageElement).naturalHeight : image.height;
  if (!w || !h) return null;

  const sample = 192;
  const sw = Math.max(1, Math.min(sample, w));
  const sh = Math.max(1, Math.round((h / w) * sw));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, sw, sh);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, sw, sh).data;
  } catch {
    return null; // CORS/kirli tuval
  }

  const cols = new Uint32Array(sw);
  const rows = new Uint32Array(sh);
  let opaque = 0;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3]! > 32) {
        cols[x]!++;
        rows[y]!++;
        opaque++;
      }
    }
  }
  // Tamamen opak: kırpılacak saydam alan yok.
  if (opaque >= sw * sh * 0.995) return null;

  const colThreshold = Math.max(1, sh * 0.06);
  const rowThreshold = Math.max(1, sw * 0.06);
  const first = (values: Uint32Array, threshold: number): number => {
    for (let i = 0; i < values.length; i++) if (values[i]! >= threshold) return i;
    return -1;
  };
  const last = (values: Uint32Array, threshold: number): number => {
    for (let i = values.length - 1; i >= 0; i--) if (values[i]! >= threshold) return i;
    return -1;
  };

  const x0 = first(cols, colThreshold);
  const x1 = last(cols, colThreshold);
  const y0 = first(rows, rowThreshold);
  const y1 = last(rows, rowThreshold);
  if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0) return null;

  const scaleX = w / sw;
  const scaleY = h / sh;
  return {
    x: x0 * scaleX,
    y: y0 * scaleY,
    width: Math.min(w, (x1 + 1 - x0) * scaleX),
    height: Math.min(h, (y1 + 1 - y0) * scaleY),
  };
}

/** Kırpma dikdörtgenini UV tekrar/kaydırmasına çevirir. */
function applyTrim(texture: THREE.Texture, image: HTMLImageElement): void {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const rect = contentRect(image);
  if (!rect || w === 0 || h === 0) return;
  texture.repeat.set(rect.width / w, rect.height / h);
  // flipY = true: görselin üst kenarı v = 1'e karşılık gelir.
  texture.offset.set(rect.x / w, 1 - (rect.y + rect.height) / h);
  texture.needsUpdate = true;
}

/**
 * Paket PNG'sini doku olarak döndürür (önbellekli). Görsel henüz
 * çözülmemiş olsa da `THREE.Texture` hemen döner; yükleme bitince
 * `needsUpdate` ile sahneye yansır.
 */
export function getPackTexture(assetRef: string, opts: TextureOptions = {}): THREE.Texture | null {
  const url = packAssetUrl(assetRef, opts.packId);
  if (!url || !canUseTextures()) return null;

  const key = cacheKey(assetRef, opts);
  const cached = textureCache.get(key);
  if (cached) return cached;

  textureLoader ??= new THREE.TextureLoader();
  const texture = textureLoader.load(url);
  texture.colorSpace =
    opts.colorSpace === 'linear' ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  if (opts.repeat) texture.repeat.set(opts.repeat.x, opts.repeat.y);
  if (opts.offset) texture.offset.set(opts.offset.x, opts.offset.y);
  texture.anisotropy = 8;

  const trim = opts.trim ?? (!opts.repeat && !opts.offset);
  if (trim) {
    const loader = new THREE.ImageLoader();
    loader.load(url, (image) => applyTrim(texture, image));
  }

  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

/** Aynı varlık için birden fazla doku varyantını paylaşan yardımcı. */
export function hasPackTexture(assetRef: string): boolean {
  return packAssetUrl(assetRef) !== null;
}

/** Önbelleği boşaltır (paket değişimi / test izolasyonu). */
export function clearTextureCache(): void {
  for (const texture of textureCache.values()) texture.dispose();
  textureCache.clear();
  canvasTextures.clear();
  textureLoader = null;
}

/* ------------------------------------------------------------------ */
/* Prosedürel canvas dokuları                                          */
/* ------------------------------------------------------------------ */

const canvasTextures = new Map<string, THREE.Texture>();

/**
 * Canvas üzerine çizilen prosedürel dokular (zar yüzleri vb.) için
 * önbellekli `THREE.CanvasTexture` üretir. DOM yoksa `null`.
 */
export function getCanvasTexture(
  key: string,
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.Texture | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const cached = canvasTextures.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  canvasTextures.set(key, texture);
  return texture;
}

/* ------------------------------------------------------------------ */
/* Ahşap (tahta yanları)                                               */
/* ------------------------------------------------------------------ */

let woodTexture: THREE.Texture | null | undefined;

/**
 * Ceviz/mukavva damarı (prosedürel). Tahta ve kutu yanlarında kullanılır;
 * `RepeatWrapping` ile uzun kenarlarda tekrar eder.
 */
export function getWoodTexture(): THREE.Texture | null {
  if (woodTexture !== undefined) return woodTexture;
  const texture = getCanvasTexture('wood-walnut', 512, (ctx, size) => {
    const base = ctx.createLinearGradient(0, 0, size, size);
    base.addColorStop(0, '#3a2718');
    base.addColorStop(0.5, '#4a3220');
    base.addColorStop(1, '#2c1d11');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    // Damar çizgileri: hafif sinüs sapmalı, yarı saydam koyu/açık bantlar.
    for (let i = 0; i < 46; i++) {
      const y = (i / 46) * size + Math.sin(i * 1.7) * 6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) {
        const wobble = Math.sin((x / size) * Math.PI * 2 + i) * (4 + (i % 5));
        ctx.lineTo(x, y + wobble);
      }
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(20, 12, 6, 0.35)' : 'rgba(120, 88, 58, 0.16)';
      ctx.lineWidth = 1 + (i % 3) * 0.8;
      ctx.stroke();
    }

    // İnce düğüm noktaları (doğal görünüm).
    for (let k = 0; k < 3; k++) {
      const cx = size * (0.2 + k * 0.3);
      const cy = size * (0.35 + ((k * 7) % 5) * 0.09);
      const knot = ctx.createRadialGradient(cx, cy, 1, cx, cy, size * 0.045);
      knot.addColorStop(0, 'rgba(18, 10, 5, 0.55)');
      knot.addColorStop(1, 'rgba(18, 10, 5, 0)');
      ctx.fillStyle = knot;
      ctx.beginPath();
      ctx.ellipse(cx, cy, size * 0.07, size * 0.028, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  if (texture) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 1);
  }
  woodTexture = texture;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Dokusuz tahtalar için zarif yedek yüzey                             */
/* ------------------------------------------------------------------ */

let parchmentTexture: THREE.Texture | null | undefined;

/** Paket görseli olmayan tahtalar için parşömen + ızgara yüzeyi. */
export function getParchmentBoardTexture(): THREE.Texture | null {
  if (parchmentTexture !== undefined) return parchmentTexture;
  parchmentTexture = getCanvasTexture('board-parchment', 1024, (ctx, size) => {
    const grad = ctx.createRadialGradient(
      size * 0.5,
      size * 0.45,
      size * 0.05,
      size * 0.5,
      size * 0.5,
      size * 0.75,
    );
    grad.addColorStop(0, '#efe4c9');
    grad.addColorStop(0.75, '#e2d3b0');
    grad.addColorStop(1, '#cbb98f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // İnce ızgara (hücre hissi).
    const cells = 10;
    ctx.strokeStyle = 'rgba(96, 74, 44, 0.22)';
    ctx.lineWidth = 2;
    for (let i = 1; i < cells; i++) {
      const p = (i / cells) * size;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
    // Çerçeve.
    ctx.strokeStyle = 'rgba(72, 52, 30, 0.6)';
    ctx.lineWidth = size * 0.012;
    ctx.strokeRect(size * 0.018, size * 0.018, size * 0.964, size * 0.964);
    ctx.strokeStyle = 'rgba(200, 168, 104, 0.7)';
    ctx.lineWidth = size * 0.004;
    ctx.strokeRect(size * 0.034, size * 0.034, size * 0.932, size * 0.932);
  });
  return parchmentTexture;
}

/* ------------------------------------------------------------------ */
/* Dokusuz kart / kutu / para için zarif yedek yüzeyler                 */
/* ------------------------------------------------------------------ */

export interface CardFaceSpec {
  /** Üst şerit başlığı (kart adı). */
  readonly title: string;
  /** Şerit rengi (grup rengi). */
  readonly color: string;
  /** Küçük üst etiket (tür). */
  readonly eyebrow?: string;
  /** Gövde satırları (açıklama). */
  readonly body?: readonly string[];
  /** Alt sağ köşe (fiyat / değer). */
  readonly badge?: string;
}

/** Prosedürel kart ön yüzü (başlık şeridi + açıklama satırları + çerçeve). */
export function getCardFaceTexture(key: string, spec: CardFaceSpec): THREE.Texture | null {
  return getCanvasTexture(`card-face-${key}`, 512, (ctx, size) => {
    const w = size;
    const h = size;
    // Kâğıt zemin
    const paper = ctx.createLinearGradient(0, 0, w, h);
    paper.addColorStop(0, '#fdfaf1');
    paper.addColorStop(1, '#f1e8d4');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);

    // Renkli üst şerit
    ctx.fillStyle = spec.color;
    ctx.fillRect(0, 0, w, h * 0.19);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, 0, w, h * 0.045);

    // Tür etiketi
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `600 ${Math.round(h * 0.045)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'left';
    if (spec.eyebrow) ctx.fillText(spec.eyebrow.toUpperCase(), w * 0.07, h * 0.075);

    // Başlık
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(h * 0.075)}px ui-serif, Georgia, serif`;
    wrapText(ctx, spec.title, w * 0.07, h * 0.155, w * 0.86, h * 0.085, 2);

    // Gövde
    ctx.fillStyle = '#3c342a';
    ctx.font = `400 ${Math.round(h * 0.042)}px ui-sans-serif, system-ui, sans-serif`;
    let y = h * 0.32;
    for (const line of spec.body ?? []) {
      const drawn = wrapText(ctx, line, w * 0.075, y, w * 0.85, h * 0.062, 3);
      y = drawn + h * 0.035;
      if (y > h * 0.82) break;
    }

    // Alt rozet (fiyat)
    if (spec.badge) {
      ctx.fillStyle = spec.color;
      roundRect(ctx, w * 0.62, h * 0.87, w * 0.3, h * 0.085, h * 0.02);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(h * 0.05)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(spec.badge, w * 0.77, h * 0.932);
    }

    // Çerçeve
    ctx.strokeStyle = 'rgba(80, 64, 42, 0.45)';
    ctx.lineWidth = w * 0.012;
    ctx.strokeRect(w * 0.012, h * 0.012, w * 0.976, h * 0.976);
  });
}

/** Prosedürel kutu/hücre yüzü (kenar şeridi + etiket). */
export function getTileFaceTexture(key: string, label: string, color: string): THREE.Texture | null {
  return getCanvasTexture(`tile-face-${key}`, 512, (ctx, size) => {
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#f7f1e0');
    grad.addColorStop(1, '#e6dcc4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size * 0.14);

    ctx.fillStyle = '#2f2a22';
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(size * 0.1)}px ui-serif, Georgia, serif`;
    wrapText(ctx, label, size * 0.5, size * 0.5, size * 0.78, size * 0.115, 3, 'center');

    ctx.strokeStyle = 'rgba(70, 56, 36, 0.5)';
    ctx.lineWidth = size * 0.014;
    ctx.strokeRect(size * 0.014, size * 0.014, size * 0.972, size * 0.972);
  });
}

/** Prosedürel para/bilet yüzü (değer + renkli çerçeve). */
export function getMoneyFaceTexture(key: string, label: string, color: string): THREE.Texture | null {
  return getCanvasTexture(`money-face-${key}`, 256, (ctx, size) => {
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, '#fbf3d8');
    grad.addColorStop(1, '#e8d9a6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.05;
    ctx.strokeRect(size * 0.06, size * 0.06, size * 0.88, size * 0.88);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = size * 0.015;
    ctx.strokeRect(size * 0.12, size * 0.12, size * 0.76, size * 0.76);

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(size * 0.3)}px ui-serif, Georgia, serif`;
    ctx.fillText(label, size * 0.5, size * 0.58);
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Metni verilen genişliğe göre satırlara böler; son satırın altını döndürür. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
  align: CanvasTextAlign = 'left',
): number {
  ctx.textAlign = align;
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) {
        // Son satır: kalanı "…" ile kırp.
        let rest = words.slice(i).join(' ');
        while (rest.length > 1 && ctx.measureText(`${rest}…`).width > maxWidth) {
          rest = rest.slice(0, -1);
        }
        lines.push(`${rest}…`);
        line = '';
        break;
      }
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  let cy = y;
  for (const entry of lines) {
    ctx.fillText(entry, x, cy);
    cy += lineHeight;
  }
  return cy;
}

/* ------------------------------------------------------------------ */
/* Mülk Tycoon: 40 hücreli, isim/fiyat yazılı tahta yüzeyi             */
/* ------------------------------------------------------------------ */

let tycoonBoardTexture: THREE.Texture | null | undefined;

/**
 * Mülk Tycoon tahta yüzeyi.
 *
 * `board/board.json` hücre geometrisi (11×11 çevre, 40 hücre) ve paket
 * i18n'inden isimler, grup renkleri ve fiyatlar çizilir; ortasına paketin
 * `board.png` merkez rozetini yerleştirilir. Böylece masada hücre adları
 * ve fiyatlar net okunur (paket PNG'si yalnızca renk şeritlerini taşır).
 */
export function getPropertyTycoonBoardTexture(): THREE.Texture | null {
  if (tycoonBoardTexture !== undefined) return tycoonBoardTexture;
  if (typeof document === 'undefined') {
    tycoonBoardTexture = null;
    return null;
  }

  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    tycoonBoardTexture = null;
    return null;
  }
  drawTycoonBoard(ctx, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  // Paket merkez rozeti: board.png tuvalin sol-üst yarısındaki tahta sanatı.
  const url = packAssetUrl('board-plate', 'property-tycoon');
  if (url) {
    new THREE.ImageLoader().load(url, (image) => {
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      // Sanat, tuvalin sol-üst karesinde (kenar boşluğu saydam).
      const art = Math.min(w, h) / 2;
      // Yalnızca ortadaki amblem (yön okları + elmas) — hücreler tekrar etmez.
      const srcSize = art * 0.46;
      const src = art / 2 - srcSize / 2;
      const inner = size * 0.44;
      const dy = size * 0.36 - inner / 2;
      ctx.drawImage(image, src, src, srcSize, srcSize, (size - inner) / 2, dy, inner, inner);
      texture.needsUpdate = true;
    });
  }

  tycoonBoardTexture = texture;
  return texture;
}

function drawTycoonBoard(ctx: CanvasRenderingContext2D, size: number): void {
  const unit = size / 1000; // board birimi → piksel
  const cell = size / 11;

  // Parşömen zemin
  const bg = ctx.createRadialGradient(size * 0.5, size * 0.45, size * 0.08, size * 0.5, size * 0.5, size * 0.78);
  bg.addColorStop(0, '#f6efdc');
  bg.addColorStop(0.7, '#ecdfc2');
  bg.addColorStop(1, '#d9c69d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Dış çerçeve (mürekkep + altın)
  ctx.strokeStyle = 'rgba(48, 38, 26, 0.9)';
  ctx.lineWidth = 6 * unit;
  ctx.strokeRect(5 * unit, 5 * unit, size - 10 * unit, size - 10 * unit);
  ctx.strokeStyle = 'rgba(186, 146, 74, 0.95)';
  ctx.lineWidth = 2.4 * unit;
  ctx.strokeRect(11 * unit, 11 * unit, size - 22 * unit, size - 22 * unit);

  // Orta alan (logo rozeti için zemin)
  ctx.fillStyle = 'rgba(255, 252, 243, 0.55)';
  ctx.fillRect(cell, cell, size - 2 * cell, size - 2 * cell);
  ctx.strokeStyle = 'rgba(150, 122, 76, 0.55)';
  ctx.lineWidth = 2 * unit;
  ctx.strokeRect(cell, cell, size - 2 * cell, size - 2 * cell);

  // Başlık (orta alanın altında)
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(58, 46, 32, 0.82)';
  ctx.font = `700 ${Math.round(size * 0.045)}px ui-serif, Georgia, serif`;
  ctx.fillText('MÜLK TYCOON', size / 2, size * 0.78);
  ctx.fillStyle = 'rgba(150, 118, 64, 0.9)';
  ctx.font = `500 ${Math.round(size * 0.019)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText('CHAMBLER EDITION', size / 2, size * 0.82);
  ctx.restore();

  const cells = buildCellGeometry(BOARD_JSON.cells);
  for (const geometry of cells) {
    const x = geometry.x * unit;
    const y = geometry.y * unit;
    const w = geometry.w * unit;
    const h = geometry.h * unit;
    const accent = cellAccent(geometry);
    const name = cellName(geometry, 'tr');
    const isCorner = geometry.type !== 'property' && geometry.side !== undefined && isCornerCell(geometry.index);

    // Hücre yüzü
    ctx.fillStyle = isCorner ? '#f2ead8' : '#fbf6e8';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.strokeStyle = 'rgba(40, 32, 22, 0.75)';
    ctx.lineWidth = 1.6 * unit;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    // Renk şeridi (tahta merkezine bakan kenar)
    const band = Math.max(10 * unit, h * 0.17);
    ctx.fillStyle = accent;
    switch (geometry.side) {
      case 'bottom':
        ctx.fillRect(x + 2, y + 2, w - 4, band);
        break;
      case 'top':
        ctx.fillRect(x + 2, y + h - band - 2, w - 4, band);
        break;
      case 'left':
        ctx.fillRect(x + w - band - 2, y + 2, band, h - 4);
        break;
      case 'right':
        ctx.fillRect(x + 2, y + 2, band, h - 4);
        break;
    }

    // İsim ve fiyat: kenara göre döndürülür (hepsi tahtaya göre okunur).
    const nameSize = Math.round(h * 0.135);
    const priceSize = Math.round(h * 0.12);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    if (geometry.side === 'left') ctx.rotate(-Math.PI / 2);
    else if (geometry.side === 'right') ctx.rotate(Math.PI / 2);
    else if (geometry.side === 'top') ctx.rotate(Math.PI);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxTextWidth = h * 0.62;
    ctx.fillStyle = '#241d14';
    ctx.font = `600 ${nameSize}px ui-sans-serif, system-ui, sans-serif`;
    drawFittedLines(ctx, name, 0, -h * 0.06, maxTextWidth, nameSize * 1.12, 3);

    if (typeof geometry.price === 'number') {
      ctx.fillStyle = accent;
      ctx.font = `700 ${priceSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(`₡${geometry.price}`, 0, h * 0.28);
    } else if (geometry.type === 'start' || geometry.type === 'jail' || geometry.type === 'free-parking') {
      ctx.fillStyle = accent;
      ctx.font = `700 ${priceSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText('★', 0, h * 0.28);
    }
    ctx.restore();
  }
}

const CORNERS = new Set([0, 10, 20, 30]);

function isCornerCell(index: number): boolean {
  return CORNERS.has(index);
}

/** Metni hücre genişliğine sığdırır; en fazla `maxLines` satır (kırpar). */
function drawFittedLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) {
        let rest = words.slice(i).join(' ');
        while (rest.length > 1 && ctx.measureText(`${rest}…`).width > maxWidth) rest = rest.slice(0, -1);
        lines.push(`${rest}…`);
        line = '';
        break;
      }
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  let y = cy - ((lines.length - 1) * lineHeight) / 2;
  for (const entry of lines) {
    ctx.fillText(entry, cx, y);
    y += lineHeight;
  }
}

/** Testlerin DOM olmadan çalışması için görünürlük kontrolü. */
export const texturesAvailable = canUseTextures;
