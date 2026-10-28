/**
 * D1 — Bağlantı durumu gösterimi.
 *
 * `NetworkClient.onStatus` durumlarını HUD'un daha anlaşılır
 * etiket + aria-live önceliğine çevirir (saf, testlenebilir).
 */

export type ConnectionStatusLike = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export interface StatusPresentation {
  /** `status.*` i18n anahtarı. */
  readonly key: string;
  /** aria-live bölgesinde ne kadar kritik? */
  readonly priority: 'polite' | 'assertive';
  /** Görsel durum rengi (CSS sınıfının kalite seviyesi). */
  readonly tone: 'ok' | 'warn' | 'muted';
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
    case 'idle':
    default:
      return { key: 'status.idle', priority: 'polite', tone: 'muted' };
  }
}
