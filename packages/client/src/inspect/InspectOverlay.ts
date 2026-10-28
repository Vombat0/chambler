/**
 * A6 — InspectOverlay: 3D sahnenin üzerine gelen yarı saydam DOM panel.
 *
 * Etkileşim: tekerlek ile 0.5x–4x zoom, sürükleyerek gezinme, ok tuşları ile
 * gezinme, Esc / panel dışına tıklama / kapat butonu ile kapatma.
 * Erişilebilirlik: role="dialog" + aria-modal + aria-label, panel açıldığında
 * odak panele gider, Tab odak tuzağı içinde kalır, kapanınca önceki elemana döner.
 *
 * Saf DOM; styles.css'e dokunmaz (panel stilleri inline).
 */

import type { InspectModel } from './inspect-model.js';
import { metaSummary } from './inspect-model.js';
import { inspectDrawTargets } from './inspect-draw.js';
import { InspectPanelModel, type KeyInput } from './InspectPanelModel.js';

export type CloseReason = 'escape' | 'outside' | 'button';

export interface InspectOverlayOptions {
  onClose?: (reason: CloseReason) => void;
}

export interface OpenArgs {
  model: InspectModel;
  content: HTMLCanvasElement;
}

export class InspectOverlay {
  readonly panelModel = new InspectPanelModel();
  isOpen = false;

  private root: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private viewportEl: HTMLDivElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private focusable: HTMLElement[] = [];
  private previousFocus: HTMLElement | null = null;
  private model: InspectModel | null = null;
  private fitScale = 1;
  private dragging = false;
  private lastDrag = { x: 0, y: 0 };

