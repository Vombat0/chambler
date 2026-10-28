/**
 * A6 — InspectViewport: inspect paneli içindeki 2D içerik için zoom/pan matematiği.
 * Saf TS; DOM yok. Zoom 0.5x–4x ile sınırlıdır, pan içerik pudalanacak şekilde
 * sınırlıdır (içerik viewport'tan tamamen çıkmaz).
 */

export interface ViewportLimits {
  minZoom: number;
  maxZoom: number;
}

export const ZOOM_LIMITS: ViewportLimits = { minZoom: 0.5, maxZoom: 4 };

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export class InspectViewport {
  readonly limits: ViewportLimits;
  zoom: number;
  offsetX = 0;
  offsetY = 0;

  constructor(limits: Partial<ViewportLimits> = {}) {
    this.limits = { ...ZOOM_LIMITS, ...limits };
    this.zoom = 1;
  }

  /** reset() tam zoom/pan sıfırlar; yalnızca zoom'u sıfırlamak için setZoom(1). */
  reset(): void {
    this.zoom = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /**
   * Tekerleğe göre zoom. deltaY < 0 (yakınlaştır isteği) -> büyür.
   * Sınırlar ZOOM_LIMITS içinde tutulur; sınırda delta zoom'u değiştirmez.
   */
  wheel(deltaY: number): number {
    if (deltaY === 0) return this.setZoom(this.zoom);
    // Bir imsakiye: tekerlek adımı ~ %12'lik değişim; üstel ölçekfare olsun.
    const factor = Math.pow(1.12, Math.sign(deltaY) * -1);
    return this.setZoom(this.zoom * factor);
  }

  /**
   * Zoom'u mutlak değerle ayarlar. Sınır aşımlarında değeri kestirip döndürür;
   * içerik merkez pan ofsetleri (varsa) yeni zoom'a göre yeniden sıkıştırılır.
   */
  setZoom(z: number, contentW = 0, contentH = 0, viewW = 0, viewH = 0): number {
    const next = clamp(z, this.limits.minZoom, this.limits.maxZoom);
    if (next === this.zoom && !this.panClamped(contentW, contentH, viewW, viewH)) {
      // zoom değişmediyse pan sınırlarını zaten yeniden hesaplamaya gerek yok
      this.panClamp(contentW, contentH, viewW, viewH);
      return this.zoom;
    }
    this.zoom = next;
    this.panClamp(contentW, contentH, viewW, viewH);
    return this.zoom;
  }

  /** Pan ofsetlerini içerik görünürlüğüne göre sınırla; geçerli ofsetleri döndürür. */
  panBy(dx: number, dy: number, contentW: number, contentH: number, viewW: number, viewH: number): {
    x: number;
    y: number;
  } {
    this.offsetX += dx;
    this.offsetY += dy;
    this.panClamp(contentW, contentH, viewW, viewH);
    return { x: this.offsetX, y: this.offsetY };
  }

  panClamped(contentW: number, contentH: number, viewW: number, viewH: number): boolean {
    const maxX = this.maxPan(contentW, viewW);
    const maxY = this.maxPan(contentH, viewH);
    const before = { x: this.offsetX, y: this.offsetY };
    this.offsetX = clamp(this.offsetX, -maxX, maxX);
    this.offsetY = clamp(this.offsetY, -maxY, maxY);
    return before.x !== this.offsetX || before.y !== this.offsetY;
  }

  panClamp(contentW: number, contentH: number, viewW: number, viewH: number): void {
    void this.panClamped(contentW, contentH, viewW, viewH);
  }

  /** İçerik merkezinden izinli maksimum pan (px). İçerik view'dan küçükse 0. */
  maxPan(contentW: number, viewW: number): number {
    return Math.max(0, (contentW - viewW) / 2);
  }
}
