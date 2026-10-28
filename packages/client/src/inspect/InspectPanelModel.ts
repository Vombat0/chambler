/**
 * A6 — InspectPanelModel: inspect paneli için saf etkileşim modeli.
 * DOM yok; InspectOverlay bu modeli kapatma/odak/pan kararları için kullanır.
 */

import { InspectViewport } from './InspectViewport.js';

export type PanelKeyAction =
  | 'close'
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'focus'; prev: boolean }
  | 'none';

export interface KeyInput {
  key: string;
  shiftKey?: boolean;
}

export const PAN_STEP_PX = 40;

export class InspectPanelModel {
  readonly viewport = new InspectViewport();

  /**
   * Klavye olayını panele çevirir:
   * - Escape -> close (panel dışındaki diğer Escape'ler aria-modal sürücüye kalır)
   * - Ok tuşları -> pan (viewport matematik uygular)
   * - Tab / Shift+Tab -> odak döngüsü (focus trap)
   */
  keydown(input: KeyInput): PanelKeyAction {
    switch (input.key) {
      case 'Escape':
        return 'close';
      case 'ArrowLeft':
        return { type: 'pan', dx: -PAN_STEP_PX, dy: 0 };
      case 'ArrowRight':
        return { type: 'pan', dx: PAN_STEP_PX, dy: 0 };
      case 'ArrowUp':
        return { type: 'pan', dx: 0, dy: -PAN_STEP_PX };
      case 'ArrowDown':
        return { type: 'pan', dx: 0, dy: PAN_STEP_PX };
      case 'Tab':
        return { type: 'focus', prev: input.shiftKey === true };
      default:
        return 'none';
    }
  }

  /** Tık panel dikdörtgeninin dışındaysa kapat ('dış tıklama'). */
  outsideClick(x: number, y: number, panelRect: { left: number; top: number; right: number; bottom: number }): boolean {
    return x < panelRect.left || x > panelRect.right || y < panelRect.top || y > panelRect.bottom;
  }

  /**
   * Focus trap: indis döngüsü her iki yönde; aktif odak yoksa (index<0) ilk/son odak.
   */
  nextFocusIndex(currentIndex: number, focusableCount: number, prev: boolean): number {
    if (focusableCount <= 0) return 0;
    if (currentIndex < 0) return prev ? focusableCount - 1 : 0;
    const delta = prev ? -1 : 1;
    return ((currentIndex + delta) % focusableCount + focusableCount) % focusableCount;
  }
}
