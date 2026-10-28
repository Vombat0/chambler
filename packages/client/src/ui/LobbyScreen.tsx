import { useState } from 'react';
import type { PlayerInfo } from '@chambler/shared';
import { COLOR_KEYS, PLAYER_COLORS, availableColors, availableSeats } from './lobby.js';
import { ChatPanel, type ChatMessage } from './ChatPanel.js';
import { useT } from './i18nContext.js';

export interface LobbyScreenProps {
  roomCode: string;
  players: readonly PlayerInfo[];
  selfId: string;
  maxPlayers: number;
  messages: readonly ChatMessage[];
  onSendChat: (text: string) => void;
  onSeatChange: (seat: number) => void;
  onColorChange: (color: string) => void;
  onStart: () => void;
  onBack: () => void;
  busy: boolean;
}

/**
 * D1 — Lobi: oda kodu + kopyalama, oyuncu listesi (renk adı metin olarak
 * da gösterilir), koltuk ve renk seçimi, host için "masaya başla", sohbet.
 */
export function LobbyScreen(props: LobbyScreenProps) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const self = props.players.find((player) => player.id === props.selfId);
  const isHost = self?.isHost ?? false;
  const colors = availableColors(props.players, props.selfId);
  const seats = availableSeats(props.players, props.selfId, props.maxPlayers);

  async function copyCode() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(props.roomCode);
      } else {
        // http / eski tarayıcı yedeği
        const helper = document.createElement('textarea');
        helper.value = props.roomCode;
        helper.setAttribute('readonly', 'true');
        helper.style.position = 'fixed';
        helper.style.left = '-1000px';
        document.body.append(helper);
        helper.select();
        document.execCommand('copy');
        helper.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="lobby" aria-labelledby="lobby-title">
      <header className="lobby-head">
        <h1 id="lobby-title">{t('lobby.title')}</h1>
        <div className="lobby-code">
          <span className="field-label">{t('lobby.code.label')}</span>
          <code className="room-code" aria-label={`${t('lobby.code.label')}: ${props.roomCode}`}>
            {props.roomCode}
          </code>
          <button type="button" className="button" onClick={() => void copyCode()}>
            {copied ? t('lobby.copied') : t('lobby.copy')}
          </button>
          <button type="button" className="button ghost" onClick={props.onBack}>
            {t('lobby.back')}
          </button>
        </div>
      </header>

      <div className="lobby-body">
        <section className="lobby-panel" aria-labelledby="lobby-players-label">
          <h2 id="lobby-players-label" className="panel-title">
            {`${t('lobby.players.label')} (${props.players.length}/${props.maxPlayers})`}
          </h2>
          <ul className="player-list">
            {props.players.map((player) => (
              <li key={player.id} className="player-row">
                <span
                  className="player-swatch"
                  style={{ background: player.color }}
                  aria-hidden="true"
                />
                <strong className="player-name">{player.name}</strong>
                <span className="player-colorname">{t(COLOR_KEYS[player.color as never] ?? 'err.UNKNOWN')}</span>
                <span className="player-seat">{`${t('lobby.seat.short')} ${player.seat}`}</span>
                {player.isHost ? <span className="badge">{t('lobby.host')}</span> : null}
                {player.id === props.selfId ? <span className="badge outline">{t('lobby.you')}</span> : null}
              </li>
            ))}
          </ul>

          <h3 className="panel-title">{t('lobby.color.label')}</h3>
          <ul className="color-row" aria-label={t('lobby.color.label')}>
            {PLAYER_COLORS.map((color) => {
              const isMine = self?.color.toLowerCase() === color.toLowerCase();
              const taken = !colors.includes(color);
              return (
                <li key={color}>
                  <button
                    type="button"
                    className={isMine ? 'swatch mine' : 'swatch'}
                    style={{ background: color }}
                    onClick={() => props.onColorChange(color)}
                    disabled={taken}
                    aria-label={`${t(COLOR_KEYS[color])}${isMine ? ` (${t('lobby.you')})` : ''}${taken ? ` — ${t('err.COLOR_TAKEN')}` : ''}`}
                    aria-pressed={isMine}
                  />
                </li>
              );
            })}
          </ul>

          <h3 className="panel-title">{t('lobby.seat.short')}</h3>
          <ul className="seat-row" aria-label={t('lobby.seat.short')}>
            {seats.map((seat) => (
              <li key={seat}>
                <button
                  type="button"
                  className="seat"
                  onClick={() => props.onSeatChange(seat)}
                  aria-label={`${t('lobby.seat.short')} ${seat}`}
                >
                  {seat}
                </button>
              </li>
            ))}
          </ul>

          {isHost ? (
            <button type="button" className="button primary start" onClick={props.onStart} disabled={props.busy}>
              {t('lobby.start')}
            </button>
          ) : null}
        </section>

        <ChatPanel
          messages={props.messages}
          onSend={props.onSendChat}
          playerName={self?.name ?? ''}
        />
      </div>
    </main>
  );
}
