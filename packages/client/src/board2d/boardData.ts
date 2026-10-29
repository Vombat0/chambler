/**
 * 2D-1 — Paket verisi (Mülk Tycoon) 2D görünüm için.
 *
 * `packs/property-tycoon` altındaki JSON'lar Vite `?raw` importuyla derleme
 * zamanında gömülür (çevrimdışı çalışır; ağ isteği yok — `packSource.ts` ile
 * aynı desen). Buradan çıkan veriler safdır; React bundan bağımsız test
 * edilebilir.
 */

import boardRaw from '../../../../packs/property-tycoon/board/board.json?raw';
import groupsRaw from '../../../../packs/property-tycoon/board/groups.json?raw';
import chanceRaw from '../../../../packs/property-tycoon/cards/chance.json?raw';
import communityRaw from '../../../../packs/property-tycoon/cards/community.json?raw';
import trRaw from '../../../../packs/property-tycoon/i18n/tr.json?raw';
import enRaw from '../../../../packs/property-tycoon/i18n/en.json?raw';
import type { CellInput } from './boardGeometry.js';

export interface BoardJson {
  readonly grid: { cols: number; rows: number };
  readonly cells: CellInput[];
  readonly cornerIndices?: number[];
}

export interface GroupJson {
  readonly id: string;
  readonly nameKey?: string;
  readonly color: string;
  readonly members: number[];
}

export interface DeckCard {
  readonly id: string;
  readonly titleKey: string;
  readonly textKey: string;
  readonly effect?: Record<string, unknown>;
}

export interface DeckJson {
  readonly deckId: string;
  readonly nameKey: string;
  readonly cards: DeckCard[];
}

export type PackDictionary = Record<string, string>;

function parse<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`board2d: ${label} is not valid JSON: ${String(error)}`);
  }
}

export const BOARD_JSON: BoardJson = parse<BoardJson>(boardRaw, 'board.json');
export const GROUPS_JSON: GroupJson[] = parse<{ groups: GroupJson[] }>(groupsRaw, 'groups.json').groups;
export const CHANCE_DECK: DeckJson = parse<DeckJson>(chanceRaw, 'chance.json');
export const COMMUNITY_DECK: DeckJson = parse<DeckJson>(communityRaw, 'community.json');
export const I18N_TR: PackDictionary = parse<PackDictionary>(trRaw, 'i18n/tr.json');
export const I18N_EN: PackDictionary = parse<PackDictionary>(enRaw, 'i18n/en.json');

/** Sanat betiğindeki sabitlerle birebir: grup (veya tip) rengi. */
const FALLBACK_TYPE_COLORS: Record<string, string> = {
  start: '#3e6b4f',
  tax: '#8c3b3b',
  chance: '#c2456b',
  community: '#2e8b8b',
  jail: '#5a5a66',
  'free-parking': '#4f7a3a',
  'go-to-jail': '#6b5b95',
  transport: '#2c6fa8',
  energy: '#b8862b',
};

const groupColorById = new Map(GROUPS_JSON.map((group) => [group.id, group.color.toUpperCase()]));

/** Hücrenin vurgu rengi: grup rengi, yoksa tip rengi, yoksa nötr. */
export function cellAccent(cell: CellInput): string {
  if (cell.groupId) {
    const color = groupColorById.get(cell.groupId);
    if (color) return color;
  }
  return FALLBACK_TYPE_COLORS[cell.type] ?? '#5a6b85';
}

/** Hücre adı (paket i18n sözlüğünden; eksikse slug). */
export function cellName(cell: CellInput, language: 'tr' | 'en'): string {
  const dict = language === 'en' ? I18N_EN : I18N_TR;
  const key = `cell.${cell.index}.name`;
  return dict[key] ?? I18N_TR[key] ?? cell.slug ?? `#${cell.index}`;
}

/** Destenin kartını çevirir (başlık + metin). */
export function cardText(card: DeckCard, language: 'tr' | 'en'): { title: string; text: string } {
  const dict = language === 'en' ? I18N_EN : I18N_TR;
  return {
    title: dict[card.titleKey] ?? I18N_TR[card.titleKey] ?? card.id,
    text: dict[card.textKey] ?? I18N_TR[card.textKey] ?? '—',
  };
}
