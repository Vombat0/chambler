import { useState } from 'react';
import type { ConnectionStatus } from '../net/NetworkClient.js';
import type { PlayerInfo } from '@chambler/shared';
import { colorKeyOf } from './lobby.js';
import { ChatPanel, type ChatMessage } from './ChatPanel.js';
import { statusPresentation } from './status.js';
import { useT } from './i18nContext.js';
import type { Language } from './settings.js';

export interface HudProps {
  /** Oda kodu; yerel oyun ve locale geçildiğinde null. */
  roomCode: string | null;
  players: readonly PlayerInfo[];
  selfId: string;
  /** Yerel/çevrimdışı masa: durum kolu "çevrimdışı" gösterir. */
  localMode: boolean;
  connectionStatus: ConnectionStatus;
  messages: readonly ChatMessage[];
  onSendChat: (text: string) => void;
  fps: number;
  onOpenSettings: () => void;
  onLeave: () => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
}

/**
 * D1 — Oyun içi HUD: oda kodu, oyuncular (aktif renk sahibi göstergesi),
 * katlanabilir sohbet, bağlantı durumu (aria-live), FPS, ayarlar ve çıkış.
 * Canvas'ın üzerine position:absolute katman; pointer olayları panel
 * kontrolleriyle sınırlıdır, 3D sürükleme etkinliği bozulmaz.
 */
export function Hud(props: HudProps) {
  const { t } = useT();
  const [chatOpen, setChatOpen] = useState(true);
  const status = props.localMode || props.connectionStatus === 'idle'
    ? { key: 'status.offline' as const, priority: 'polite' as const, tone: 'ok' as const }
    : statusPresentation(props.connectionStatus);
  const self = props.players.find((player) => player.id === props.selfId);

  return (
    <aside className="hud" aria-label={t('hud.players.label')}>
      <div className="hud-row">
        <span className="hud-code">
          <span className="field-label">{t('hud.room.label')}</span>
          <code aria-label={`${t('hud.room.label')}: ${props.roomCode ?? ''}`}>{props.roomCode ?? '—'}</code>
        </span>
        <span
          className={`status-pill ${status.tone}`}
          role="status"
          aria-live={status.priority}
          aria-label={t('region.status')}
        >
          {t(status.key)}
        </span>
        <span className="fps">{props.fps} fps</span>
        <select
          className="select hud-lang"
          aria-label={t('settings.language.label')}
          value={props.language}
          onChange={(event) => props.onLanguageChange(event.target.value as Language)}
        >
          <option value="tr">{t('lang.tr')}</option>
          <option value="en">{t('lang.en')}</option>
        </select>
        <button type="button" className="button ghost" onClick={props.onLeave}>
          {t('hud.leave')}
        </button>
        <button
          type="button"
          className="button ghost"
          onClick={() => setChatOpen((open) => !open)}
          aria-expanded={chatOpen}
          aria-controls="hud-chat-panel"
        >
          {chatOpen ? t('hud.chat.close') : t('hud.chat.open')}
        </button>
        <button type="button" className="button ghost gear" onClick={props.onOpenSettings}>
          ⚙<span className="visually-hidden">{t('hud.settings.open')}</span>
        </button>
      </div>

      <div className="hud-players" role="group" aria-label={t('hud.players.label')}>
        {props.players.map((player) => (
          <span key={player.id} className="player-chip">
            <span
              className={`player-swatch${player.id === props.selfId ? ' mine' : ''}`}
              style={{ background: player.color }}
              aria-hidden="true"
            />
            <span className="player-colorname">
              {t(colorKeyOf(player.color) ?? 'err.UNKNOWN')}
            </span>
            <strong>{player.name}</strong>
            {player.id === props.selfId ? <span className="badge outline">{t('hud.youBadge')}</span> : null}
            {player.isHost ? <span className="badge">{t('hud.hostBadge')}</span> : null}
          </span>
        ))}
      </div>

      {chatOpen ? (
        <ChatPanel
          compact
          messages={props.messages}
          onSend={props.onSendChat}
          playerName={self?.name ?? ''}
        />
      ) : null}
    </aside>
  );
}

