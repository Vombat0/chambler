/**
 * 2D-1 — Görünüm geçiş düğmesi: [ 2D Tahta | 3D Masa ].
 *
 * HUD'a gömülü segmentli kontrol; varsayılan 2D. Tercih App'te kalıcıdır.
 */

import type { JSX } from 'react';
import type { ViewMode } from './viewMode.js';
import { makeB2dT, type B2dKey } from './strings.js';
import type { Language } from '../ui/settings.js';

export interface ViewToggleProps {
  mode: ViewMode;
  language: Language;
  onChange: (mode: ViewMode) => void;
}

export function ViewToggle({ mode, language, onChange }: ViewToggleProps): JSX.Element {
  const t = makeB2dT(language);
  const items: Array<{ mode: ViewMode; key: B2dKey }> = [
    { mode: '2d', key: 'b2d.toggle.2d' },
    { mode: '3d', key: 'b2d.toggle.3d' },
  ];
  return (
    <div className="b2d-toggle segmented" role="group" aria-label={t('b2d.toggle.label')}>
      {items.map((item) => (
        <button
          key={item.mode}
          type="button"
          className="button ghost b2d-toggle-item"
          aria-pressed={mode === item.mode}
          onClick={() => onChange(item.mode)}
        >
          {t(item.key)}
        </button>
      ))}
    </div>
  );
}
