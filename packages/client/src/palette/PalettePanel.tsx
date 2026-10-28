/**
 * D2 — Nesne paleti paneli.
 *
 * HUD'dan "Nesne ekle" ya da `B` kısayoluyla açılır. Kategoriler sekme,
 * öğeler ızgara; adet 1–10; piyonda renk. Masaüstünde sağ altta panel,
 * mobilde alttan açılan sayfa (CSS). Klavye: ←/→ kategori ve öğe, ↑/↓
 * ızgara, Home/End uçlar, Enter/Boşluk ekle, Esc kapat.
 */

import { useEffect, useRef, useState } from 'react';
import { COLOR_KEYS, PLAYER_COLORS, type PlayerColor } from '../ui/lobby.js';
import { useT } from '../ui/i18nContext.js';
import {
  CATEGORY_KEY,
  PALETTE_CATEGORIES,
  clampCopyCount,
  itemsInCategory,
  nextCopyCount,
  type PaletteCategory,
  type PaletteItemDef,
} from './paletteItems.js';
import {
  cycleCategory,
  moveGridIndex,
  paletteKeyAction,
} from './paletteKeyboard.js';

const GRID_COLUMNS = 3;

export interface PalettePanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * Nesneyi masaya ekler; gerçekten eklenen kopya sayısını döndürür
   * (masa dolduysa 0).
   */
  onAdd: (item: PaletteItemDef, count: number, color: string) => number;
}

export function PalettePanel(props: PalettePanelProps) {
  const { t } = useT();
  const [category, setCategory] = useState<PaletteCategory>('dice');
  const [activeIndex, setActiveIndex] = useState(0);
  const [count, setCount] = useState(1);
  const [color, setColor] = useState<PlayerColor>(PLAYER_COLORS[0]);
  const [notice, setNotice] = useState<string | null>(null);

  const closeRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const items = itemsInCategory(category);
  const activeItem = items[activeIndex] ?? items[0];
  const isPawn = category === 'pawns';

  // Açılışta kapat düğmesine odaklan; kapanışta durumu sıfırla.
  useEffect(() => {
    if (props.open) {
      closeRef.current?.focus();
      return;
    }
    setNotice(null);
  }, [props.open]);

  useEffect(() => {
    setActiveIndex(0);
    setNotice(null);
  }, [category]);

  if (!props.open || !activeItem) return null;
  const chosen: PaletteItemDef = activeItem;

  function focusItem(index: number): void {
    setActiveIndex(index);
    itemRefs.current[index]?.focus();
  }

  function selectCategory(next: PaletteCategory): void {
    setCategory(next);
    const tabIndex = PALETTE_CATEGORIES.indexOf(next);
    tabRefs.current[tabIndex]?.focus();
  }

  function handleTabsKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    const action = paletteKeyAction(event.key, 'tabs');
    if (action === 'close') {
      event.preventDefault();
      props.onClose();
      return;
    }
    if (action !== 'nextCategory' && action !== 'previousCategory') return;
    event.preventDefault();
    const next = cycleCategory(PALETTE_CATEGORIES, category, action === 'nextCategory' ? 1 : -1);
    selectCategory(next);
  }

  function handleGridKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    const action = paletteKeyAction(event.key, 'items');
    switch (action) {
      case 'close':
        event.preventDefault();
        props.onClose();
        return;
      case 'previousItem':
        event.preventDefault();
        focusItem(moveGridIndex(activeIndex, items.length, event.key === 'ArrowUp' ? 'up' : 'left', GRID_COLUMNS));
        return;
      case 'nextItem':
        event.preventDefault();
        focusItem(moveGridIndex(activeIndex, items.length, event.key === 'ArrowDown' ? 'down' : 'right', GRID_COLUMNS));
        return;
      case 'firstItem':
        event.preventDefault();
        focusItem(0);
        return;
      case 'lastItem':
        event.preventDefault();
        focusItem(items.length - 1);
        return;
      case 'add':
        // Enter/Boşluk odaktaki öğeyi doğrudan ekler (fare tıklaması yalnız seçer).
        event.preventDefault();
        add(chosen);
        return;
      default:
        return;
    }
  }

  function add(item: PaletteItemDef): void {
    const placed = props.onAdd(item, count, color);
    setNotice(placed === 0 ? t('palette.full') : null);
  }

  return (
    <div className="palette-scrim" onPointerDown={(event) => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <div
        className="palette"
        id="object-palette"
        role="dialog"
        aria-modal="false"
        aria-labelledby="palette-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onClose();
          }
        }}
      >
        <header className="palette-head">
          <h2 id="palette-title">{t('palette.title')}</h2>
          <span className="palette-hint muted">{t('palette.hint')}</span>
          <button type="button" className="button ghost palette-close" ref={closeRef} onClick={props.onClose}>
            {t('common.close')}
          </button>
        </header>

        <div
          className="palette-tabs"
          role="tablist"
          aria-label={t('palette.categories')}
          onKeyDown={handleTabsKey}
        >
          {PALETTE_CATEGORIES.map((entry, index) => (
            <button
              key={entry}
              type="button"
              role="tab"
              className="palette-tab"
              aria-selected={entry === category}
              tabIndex={entry === category ? 0 : -1}
              ref={(element) => { tabRefs.current[index] = element; }}
              onClick={() => setCategory(entry)}
            >
              {t(CATEGORY_KEY[entry])}
            </button>
          ))}
        </div>

        <div
          className="palette-grid"
          role="group"
          aria-label={t(CATEGORY_KEY[category])}
          onKeyDown={handleGridKey}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className="palette-item"
              aria-pressed={index === activeIndex}
              tabIndex={index === activeIndex ? 0 : -1}
              ref={(element) => { itemRefs.current[index] = element; }}
              onClick={() => setActiveIndex(index)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d={item.icon} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              <span>{t(item.nameKey)}</span>
            </button>
          ))}
        </div>

        {isPawn ? (
          <div className="palette-colors" role="group" aria-label={t('palette.color.label')}>
            {PLAYER_COLORS.map((value) => {
              const nameKey = COLOR_KEYS[value as PlayerColor];
              return (
                <button
                  key={value}
                  type="button"
                  className={`palette-swatch${value === color ? ' selected' : ''}`}
                  style={{ background: value }}
                  aria-pressed={value === color}
                  aria-label={nameKey ? t(nameKey) : value}
                  title={nameKey ? t(nameKey) : value}
                  onClick={() => setColor(value as PlayerColor)}
                />
              );
            })}
          </div>
        ) : null}

        <div className="palette-actions">
          <div className="palette-count" role="group" aria-label={t('palette.count.label')}>
            <button
              type="button"
              className="button ghost"
              aria-label={t('palette.count.decrease')}
              onClick={() => setCount(nextCopyCount(count, -1))}
              disabled={count <= 1}
            >
              −
            </button>
            <output aria-live="polite" className="palette-count-value">
              {t('palette.count.prefix')} {clampCopyCount(count)}
            </output>
            <button
              type="button"
              className="button ghost"
              aria-label={t('palette.count.increase')}
              onClick={() => setCount(nextCopyCount(count, 1))}
              disabled={count >= 10}
            >
              +
            </button>
          </div>
          <button type="button" className="button primary palette-add" onClick={() => add(chosen)}>
            {t('palette.add')}
          </button>
        </div>

        {notice ? (
          <p className="palette-notice" role="status">{notice}</p>
        ) : null}
      </div>
    </div>
  );
}
