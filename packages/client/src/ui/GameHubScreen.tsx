import { useState, type FormEvent } from 'react';
import type { Language } from './settings.js';
import { ROOM_CODE_LENGTH, normalizeRoomCode } from './validation.js';

/** Vitrindeki üç oyunun kimlikleri. */
export type GameId = 'monopoly' | 'risk' | 'carcassonne';

export interface GameCatalogEntry {
  readonly id: GameId;
  readonly icon: string;
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  readonly players: string;
  readonly duration: string;
  readonly accent: string;
  readonly highlights: readonly string[];
}

/** Game Hub kartları — tek gerçek kaynak. */
export const GAME_CATALOG: readonly GameCatalogEntry[] = [
  {
    id: 'monopoly',
    icon: '🏢',
    title: 'Mülk Tycoon',
    subtitle: 'Monopoly',
    description:
      '40 hücreli klasik emlak ticareti. Zar at, piyon adım adım ilerlesin, arsa satın al, kira topla!',
    players: '2–6 oyuncu',
    duration: '35–90 dk',
    accent: '#d9b36c',
    highlights: ['40 hücreli tahta', 'Fırsat & Topluluk', 'Ev / otel kurma'],
  },
  {
    id: 'risk',
    icon: '⚔️',
    title: 'Territory Wars',
    subtitle: 'Risk',
    description:
      '28 bölgeli dünya fethi. Orduları takviye et, 3v2 zar çatışmasıyla komşu ülkeleri fethet!',
    players: '2–4 oyuncu',
    duration: '30–75 dk',
    accent: '#e05b4b',
    highlights: ['28 bölge / 5 kıta', '3v2 zar savaşı', 'Yapay zekâ rakipler'],
  },
  {
    id: 'carcassonne',
    icon: '👑',
    title: 'Tile Kingdoms',
    subtitle: 'Carcassonne',
    description:
      '72 karoluk krallık inşası. Karo çek, 90° döndür, kenarları eşleştir, işçi koy ve puan topla!',
    players: '2–5 oyuncu',
    duration: '30–60 dk',
    accent: '#67b26f',
    highlights: ['72 karo destesi', 'İşçi yerleştirme', 'Yol / şehir / manastır'],
  },
];

export interface GameHubScreenProps {
  language: Language;
  playerName: string;
  busy: boolean;
  error: string | null;
  onPlayerNameChange: (name: string) => void;
  onLanguageChange: (language: Language) => void;
  onOpenSettings: () => void;
  onPlayLocal: (game: GameId) => void;
  onCreateRoom: (game: GameId) => void;
  onJoinRoom: (game: GameId, code: string) => void;
}

/**
 * R0 — Oyun Vitrini (Game Hub).
 *
 * Üç tam oyunu tek çatı altında toplar. Her kartta yerel oyna, çevrimiçi oda
 * kur ve kodla katıl vardır. Eski simülatör akışı (paket yükle / palet)
 * tamamen kaldırılmıştır: oyunlar doğrudan kurulu başlar.
 */
