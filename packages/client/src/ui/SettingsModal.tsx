import { useEffect, useRef, useState } from 'react';
import type { Language, Settings, ShadowQuality } from './settings.js';
import { useT } from './i18nContext.js';

export interface SettingsModalProps {
  open: boolean;
  settings: Settings;
  /** Yerel/offline modda masayı sıfırlama görünür. */
  allowTableReset: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onLanguageChange: (language: Language) => void;
  onResetTable: () => void;
  onClose: () => void;
}

/**
 * D1 — Ayarlar modalı. Klavyeyle tam gezinilebilir: açılışta kapat düğmesine
 * odaklanır, Esc kapatır, Tab odak tuzağı çevresel döngü yapar; kapanışta
 * odak önceki elemana geri döner.
 */
export function SettingsModal(props: SettingsModalProps) {
  const { t } = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);

  useEffect(() => {
    if (props.open) {
      openerRef.current = document.activeElement;
      closeRef.current?.focus();
      return;
    }
    setResetConfirm(false);
    const opener = openerRef.current;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, [props.open]);

  if (!props.open) return null;

  function trapFocus(event: React.KeyboardEvent) {
    if (event.key !== 'Tab') return;
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button, input, select, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop" onKeyDown={trapFocus}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.onClose();
        }}
      >
        <header className="modal-head">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <button type="button" className="button ghost" ref={closeRef} onClick={props.onClose}>
            {t('settings.close')}
          </button>
        </header>

        <div className="modal-body">
          <label className="slider-field" htmlFor="settings-sensitivity">
            <span className="field-label">{t('settings.camera.label')}</span>
            <input
              id="settings-sensitivity"
              type="range"
              min={0.2}
              max={2}
              step={0.05}
              value={props.settings.cameraSensitivity}
              onChange={(event) => props.onChange({ cameraSensitivity: Number(event.target.value) })}
            />
            <output htmlFor="settings-sensitivity" className="muted">
              {props.settings.cameraSensitivity.toFixed(2)}
            </output>
          </label>
          <p className="muted">{t('settings.camera.help')}</p>

          <label className="field-label" htmlFor="settings-shadow">
            {t('settings.shadow.label')}
          </label>
          <select
            id="settings-shadow"
            className="select"
            value={props.settings.shadowQuality}
            onChange={(event) => props.onChange({ shadowQuality: event.target.value as ShadowQuality })}
          >
            <option value="low">{t('settings.shadow.low')}</option>
            <option value="medium">{t('settings.shadow.medium')}</option>
            <option value="high">{t('settings.shadow.high')}</option>
          </select>

          <label className="field-label" htmlFor="settings-language">
            {t('settings.language.label')}
          </label>
          <select
            id="settings-language"
            className="select"
            value={props.settings.language}
            onChange={(event) => props.onLanguageChange(event.target.value as Language)}
          >
            <option value="tr">{t('lang.tr')}</option>
            <option value="en">{t('lang.en')}</option>
          </select>

          <div className="switch-row">
            <input
              id="settings-sound"
              type="checkbox"
              className="oc-switch"
              checked={props.settings.sound}
              onChange={(event) => props.onChange({ sound: event.target.checked })}
            />
            <label htmlFor="settings-sound">{t('settings.sound.label')}</label>
          </div>

          {props.allowTableReset ? (
            <div className="reset-block">
              <p className="field-label">{t('settings.reset.label')}</p>
              {resetConfirm ? (
                <div className="reset-confirm" role="group" aria-label={t('settings.reset.confirm.title')}>
                  <p>{t('settings.reset.confirm.title')}</p>
                  <button type="button" className="button destructive" onClick={() => {
                    props.onResetTable();
                    setResetConfirm(false);
                  }}>
                    {t('settings.reset.confirm.yes')}
                  </button>
                  <button type="button" className="button" onClick={() => setResetConfirm(false)}>
                    {t('settings.reset.confirm.no')}
                  </button>
                </div>
              ) : (
                <button type="button" className="button" onClick={() => setResetConfirm(true)}>
                  {t('settings.reset.button')}
                </button>
              )}
            </div>
          ) : (
            <p className="muted">{t('settings.reset.offlineOnly')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
