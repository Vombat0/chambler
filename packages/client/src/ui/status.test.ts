import { describe, expect, it } from 'vitest';
import { statusPresentation } from './status.js';

describe('connection status presentation (D1)', () => {
  it(' connected → yeşil/ok ve polite', () => {
    expect(statusPresentation('connected')).toEqual({
      key: 'status.connected',
      priority: 'polite',
      tone: 'ok',
    });
  });

  it(' reconnecting ve connecting uyarı tonundadır', () => {
    expect(statusPresentation('reconnecting').tone).toBe('warn');
    expect(statusPresentation('connecting').tone).toBe('warn');
  });

  it(' disconnected → assertive duyuru', () => {
    expect(statusPresentation('disconnected')).toMatchObject({ priority: 'assertive', tone: 'muted' });
  });

  it(' idle → muted', () => {
    expect(statusPresentation('idle').tone).toBe('muted');
    expect(statusPresentation('idle').key).toBe('status.idle');
  });

  it(' offline (B4) → kırmızı/error ve assertive duyuru', () => {
    expect(statusPresentation('offline')).toEqual({
      key: 'status.offline',
      priority: 'assertive',
      tone: 'error',
    });
  });

  it(' resyncing (B4) → sarı/warn, eşitleme bekleniyor', () => {
    expect(statusPresentation('resyncing')).toEqual({
      key: 'status.resyncing',
      priority: 'polite',
      tone: 'warn',
    });
  });
});
