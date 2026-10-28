import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { makeLookup } from './i18n.js';
import type { Language } from './settings.js';

export interface I18nValue {
  readonly lang: Language;
  readonly t: (key: string) => string;
}

/**
 * D1 — Dil bağlamı. `lang` değiştiğinde `t` yeniden üretilir; tüm ekranlar
 * aynı anda yeni dile geçer.
 */
export const I18nContext = createContext<I18nValue>({ lang: 'tr', t: makeLookup('tr') });

export function useT(): I18nValue {
  return useContext(I18nContext);
}

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => ({ lang: language, t: makeLookup(language) }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