export function GameHubScreen(props: GameHubScreenProps) {
  const { language } = props;
  const tr = language === 'tr';
  const [joinFor, setJoinFor] = useState<GameId | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  function submitJoin(event: FormEvent) {
    event.preventDefault();
    if (!joinFor) return;
    const result = normalizeRoomCode(code);
    if (!result.ok) {
      setCodeError(tr ? 'Kod 5 haneli olmalı (A-Z, 2-9).' : 'The code must be 5 characters (A-Z, 2-9).');
      return;
    }
    setCodeError(null);
    props.onJoinRoom(joinFor, result.value);
  }

  function openJoin(game: GameId) {
    setJoinFor((current) => (current === game ? null : game));
    setCode('');
    setCodeError(null);
  }

  return (
    <main className="hub" aria-labelledby="hub-title">
      <div className="hub-glow" aria-hidden="true" />

      <header className="hub-topbar">
        <div className="hub-brand">
          <span className="hub-brand-mark" aria-hidden="true">
            ♟
          </span>
          <div>
            <h1 id="hub-title">Chambler</h1>
            <p>{tr ? 'Oyun Vitrini' : 'Game Hub'}</p>
          </div>
        </div>

        <div className="hub-topbar-tools">
          <label className="hub-name-field">
            <span>{tr ? 'Oyuncu adı' : 'Player name'}</span>
            <input
              className="hub-input"
              value={props.playerName}
              maxLength={18}
              placeholder={tr ? 'Adın' : 'Your name'}
              onChange={(event) => props.onPlayerNameChange(event.target.value)}
            />
          </label>
          <select
            className="hub-select"
            aria-label={tr ? 'Dil' : 'Language'}
            value={language}
            onChange={(event) => props.onLanguageChange(event.target.value as Language)}
          >
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
          <button type="button" className="hub-icon-btn" onClick={props.onOpenSettings} title={tr ? 'Ayarlar' : 'Settings'}>
            ⚙
          </button>
        </div>
      </header>

      <section className="hub-hero">
        <p className="hub-kicker">{tr ? '3 TAM OYUN · TEK MASA' : '3 FULL GAMES · ONE TABLE'}</p>
        <h2>{tr ? 'Bir masa seç, kurallar hazır.' : 'Pick a table. The rules are ready.'}</h2>
        <p className="hub-hero-sub">
          {tr
            ? 'Tahta, taşlar, zarlar ve kural motoru hazır kurulu. Yerel botlarla anında oyna ya da 5 haneli kodla arkadaşlarını davet et.'
            : 'Boards, pieces, dice and rule engines come pre-assembled. Play instantly with local bots or invite friends with a 5-character code.'}
        </p>
      </section>

      {props.error ? (
        <p className="hub-error" role="alert">
          {props.error}
        </p>
      ) : null}

      <div className="hub-grid">
        {GAME_CATALOG.map((game) => (
          <article
            key={game.id}
            className={`hub-card hub-card--${game.id}`}
            style={{ ['--game-accent' as string]: game.accent }}
          >
            <div className="hub-card-head">
              <span className="hub-card-icon" aria-hidden="true">
                {game.icon}
              </span>
              <span className="hub-card-badge">{game.players}</span>
            </div>

            <h3>{game.title}</h3>
            <p className="hub-card-sub">{game.subtitle}</p>
            <p className="hub-card-desc">{game.description}</p>

            <ul className="hub-card-facts">
              {game.highlights.map((item) => (
                <li key={item}>{item}</li>
              ))}
              <li>{game.duration}</li>
            </ul>

            <div className="hub-card-actions">
              <button
                type="button"
                className="hub-btn hub-btn--primary"
                disabled={props.busy}
                onClick={() => props.onPlayLocal(game.id)}
              >
                🎮 {tr ? 'Hemen Oyna' : 'Play Now'}
              </button>
              <button
                type="button"
                className="hub-btn"
                disabled={props.busy}
                onClick={() => props.onCreateRoom(game.id)}
              >
                🌐 {tr ? 'Çevrimiçi Oda Kur' : 'Create Online Room'}
              </button>
              <button
                type="button"
                className="hub-btn hub-btn--ghost"
                disabled={props.busy}
                aria-expanded={joinFor === game.id}
                onClick={() => openJoin(game.id)}
              >
                🔑 {tr ? 'Kodla Katıl' : 'Join with Code'}
              </button>
            </div>

            {joinFor === game.id ? (
              <form className="hub-join" onSubmit={submitJoin} noValidate>
                <input
                  className={codeError ? 'hub-input hub-code-input invalid' : 'hub-input hub-code-input'}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value.toUpperCase());
                    setCodeError(null);
                  }}
                  placeholder={tr ? 'ODA KODU' : 'ROOM CODE'}
                  maxLength={ROOM_CODE_LENGTH}
                  autoCapitalize="characters"
                  aria-invalid={codeError ? true : undefined}
                  aria-label={tr ? 'Oda kodu' : 'Room code'}
                />
                <button type="submit" className="hub-btn hub-btn--primary" disabled={props.busy}>
                  {tr ? 'Katıl' : 'Join'}
                </button>
                {codeError ? (
                  <p className="hub-join-error" role="alert">
                    {codeError}
                  </p>
                ) : null}
              </form>
            ) : null}
          </article>
        ))}
      </div>

      <footer className="hub-footer">
        <span>{tr ? 'Yerel mod çevrimdışı çalışır · Çevrimiçi oda 5 haneli kodla paylaşılır' : 'Local mode works offline · Share online rooms with a 5-character code'}</span>
      </footer>
    </main>
  );
}
