/**
 * A6 — InspectGesture: sağ tık (mouse) ve uzun basma (touch/pen) ile 2D inceleme
 * görünümünü tetikleyen durum makinesi.
 *
 * Kurallar (docs/INSPECT.md):
 * - Sağ tık basılıp sürüklenirse kamera orbiti devam eder; inspect AÇILMAZ.
 * - Sağ tık hareket etmeden bırakılırsa (hareket <= maxMovePx, süre <= maxHoldMs)
 *   inspect açılır.
 * - Touch/pen: basış longPressMs boyunca (hareket <= longPressMaxMovePx) tutulursa
 *   inspect açılır (long press); süre dolmadan hareket/düşme olursa iptal olur.
 *
 * Saf TS; DOM yok. Zaman ve zamanlayıcı enjekte edilir (testler senkron çalışır).
 */

export type GestureSource = 'right-click' | 'long-press';

export interface InspectTrigger {
  source: GestureSource;
  x: number;
  y: number;
}

export interface GesturePointerEvent {
  pointerId: number;
  pointerType: 'mouse' | 'touch' | 'pen' | string;
  button: number;
  x: number;
  y: number;
}

export interface GestureMoveEvent {
  pointerId: number;
  x: number;
  y: number;
}

export type GestureState = 'idle' | 'press' | 'long-fired';

export interface InspectGestureOptions {
  onInspect: (trigger: InspectTrigger) => void;
  /** Sağ tık için maksimum hareket (px) — bu kadar ya da altı "hareketsiz" sayılır. */
  maxMovePx?: number;
  /** Sağ tık için maksimum basılı tutma süresi (ms). */
  maxHoldMs?: number;
  /** Uzun basma eşiği (ms). */
  longPressMs?: number;
  /** Uzun basma için maksimum hareket (px). */
  longPressMaxMovePx?: number;
  /** Monotonik saat (varsayılan performance.now). */
  now?: () => number;
  /** (fn, ms) çalıştırır, iptal fonksiyonu döndürür. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export const DEFAULT_MAX_MOVE_PX = 4;
export const DEFAULT_MAX_HOLD_MS = 350;
export const DEFAULT_LONG_PRESS_MS = 500;
export const DEFAULT_LONG_PRESS_MAX_MOVE_PX = 10;

const defaultScheduler = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export class InspectGesture {
  private readonly opts: Required<Held<InspectGestureOptions>>;
  private state: GestureState = 'idle';
  private press: { id: number; type: 'mouse' | 'touch'; x: number; y: number; t: number; moved: boolean } | null =
    null;
  private cancelLong: (() => void) | null = null;

  constructor(opts: InspectGestureOptions) {
    this.opts = {
      onInspect: opts.onInspect,
      maxMovePx: opts.maxMovePx ?? DEFAULT_MAX_MOVE_PX,
      maxHoldMs: opts.maxHoldMs ?? DEFAULT_MAX_HOLD_MS,
      longPressMs: opts.longPressMs ?? DEFAULT_LONG_PRESS_MS,
      longPressMaxMovePx: opts.longPressMaxMovePx ?? DEFAULT_LONG_PRESS_MAX_MOVE_PX,
      now: opts.now ?? (() => performance.now()),
      schedule: opts.schedule ?? defaultScheduler,
    };
  }

  get currentState(): GestureState {
    return this.state;
  }

  pointerDown(e: GesturePointerEvent): void {
    // Zaten bir takip varken ikinci parmak/başka tuş -> niyet bozuldu.
    if (this.state !== 'idle') {
      this.cancel();
      return;
    }
    const isRightClick = e.pointerType === 'mouse' && e.button === 2;
    const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (!isRightClick && !isTouch) return;
    this.state = 'press';
    this.press = {
      id: e.pointerId,
      type: isRightClick ? 'mouse' : 'touch',
      x: e.x,
      y: e.y,
      t: this.opts.now(),
      moved: false,
    };
    if (isRightClick) return;
    this.cancelLong = this.opts.schedule(() => {
      this.cancelLong = null;
      if (this.state !== 'press' || !this.press || this.press.type === 'mouse') return;
      const press = this.press;
      if (press.moved) return;
      this.state = 'long-fired';
      this.opts.onInspect({ source: 'long-press', x: press.x, y: press.y });
    }, this.opts.longPressMs);
  }

  pointerMove(e: GestureMoveEvent): void {
    if (!this.press || e.pointerId !== this.press.id || this.state === 'long-fired') return;
    const limit =
      this.press.type === 'mouse' ? this.opts.maxMovePx : this.opts.longPressMaxMovePx;
    const dist = Math.hypot(e.x - this.press.x, e.y - this.press.y);
    if (dist > limit) {
      this.press.moved = true;
      // Drag başladı: uzun basma adayı iptal (orbit/sürükleme serbest).
      if (this.cancelLong) {
        this.cancelLong();
        this.cancelLong = null;
      }
    }
  }

  pointerUp(e: GestureMoveEvent): void {
    if (!this.press || e.pointerId !== this.press.id) return;
    const press = this.press;
    const wasRightMouse = press.type === 'mouse';
    this.press = null;
    this.state = 'idle';
    this.clearLongPending();
    void this.state;
    if (!wasRightMouse) return; // long-press tetikleme zamanlayıcıda yapıldı
    if (press.moved) return; // orbit devam etti
    const elapsed = this.opts.now() - press.t;
    if (elapsed <= this.opts.maxHoldMs) {
      this.opts.onInspect({ source: 'right-click', x: press.x, y: press.y });
    }
  }

  pointerCancel(): void {
    this.cancel();
  }

  cancel(): void {
    this.press = null;
    this.state = 'idle';
    this.clearLongPending();
  }

  private clearLongPending(): void {
    if (this.cancelLong) {
      this.cancelLong();
      this.cancelLong = null;
    }
  }
}

type Held<T> = { [K in keyof T]-?: NonNullable<T[K]> };
