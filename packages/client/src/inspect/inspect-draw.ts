/**
 * A6 — inspect-draw: inspect paneli için yüksek çözünürlüklü 2D içerik üretimi.
 *
 * assets/ paketinde gerçek doku ayrılmış olabilir ama manifest yüklenmediği için
 * (assets klasörlerinin içleri boş) bilinçli olarak prosedürel çizim yapılır:
 * - kart: prosedürel yüz görseli (ad, tür, açıklama, çerçeve)
 * - tahta: üstten kesit + hücre ızgarası + slot adları
 * - karo: 4 kenar değeri + döndürme yönü okları
 * - token: yakın görünümde meta bilgisi
 * Hiçbir durumda boş beyaz panel üretilmez: hepsi arka plan + metin + biçim çizer.
 *
 * DOM gerekir (document.createElement('canvas')); sadece panel açıkken çağrılır.
 */

import type { InspectModel } from './inspect-model.js';
import { seededHue, wrapText } from './inspect-text.js';

export interface ContentSize {
  w: number;
  h: number;
}

export const CONTENT_SIZES: Record<string, ContentSize> = {
  card: { w: 720, h: 1080 },
  board: { w: 1280, h: 960 },
  tile: { w: 800, h: 800 },
  token: { w: 560, h: 560 },
};

export function inspectDrawTargets(kind: InspectModel['kind']): ContentSize | undefined {
  return CONTENT_SIZES[kind];
}

type Ctx = CanvasRenderingContext2D;

export function drawInspectContent(model: InspectModel): HTMLCanvasElement {
  const size = CONTENT_SIZES[model.kind] ?? { w: 640, h: 640 };
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas; // 2D ctx yoksa da boş olmayan DOM-'vücutla' panel overlay metinleriyle dolu kalır
  ctx.textBaseline = 'alphabetic';
  switch (model.kind) {
    case 'card':
      drawCard(ctx, model, size);
      break;
    case 'board':
      drawBoard(ctx, model, size);
      break;
    case 'tile':
      drawTile(ctx, model, size);
      break;
    case 'token':
    default:
      drawToken(ctx, model, size);
      break;
  }
  return canvas;
}

function base(ctx: Ctx, w: number, h: number, kinds: { bg: string; accent: string }): void {
  ctx.fillStyle = kinds.bg;
  ctx.fillRect(0, 0, w, h);
  // vignette doku: hızlı diyagonal çizgiler (prosedürel his)
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  for (let i = -h; i < w; i += 28) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + h, h);
    ctx.stroke();
  }
  ctx.restore();
  // signature: dört kenarda ince accent çerçeve
  ctx.strokeStyle = kinds.accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.lineWidth = 2;
  ctx.strokeRect(34, 34, w - 68, h - 68);
}

function drawHeader(ctx: Ctx, model: InspectModel, w: number, y: number): number {
  ctx.fillStyle = '#2b2016';
  ctx.textAlign = 'center';
  let fontY = y;
  ctx.font = '700 64px Georgia, serif';
  const nameLines = wrapText(model.name, 18, 2);
  for (const line of nameLines) {
    ctx.fillText(line, w / 2, fontY);
    fontY += 70;
  }
  ctx.font = '600 30px Georgia, serif';
  ctx.fillStyle = '#7a5b3a';
  ctx.fillText(model.typeLabel.toUpperCase(), w / 2, fontY + 34);
  fontY += 46;
  ctx.strokeStyle = '#a3815b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(80, fontY);
  ctx.lineTo(w - 80, fontY);
  ctx.stroke();
  return fontY;
}

function drawFooter(ctx: Ctx, model: InspectModel, w: number, h: number): void {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#4a3a26';
  ctx.font = '500 26px Georgia, serif';
  ctx.fillText(model.ownerLabel, w / 2, h - 64);
  ctx.font = '500 22px Georgia, serif';
  ctx.fillStyle = '#8a6b49';
  ctx.fillText(model.faceUp ? 'yüz: açık' : 'yüz: kapalı', w / 2, h - 28);
}

