/**
 * A6 — InspectController: canvas bağlama katmanı.
 *
 * - Canvas'ta InspectGesture çalıştırır (sağ tık vs orbit ayrımı, dokunmatik long press).
 * - Sağ tuşla başlayan sürüklemeyi A3 InteractionController'a iletmez (stopImmediatePropagation);
 *   bu sayede sağ tuş yalnızca kamera orbitine gider, nesne sürüklemesi/claim tetiklenmez.
 * - Tetiklemede raycast ile nesneyi bulur; desteklenen türler (card/board/tile/token)
 *   için panel açar, diğer türlerde sessiz kalır.
 * - Panel açıkken 3D render döngüsünü duraklatır (pauseRender/resumeRender), kapanınca devam.
 * - İçerik canvas'ı InspectCache ile cache'lenir (aynı nesne/meta tekrar açılışta üretim yok).
 */

import * as THREE from 'three';
import type { ObjectDef } from '@chambler/shared';
import { InspectGesture, type InspectTrigger } from './InspectGesture.js';
import { InspectCache } from './InspectCache.js';
import { InspectOverlay, type CloseReason } from './InspectOverlay.js';
import { buildInspectModel, isInspectable } from './inspect-model.js';
import { drawInspectContent } from './inspect-draw.js';

export interface InspectableObject {
  def: ObjectDef;
  mesh: THREE.Object3D;
}

export interface InspectableObjectSource {
  list(): InspectableObject[];
  get(id: string): InspectableObject | undefined;
}

export interface InspectControllerOptions {
  camera: THREE.Camera;
  domElement: HTMLElement;
  getObjects: () => InspectableObjectSource;
  pauseRender: () => void;
  resumeRender: () => void;
  onOpen?: (def: ObjectDef) => void;
  onClose?: (reason: CloseReason) => void;
  /** Test/diag amaçlı tetik sayacı. */
  maxTriggers?: number;
}

export class InspectController {
  readonly gesture: InspectGesture;
  readonly overlay: InspectOverlay;
  paused = false;

  private readonly cache = new InspectCache<HTMLCanvasElement>(8);
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private lastTrigger: InspectTrigger | null = null;

  private readonly onCanvasPointerDown = (e: PointerEvent): void => {
    this.gesture.pointerDown({
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      button: e.button,
      x: e.clientX,
      y: e.clientY,
    });
    if (e.pointerType === 'mouse' && e.button === 2) {
      // Sağ tuş yalnızca kamera orbitine: A3 sürükleme/claim zincirini kes.
      e.stopImmediatePropagation();
    }
  };

  private readonly onCanvasPointerMove = (e: PointerEvent): void => {
    this.gesture.pointerMove({ pointerId: e.pointerId, x: e.clientX, y: e.clientY });
  };

  private readonly onCanvasPointerUp = (e: PointerEvent): void => {
    this.gesture.pointerUp({ pointerId: e.pointerId, x: e.clientX, y: e.clientY });
  };

  private readonly onPointerLeave = (): void => {
    this.gesture.pointerCancel();
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  constructor(private readonly opts: InspectControllerOptions) {
    this.gesture = new InspectGesture({ onInspect: (t) => this.handleTrigger(t) });
    this.overlay = new InspectOverlay({ onClose: (reason) => this.handleClosed(reason) });
    const el = opts.domElement;
    // SIRALAMA ÖNEMLİ: bu listener'lar InteractionController'dan ÖNCE eklenmelidir ki
    // sağ tuşun stopImmediatePropagation'ı A3'in pointerdown'ına ulaşsın (bkz. App.tsx).
    el.addEventListener('pointerdown', this.onCanvasPointerDown);
    el.addEventListener('pointermove', this.onCanvasPointerMove);
    el.addEventListener('pointerup', this.onCanvasPointerUp);
    el.addEventListener('pointercancel', this.onPointerLeave);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('contextmenu', this.onContextMenu);
  }

  private handleTrigger(trigger: InspectTrigger): void {
    this.lastTrigger = trigger;
    // Panel açıkken yeniden tetikleme yok.
    if (this.overlay.isOpen) return;
    const found = this.pick(trigger.x, trigger.y);
    if (!found) return;
    const def = found.def;
    if (!isInspectable(def.kind)) return; // die/deck/custom: inspect devre dışı
    const model = buildInspectModel(def);
    const key = this.contentKey(def);
    const content = this.cache.obtain(key, () => drawInspectContent(model));
    this.overlay.open({ model, content });
    if (!this.paused) {
      this.paused = true;
      this.opts.pauseRender();
    }
    this.opts.onOpen?.(def);
  }

  private handleClosed(reason: CloseReason): void {
    if (this.paused) {
      this.paused = false;
      this.opts.resumeRender();
    }
    this.opts.onClose?.(reason);
  }

  private pick(clientX: number, clientY: number): InspectableObject | null {
    const el = this.opts.domElement;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.opts.camera);
    const meshes = this.opts.getObjects().list().map((o) => o.mesh);
    if (meshes.length === 0) return null;
    const hits = this.raycaster.intersectObjects(meshes, true);
    let obj: THREE.Object3D | null = hits[0]?.object ?? null;
    while (obj && !obj.userData.objectId) obj = obj.parent;
    const id = obj?.userData.objectId;
    if (typeof id !== 'string') return null;
    return this.opts.getObjects().get(id) ?? null;
  }

  /** Cache anahtarı: id + yüz durumu + meta içeriği (sıralı, stabil). */
  private contentKey(def: ObjectDef): string {
    const metaKeys = Object.keys(def.meta).sort();
    const metaPart = metaKeys.map((k) => `${k}=${JSON.stringify(def.meta[k]).slice(0, 120)}`).join('|');
    return `${def.id}:${def.faceUp ? 1 : 0}:${metaPart}`;
  }

  /** Cache durumunu doğrudan test etmek için. */
  cachedCount(): number {
    return this.cache.size;
  }

  dispose(): void {
    const el = this.opts.domElement;
    el.removeEventListener('pointerdown', this.onCanvasPointerDown);
    el.removeEventListener('pointermove', this.onCanvasPointerMove);
    el.removeEventListener('pointerup', this.onCanvasPointerUp);
    el.removeEventListener('pointercancel', this.onPointerLeave);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('contextmenu', this.onContextMenu);
    this.gesture.cancel();
    if (this.overlay.isOpen) this.overlay.close('button');
    if (this.paused) {
      this.paused = false;
      this.opts.resumeRender();
    }
  }
}
