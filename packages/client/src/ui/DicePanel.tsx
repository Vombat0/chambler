/**
 * FIX-PLAYABILITY-1 — Evrensel "🎲 ZAR AT" paneli.
 *
 * Kullanıcı şikâyeti: zar barı ya viewport dışına taşıyor ya .table-tools'un
 * altında kalıyor; 3D modda buton hiç yok. Bu panel masa ekranının SAĞ ALT
 * köşesinde sabit (z-index 50), 2D ve 3D modun ikisinde de, odaya bağlı tüm
 * oyuncular için her zaman görünür ve tıklanabilir. Durum `DiceController`'dan
 * gelir; tahtanın ortasındaki banner ve sohbet duyurusu aynı kaynağı paylaşır.
 */

import { useMemo, useSyncExternalStore } from 'react';
import type { JSX } from 'react';
import type { PlayerInfo } from '@chambler/shared';
import type { Language } from './settings.js';
import type { DiceController } from '../board2d/diceController.js';
import { makeB2dT } from '../board2d/strings.js';
import { DieFace } from './DieFace.js';

export interface DicePanelProps {
  dice: DiceController;
  players: readonly PlayerInfo[];
  selfId: string;
  language: Language;
}

export function DicePanel({ dice, players, selfId, language }: DicePanelProps): JSX.Element {
  const t = useMemo(() => makeB2dT(language), [language]);
  const snap = useSyncExternalStore(dice.subscribe, dice.getSnapshot);
  const rolling = snap.phase === 'rolling';

  const rollerName =
    snap.sum == null
      ? ''
      : snap.rollerId === selfId
        ? t('b2d.token.you')
        : players.find((player) => player.id === snap.rollerId)?.name ?? '';

  const result =
    snap.phase === 'settled' && snap.sum != null
      ? `🎲 ${rollerName ? `${rollerName}: ` : ''}${snap.lastA} + ${snap.lastB} = ${snap.sum}`
      : rolling
        ? t('b2d.dice.rolling')
        : t('b2d.dice.label');

  return (
    <div className="dice-dock" role="group" aria-label={t('b2d.dice.label')} data-testid="dice-dock">
      <div className="dice-dock-dice">
        <DieFace value={snap.a} rolling={rolling} tone="self" />
        <DieFace value={snap.b} rolling={rolling} tone="self" />
      </div>
      <button
        type="button"
        className="dice-dock-roll"
        onClick={() => dice.roll()}
        disabled={rolling}
        data-testid="dice-roll"
      >
        🎲 {rolling ? t('b2d.dice.rolling') : t('b2d.dice.roll')}
      </button>
      <div className="dice-dock-result" role="status" aria-live="polite">
        {result}
      </div>
    </div>
  );
}
