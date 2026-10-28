/**
 * D2 — Masa araç çubuğu: palet aç/kapat, paket yükle, masayı temizle.
 *
 * Sabit alt araç çubuğu; canvas'ın üstünde `position: fixed`. Temizleme iki
 * adımlı onay ister ve yalnızca host (online) ya da yerel masada etkindir.
 * Paket yükleme ilerlemesi `aria-live` ile duyurulur.
 */

import { useEffect, useState } from 'react';
import { useT } from '../ui/i18nContext.js';
import type { PackLoadProgress, PackStepId } from './packLoader.js';

export interface TableToolsProps {
  paletteOpen: boolean;
  onTogglePalette: () => void;
  packProgress: PackLoadProgress | null;
  packBusy: boolean;
  onLoadPack: () => void;
  onClearTable: () => void;
  canClear: boolean;
  isHost: boolean;
}

const STEP_KEY: Record<PackStepId, string> = {
  validate: 'pack.step.validate',
  board: 'pack.step.board',
  pawns: 'pack.step.pawns',
  decks: 'pack.step.decks',
  money: 'pack.step.money',
};

export function TableTools(props: TableToolsProps) {
  const { t } = useT();
  const [confirmClear, setConfirmClear] = useState(false);

  // Onay penceresi kendiliğinden kapanır (yanlışlıkla takılı kalmasın).
  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  const progress = props.packProgress;
  const failed = progress?.failed === true;
  const currentStep = progress?.current ?? null;
  const allOk = progress?.steps.every((step) => step.state === 'ok') ?? false;

  return (
    <div className="table-tools" role="toolbar" aria-label={t('tools.label')}>
      <button
        type="button"
        className="button"
        aria-expanded={props.paletteOpen}
        aria-controls="object-palette"
        onClick={props.onTogglePalette}
        title={t('palette.open')}
      >
        ＋ {t('palette.open')} <kbd className="kbd">B</kbd>
      </button>

      <button
        type="button"
        className="button"
        onClick={props.onLoadPack}
        disabled={props.packBusy}
        aria-describedby={progress ? 'pack-progress' : undefined}
      >
        {props.packBusy ? t('pack.loading') : t('pack.load')}
      </button>

      {props.canClear ? (
        confirmClear ? (
          <span className="tools-confirm" role="group" aria-label={t('tools.clear.confirmTitle')}>
            <button
              type="button"
              className="button destructive"
              onClick={() => {
                setConfirmClear(false);
                props.onClearTable();
              }}
            >
              {t('tools.clear.confirmYes')}
            </button>
            <button type="button" className="button ghost" onClick={() => setConfirmClear(false)}>
              {t('tools.clear.confirmNo')}
            </button>
          </span>
        ) : (
          <button type="button" className="button" onClick={() => setConfirmClear(true)}>
            {t('tools.clear')}
          </button>
        )
      ) : (
        <button type="button" className="button" disabled title={t('tools.hostOnly')}>
          {t('tools.clear')}
        </button>
      )}

      {progress ? (
        <span
          id="pack-progress"
          className={`pack-progress${failed ? ' failed' : ''}`}
          role="status"
          aria-live="polite"
        >
          {failed
            ? t('pack.failed')
            : allOk
              ? t('pack.loaded')
              : currentStep
                ? `${t('pack.loadingStep')} ${t(STEP_KEY[currentStep])}`
                : ''}
        </span>
      ) : null}

      {!props.canClear && !props.isHost ? (
        <span className="tools-note muted">{t('tools.hostOnly')}</span>
      ) : null}
    </div>
  );
}
