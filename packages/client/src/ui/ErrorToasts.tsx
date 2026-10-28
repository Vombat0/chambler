import { useEffect, useRef } from 'react';
import { resolveError } from './errors.js';
import { useT } from './i18nContext.js';

export interface AppError {
  readonly id: number;
  readonly code: string;
  readonly serverMessage: string;
}

/**
 * D1 — Hata katmanı: ekran durumundan bağımsız, ekranın üstünde dereeli
 * `role="alert"` balonları (aria-live=assertive). Kullanıcı kapatana kadar
 * kalır; otomatik kaybolduğu takdirde ekran okuyucu kaçırabilir.
 */
export function ErrorToasts({ errors, onDismiss }: { errors: readonly AppError[]; onDismiss: (id: number) => void }) {
  const t = useT().t;
  if (errors.length === 0) return null;
  return (
    <div className="toast-layer" role="region" aria-label={t('region.errors')}>
      {errors.map((error) => {
        const resolved = resolveError(error.code, error.serverMessage);
        return (
          <div key={error.id} className="toast" role="alert">
            <p className="toast-text">
              {t(resolved.key)}
              {resolved.unknown && error.serverMessage ? <span className="toast-detail">{error.serverMessage}</span> : null}
            </p>
            <button type="button" className="toast-close" onClick={() => onDismiss(error.id)}>
              ✕<span className="visually-hidden">{t('common.close')}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Oda katılme sonrası otomatik temizlenen zamanlama kancası (opsiyonel kullanım). */
export function useTimedDismiss(
  ids: readonly number[],
  onDismiss: (id: number) => void,
  afterMs = 6000,
): void {
  const timers = useRef<number[]>([]);
  useEffect(() => {
    for (const id of ids) {
      if (timers.current.includes(id)) continue;
      const timer = window.setTimeout(() => onDismiss(id), afterMs);
      timers.current.push(timer);
    }
    return () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    };
  }, [ids, onDismiss, afterMs]);
}