function drawCard(ctx: Ctx, model: InspectModel, { w, h }: ContentSize): void {
  const hue = seededHue(model.id);
  if (!model.faceUp) {
    // arka yüz: loş lauba desen + ortasına mühür
    base(ctx, w, h, { bg: '#5b2f2a', accent: '#3e1f1c' });
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#c9a06d';
    ctx.lineWidth = 3;
    for (let x = -h; x < w + h; x += 34) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + h, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#d9ba8b';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b1d19';
    ctx.font = '700 44px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('ARKA', w / 2, h / 2 + 14);
    ctx.font = '600 26px Georgia, serif';
    ctx.fillStyle = '#e7cfa5';
    ctx.fillText('bu kart yüzü kapalı', w / 2, h / 2 + 170);
    drawFooter(ctx, model, w, h);
    return;
  }
  base(ctx, w, h, { bg: '#f4ecd8', accent: `hsl(${hue} 45% 45%)` });
  const y = drawHeader(ctx, model, w, 110);
  // art band
  const artTop = y + 30;
  const artBottom = h - 320;
  const grad = ctx.createLinearGradient(80, artTop, w - 80, artBottom);
  grad.addColorStop(0, `hsl(${(hue + 30) % 360} 55% 62%)`);
  grad.addColorStop(1, `hsl(${hue} 60% 38%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(80, artTop, w - 160, artBottom - artTop);
  ctx.strokeStyle = 'rgba(43,32,22,0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(80, artTop, w - 160, artBottom - artTop);
  // emblem: seeded konum
  const ex = 80 + (((seededHue(`${model.id}:x`) / 360) * (w - 320)) | 0) + 120;
  const ey = artTop + (artBottom - artTop) * 0.55;
  ctx.beginPath();
  ctx.arc(ex, ey, 76, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,250,232,0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(43,32,22,0.5)';
  ctx.lineWidth = 5;
  ctx.stroke();
  // açıklama
  ctx.fillStyle = '#2b2016';
  ctx.font = '26px Georgia, serif';
  const descLines = wrapText(model.description, 46, 4);
  let dy = artBottom + 78;
  ctx.textAlign = 'center';
  for (const line of descLines) {
    ctx.fillText(line, w / 2, dy);
    dy += 38;
  }
  drawFooter(ctx, model, w, h);
}

function drawBoard(ctx: Ctx, model: InspectModel, { w, h }: ContentSize): void {
  base(ctx, w, h, { bg: '#8b5a2b', accent: '#4d2f15' });
  // üstten kesit başlığı
  ctx.fillStyle = '#3b2413';
  ctx.textAlign = 'center';
  ctx.font = '700 52px Georgia, serif';
  const titleLines = wrapText(model.name, 24, 1);
  ctx.fillText(titleLines[0] ?? 'Tahta', w / 2, 88);
  // hücre ızgarası: masa üstü ölçeği varsayımı (1 birim = 1 hücre)
  const cols = 8;
  const rows = 5;
  const gx = 70;
  const gy = 140;
  const cellW = (w - gx * 2) / cols;
  const cellH = (h - gy - 120) / rows;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  for (let c = 0; c <= cols; c++) {
    ctx.beginPath();
    ctx.moveTo(gx + c * cellW, gy);
    ctx.lineTo(gx + c * cellW, h - 120);
    ctx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    ctx.beginPath();
    ctx.moveTo(gx, gy + r * cellH);
    ctx.lineTo(w - gx, gy + r * cellH);
    ctx.stroke();
  }
  // slot noktaları ve adları
  ctx.font = '600 22px Georgia, serif';
  for (const slot of model.slots) {
    const sx = gx + (slot.x + 0.5) * cellW;
    const sy = gy + (slot.y + 0.5) * cellH;
    if (sx < gx || sx > w - gx || sy < gy || sy > h - 120) continue;
    ctx.beginPath();
    ctx.arc(sx, sy, 16, 0, Math.PI * 2);
    ctx.fillStyle = '#f2d98d';
    ctx.fill();
    ctx.strokeStyle = '#4d2f15';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#2b1a0c';
    ctx.textAlign = 'center';
    ctx.fillText(slot.id, sx, sy - 26);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#2b1a0c';
  ctx.font = '500 26px Georgia, serif';
  ctx.fillText(`${cols}×${rows} hücre · ${model.slots.length} slot · ${model.ownerLabel}`, w / 2, h - 70);
}

function drawTile(ctx: Ctx, model: InspectModel, { w, h }: ContentSize): void {
  base(ctx, w, h, { bg: '#d9c7a0', accent: '#6f5a36' });
  const e = model.edges ?? { north: '—', east: '—', south: '—', west: '—' };
  const rot = model.rotation % 360;
  // kenar değerleri
  const mid = w / 2;
  ctx.font = '700 44px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#3b2f1c';
  const put = (label: string, x: number, y: number) => ctx.fillText(label, x, y);
  put(`N=${String(e.north)}`, mid, 120);
  put(`E=${String(e.east)}`, w - 150, h / 2 + 15);
  put(`S=${String(e.south)}`, mid, h - 96);
  put(`W=${String(e.west)}`, 150, h / 2 + 15);
  // yön okları: döndürme yönü (rotation saatin tersinde mi? A5 konvansiyonu: saat yönü CW)
  const cx = mid;
  const cy = h / 2;
  ctx.strokeStyle = '#6f5a36';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, 170, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (rot / 360) + 0.001);
  ctx.stroke();
  // ok ucu: son açı boyunca
  const endAngle = -Math.PI / 2 + Math.PI * 2 * (rot / 360);
  const tipX = cx + Math.cos(endAngle) * 170;
  const tipY = cy + Math.sin(endAngle) * 170;
  ctx.beginPath();
  ctx.arc(tipX, tipY, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#6f5a36';
  ctx.fill();
  // merkez bilgis
  ctx.fillStyle = '#5d4a2a';
  ctx.font = '600 34px Georgia, serif';
  ctx.fillText(model.name, cx, cy - 10);
  ctx.font = '500 26px Georgia, serif';
  ctx.fillText(`döndürme: ${rot}° (saat yönü)`, cx, cy + 34);
  ctx.fillText(model.ownerLabel, cx, cy + 72);
  // pusula harfleri
  ctx.font = '700 28px monospace';
  ctx.fillText('N', cx, 70);
  ctx.fillText('E', w - 60, cy + 9);
  ctx.fillText('S', cx, h - 44);
  ctx.fillText('W', 60, cy + 9);
}

function drawToken(ctx: Ctx, model: InspectModel, { w, h }: ContentSize): void {
  const hue = seededHue(model.id);
  base(ctx, w, h, { bg: '#2b2b33', accent: '#c9a34a' });
  const cx = w / 2;
  const cy = (h - 110) / 2 + 20;
  const grad = ctx.createRadialGradient(cx - 60, cy - 60, 20, cx, cy, 190);
  grad.addColorStop(0, `hsl(${(hue + 40) % 360} 70% 66%)`);
  grad.addColorStop(1, `hsl(${hue} 65% 38%)`);
  ctx.beginPath();
  ctx.arc(cx, cy, 180, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#c9a34a';
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.arc(cx, cy, 152, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1d1810';
  ctx.font = '700 52px Georgia, serif';
  const labelLines = wrapText(model.tokenLabel ?? model.name, 14, 2);
  let ly = cy + (labelLines.length === 2 ? -6 : 16);
  for (const line of labelLines) {
    ctx.fillText(line, cx, ly);
    ly += 56;
  }
  // meta künyesi altta
  const entries = Object.entries(model.meta)
    .filter(([, v]) => typeof v !== 'object' && typeof v !== 'undefined')
    .slice(0, 5);
  ctx.fillStyle = '#cfc4a4';
  ctx.font = '500 26px Georgia, serif';
  let my = h - 96;
  ctx.fillText(model.name, cx, my);
  my += 34;
  ctx.font = '500 22px Georgia, serif';
  for (const [k, v] of entries) {
    ctx.fillText(`${k}: ${String(v)}`, cx, my);
    my += 28;
  }
}

export { wrapText };
