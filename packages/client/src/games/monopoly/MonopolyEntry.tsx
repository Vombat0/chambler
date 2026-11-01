/**
 * Mülk Tycoon — giriş ekranı (oyun seçiminden sonra doğrudan buraya).
 *
 * "Paket yükle / nesne yükle" akışı yoktur: oyuncu sayısını ve adları seçer,
 * tek düğmeyle kurallı oyun başlar. Yerel hot-seat ve çevrimiçi masa aynı
 * bileşeni kullanır; çevrimiçi modda Colyseus durum köprüsü (`sync`) verilir.
 */

import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { Language } from '../../ui/settings.js';
import { PLAYER_COLORS, createGame, type MonopolyState } from './monopolyEngine.js';
import type { MonopolySync } from './monopolySync.js';
import { MonopolyGameView } from './MonopolyGameView.js';
import { makeMpT } from './monopolyStrings.js';
import './monopoly.css';

export interface MonopolyEntryProps {
  language?: Language;
  /** Çevrimiçi masa için dış durum (oda sahibi yayınlar). */
  initialState?: MonopolyState;
  selfId?: string | null;
  sync?: MonopolySync;
  onExit?: () => void;
  defaultNames?: readonly string[];
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

export function MonopolyEntry(props: MonopolyEntryProps): JSX.Element {
  const { language = 'tr', initialState, selfId = null, sync, onExit, defaultNames } = props;
  const t = useMemo(() => makeMpT(language), [language]);
  const [state, setState] = useState<MonopolyState | null>(initialState ?? null);
  const [count, setCount] = useState(() => Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, defaultNames?.length ?? 2)));
  const [names, setNames] = useState<string[]>(() => {
    const base = defaultNames ? [...defaultNames] : [];
    return Array.from({ length: MAX_PLAYERS }, (_, index) => base[index] ?? `Oyuncu ${index + 1}`);
  });

  if (state) {
    return (
      <MonopolyGameView
        state={state}
        onChange={setState}
        language={language}
        selfId={selfId}
        sync={sync}
        onExit={onExit}
        onRestart={() => setState(createGame(names.slice(0, count).map((name) => ({ name }))))}
      />
    );
  }

  const start = (): void => {
    setState(createGame(names.slice(0, count).map((name) => ({ name }))));
  };

  return (
    <div className="mp-root mp-setup-root">
      <div className="mp-setup">
        <header className="mp-setup-head">
          <span className="mp-brand-mark">₡</span>
          <div>
            <h1>{t('mp.title')}</h1>
            <p>{t('mp.subtitle')}</p>
          </div>
        </header>

        <p className="mp-setup-kicker">{t('mp.setup.title')}</p>

        <div className="mp-setup-count" role="group" aria-label={t('mp.setup.players')}>
          <span>{t('mp.setup.players')}</span>
          <div className="mp-count-buttons">
            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, index) => MIN_PLAYERS + index).map((value) => (
              <button
                key={value}
                type="button"
                className={`mp-count${count === value ? ' is-active' : ''}`}
                aria-pressed={count === value}
                onClick={() => setCount(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <ul className="mp-setup-players">
          {Array.from({ length: count }, (_, index) => (
            <li key={index} style={{ ['--player-color' as string]: PLAYER_COLORS[index % PLAYER_COLORS.length] }}>
              <span className="mp-avatar">{names[index]?.slice(0, 1).toUpperCase() ?? '?'}</span>
              <label className="mp-setup-field">
                <input
                  className="mp-setup-input"
                  value={names[index] ?? ''}
                  maxLength={18}
                  aria-label={t('mp.setup.name', { n: index + 1 })}
                  placeholder={t('mp.setup.name', { n: index + 1 })}
                  onChange={(event) => {
                    const value = event.target.value;
                    setNames((previous) => previous.map((entry, i) => (i === index ? value : entry)));
                  }}
                />
              </label>
              <span className="mp-setup-color" aria-hidden="true" />
              <span className="mp-setup-index">{index + 1}</span>
            </li>
          ))}
        </ul>

        <button type="button" className="mp-btn primary mp-setup-start" onClick={start}>
          {t('mp.setup.start')}
        </button>
        <p className="mp-setup-hint">{t('mp.setup.hint')}</p>
      </div>
    </div>
  );
}
