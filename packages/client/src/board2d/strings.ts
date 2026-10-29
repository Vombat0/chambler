/**
 * 2D-1 — 2D görünüm metinleri.
 *
 * Paylaşılan `ui/i18n.ts` sözlüğünü büyütme yerine modül-özel, küçük bir
 * tablo tutulur (2D görünüm kendi kendine yeter; dil etiketleri App'ten
 * gelen `language` prop'u ile seçilir).
 */

import type { Language } from '../ui/settings.js';

const TR = {
  'b2d.boardAria': 'Mülk Tycoon tahtası — tepeden görünüm',
  'b2d.dice.label': 'Zarlar',
  'b2d.dice.roll': 'Zar At',
  'b2d.dice.rolling': 'Zarlar dönüyor…',
  'b2d.dice.sum': 'Toplam',
  'b2d.dice.remote': '{name} {sum} attı',
  'b2d.dice.announce': '{name} zar attı: {a} + {b} = {sum}',
  'b2d.target.move': 'Zar: {sum} → {cell} hücresine ilerle',
  'b2d.decks.label': 'Desteler',
  'b2d.deck.draw': 'Kart çek',
  'b2d.deck.close': 'Kapat',
  'b2d.token.you': 'Sen',
  'b2d.toggle.label': 'Görünüm',
  'b2d.toggle.2d': '2D Tahta',
  'b2d.toggle.3d': '3D Masa',
  'b2d.go.label': 'BAŞLA',
  'b2d.jail.label': 'HAPİS',
  'b2d.parking.label': 'BEDAVA OTO',
  'b2d.gojail.label': 'ZINDANA',
  'b2d.salary': '+200',
  'b2d.tokens.label': 'Piyonlar',
  'b2d.card.chance': 'Fırsat',
  'b2d.card.community': 'Topluluk',
} as const;

const EN: Record<keyof typeof TR, string> = {
  'b2d.boardAria': 'Property Tycoon board — top-down view',
  'b2d.dice.label': 'Dice',
  'b2d.dice.roll': 'Roll Dice',
  'b2d.dice.rolling': 'Rolling…',
  'b2d.dice.sum': 'Sum',
  'b2d.dice.remote': '{name} rolled {sum}',
  'b2d.dice.announce': '{name} rolled: {a} + {b} = {sum}',
  'b2d.target.move': 'Dice: {sum} — move to {cell}',
  'b2d.decks.label': 'Decks',
  'b2d.deck.draw': 'Draw card',
  'b2d.deck.close': 'Close',
  'b2d.token.you': 'You',
  'b2d.toggle.label': 'View',
  'b2d.toggle.2d': '2D Board',
  'b2d.toggle.3d': '3D Table',
  'b2d.go.label': 'GO',
  'b2d.jail.label': 'JAIL',
  'b2d.parking.label': 'FREE PARK',
  'b2d.gojail.label': 'TO JAIL',
  'b2d.salary': '+200',
  'b2d.tokens.label': 'Tokens',
  'b2d.card.chance': 'Chance',
  'b2d.card.community': 'Community',
};

export type B2dKey = keyof typeof TR;

export function makeB2dT(language: Language) {
  const table: Record<B2dKey, string> = language === 'en' ? EN : TR;
  return (key: B2dKey, vars?: Record<string, string | number>): string => {
    let text: string = table[key];
    if (vars) {
      for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  };
}
