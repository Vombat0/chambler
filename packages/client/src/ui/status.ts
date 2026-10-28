/**
 * D1 — Bağlantı durumu gösterimi.
 *
 * `NetworkClient.onStatus` durumlarını HUD'un daha anlaşılır
 * etiket + aria-live önceliğine çevirir (saf, testlenebilir).
 */

export type ConnectionStatusLike =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'offline'
  | 'resyncing';

export interface StatusPresentation {
  /** `status.*` i18n anahtarı. */
  readonly key: string;
  /** aria-live bölgesinde ne kadar kritik? */
  readonly priority: 'polite' | 'assertive';
  /** Görsel durum rengi (CSS sınıfının kalite seviyesi). */
  readonly tone: 'ok' | 'warn' | 'muted' | 'error';
}

export function statusPresentation(status: ConnectionStatusLike): StatusPresentation {
  switch (status) {
    case 'connected':
      return { key: 'status.connected', priority: 'polite', tone: 'ok' };
    case 'reconnecting':
      return { key: 'status.reconnecting', priority: 'polite', tone: 'warn' };
    case 'connecting':
      return { key: 'status.connecting', priority: 'polite', tone: 'warn' };
    case 'disconnected':
      return { key: 'status.disconnected', priority: 'assertive', tone: 'muted' };
    case 'offline':
      // B4: retries exhausted — the client gave up and runs locally.
      return { key: 'status.offline', priority: 'assertive', tone: 'error' };
    case 'resyncing':
      // B4: socket is back, waiting for the authoritative tableResync.
      return { key: 'status.resyncing', priority: 'polite', tone: 'warn' };
    case 'idle':
    default:
      return { key: 'status.idle', priority: 'polite', tone: 'muted' };
  }
}