  private readonly onKeyDownDoc = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    const input: KeyInput = { key: e.key, shiftKey: e.shiftKey };
    const action = this.panelModel.keydown(input);
    if (action === 'close') {
      e.preventDefault();
      this.close('escape');
      return;
    }
    if (typeof action !== 'string') {
      e.preventDefault();
      if (action.type === 'pan') {
        this.panBy(action.dx, action.dy);
      } else {
        const idx = this.focusIndex();
        const next = this.panelModel.nextFocusIndex(idx, this.focusable.length, action.prev);
        this.focusable[next]?.focus();
      }
    }
  };

  private readonly onWheelView = (e: WheelEvent): void => {
    if (!this.isOpen || !this.viewportEl || !this.canvasEl) return;
    e.preventDefault();
    this.panelModel.viewport.wheel(e.deltaY);
    this.applyTransform();
  };

  private readonly onPointerDownView = (e: PointerEvent): void => {
    if (!this.isOpen || e.button !== 0) return;
    this.dragging = true;
    this.lastDrag = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };

  private readonly onPointerMoveView = (e: PointerEvent): void => {
    if (!this.isOpen || !this.dragging) return;
    const dx = e.clientX - this.lastDrag.x;
    const dy = e.clientY - this.lastDrag.y;
    this.lastDrag = { x: e.clientX, y: e.clientY };
    this.panBy(dx, dy);
    e.stopPropagation();
  };

  private readonly onPointerUpView = (e: PointerEvent): void => {
    this.dragging = false;
    (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
  };

  private readonly onPointerDownRoot = (e: PointerEvent): void => {
    if (!this.isOpen) return;
    // Sadece arka plana (panel dışına) tıklamalar kapatır.
    if (e.target !== this.root) return;
    this.close('outside');
  };

  constructor(private readonly opts: InspectOverlayOptions = {}) {}

  open(args: OpenArgs): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.model = args.model;
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.panelModel.viewport.reset();

    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;z-index:9000;background:rgba(10,12,16,0.62);display:flex;align-items:center;justify-content:center';
    root.textContent = '';

    const panel = document.createElement('div');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', `${args.model.name} yakın görünümü`);
    panel.style.cssText = `background:#f4ecd8;color:#2b2016;border:4px solid #6f5a36;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,0.55);padding:14px 18px;display:flex;flex-direction:column;gap:10px;max-width:92vw;max-height:88vh;`;

    // header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:baseline;gap:12px;color:#2b2016';
    const title = document.createElement('h3');
    title.id = 'inspect-title';
    title.textContent = args.model.name;
    title.style.cssText = 'margin:0;font:700 22px Georgia,serif;color:#2b2016';
    const kindBadge = document.createElement('span');
    kindBadge.textContent = args.model.kind;
    kindBadge.style.cssText = 'font:600 13px Georgia,serif;background:#6f5a36;color:#f4ecd8;border-radius:8px;padding:2px 10px';
    const owner = document.createElement('span');
    owner.textContent = args.model.ownerLabel;
    owner.style.cssText = 'font:500 13px Georgia,serif;color:#7a5b3a';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Kapat (Esc)');
    closeBtn.style.cssText = 'margin-left:auto;font:600 15px Georgia,serif;border:2px solid #6f5a36;background:#e6d5b5;color:#2b2016;border-radius:8px;padding:4px 10px;cursor:pointer';
    closeBtn.addEventListener('click', () => {
      this.close('button');
    });
    header.append(title, kindBadge, owner, closeBtn);
    panel.setAttribute('aria-labelledby', 'inspect-title');

    // viewport (canvas container)
    const viewport = document.createElement('div');
    viewport.style.cssText =
      'position:relative;overflow:hidden;background:#241a10;border-radius:10px;width:min(62vw,760px);height:min(56vh,640px);touch-action:none;user-select:none;-webkit-user-select:none;';
    const canvasEl = args.content;
    canvasEl.style.cssText = 'position:absolute;left:50%;top:50%;transform-origin:center;pointer-events:none;will-change:transform;';
    viewport.append(canvasEl);

    // footer: meta + hint
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    const metaLine = document.createElement('span');
    metaLine.textContent = metaSummary(args.model);
    metaLine.style.cssText = 'font:500 13px Georgia,serif;color:#6b5233';
    const hint = document.createElement('span');
    hint.textContent = 'tekerlek: yakınlaştır (0.5–4x) · sürükle veya ok tuşları: gezin · Esc: kapat';
    hint.style.cssText = 'font:500 12px Georgia,serif;color:#9a7d55';
    footer.append(metaLine, hint);

    panel.append(header, viewport, footer);
    root.append(panel);
    document.body.append(root);

    this.root = root;
    this.panel = panel;
    this.viewportEl = viewport;
    this.canvasEl = canvasEl;

    // listeners
    panel.addEventListener('pointerdown', (e) => e.stopPropagation()); // kök 'outside' tıkını engelle
    document.addEventListener('keydown', this.onKeyDownDoc);
    viewport.addEventListener('wheel', this.onWheelView, { passive: false });
    viewport.addEventListener('pointerdown', this.onPointerDownView);
    viewport.addEventListener('pointermove', this.onPointerMoveView);
    viewport.addEventListener('pointerup', this.onPointerUpView);
    viewport.addEventListener('pointercancel', this.onPointerUpView);
    root.addEventListener('pointerdown', this.onPointerDownRoot);

    // focusable koleksiyonu: kapat butonu + panel (kbd navigasyon için)
    this.focusable = Array.from(panel.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])'));
    this.layout();
    closeBtn.focus(); // panel açıldığında odak panele gider
  }

  close(reason: CloseReason): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    document.removeEventListener('keydown', this.onKeyDownDoc);
    if (this.viewportEl) {
      this.viewportEl.removeEventListener('wheel', this.onWheelView);
      this.viewportEl.removeEventListener('pointerdown', this.onPointerDownView);
      this.viewportEl.removeEventListener('pointermove', this.onPointerMoveView);
      this.viewportEl.removeEventListener('pointerup', this.onPointerUpView);
      this.viewportEl.removeEventListener('pointercancel', this.onPointerUpView);
    }
    this.root?.removeEventListener('pointerdown', this.onPointerDownRoot);
    this.root?.remove();
    this.canvasEl?.style.setProperty('transform', '');
    this.canvasEl = null;
    this.root = null;
    this.panel = null;
    this.viewportEl = null;
    this.focusable = [];
    const prev = this.previousFocus;
    this.previousFocus = null;
    this.model = null;
    prev?.focus?.(); // kapanınca odak geri döner
    this.opts.onClose?.(reason);
  }

  /** Ünite-integration testlerinde beklenen içerik başlığı için. */
  get title(): string | null {
    return this.model?.name ?? null;
  }

  dispose(): void {
    if (this.isOpen) this.close('button');
  }

  private focusIndex(): number {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return -1;
    const idx = this.focusable.indexOf(active);
    return idx >= 0 ? idx : -1;
  }

  private layout(): void {
    if (!this.viewportEl || !this.canvasEl || !this.model) return;
    const contentSize = inspectDrawTargets(this.model.kind) ?? { w: 640, h: 640 };
    const vw = this.viewportEl.clientWidth || 480;
    const vh = this.viewportEl.clientHeight || 400;
    const pad = 24;
    this.fitScale = Math.min((vw - pad) / contentSize.w, (vh - pad) / contentSize.h, 1);
    this.applyTransform();
  }

  private panBy(dx: number, dy: number): void {
    if (!this.viewportEl || !this.canvasEl || !this.model) return;
    const contentSize = inspectDrawTargets(this.model.kind) ?? { w: 640, h: 640 };
    const vw = this.viewportEl.clientWidth || 480;
    const vh = this.viewportEl.clientHeight || 400;
    const s = this.fitScale * this.panelModel.viewport.zoom;
    this.panelModel.viewport.panBy(dx, dy, contentSize.w * s, contentSize.h * s, vw, vh);
    this.applyTransform();
  }

  private applyTransform(): void {
    if (!this.viewportEl || !this.canvasEl || !this.model || !this.panel) return;
    const contentSize = inspectDrawTargets(this.model.kind) ?? { w: 640, h: 640 };
    const vw = this.viewportEl.clientWidth || 480;
    const vh = this.viewportEl.clientHeight || 400;
    const s = this.fitScale * this.panelModel.viewport.zoom;
    this.panelModel.viewport.panBy(0, 0, contentSize.w * s, contentSize.h * s, vw, vh);
    const { x, y } = { x: this.panelModel.viewport.offsetX, y: this.panelModel.viewport.offsetY };
    this.canvasEl.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${s})`;
  }
}
