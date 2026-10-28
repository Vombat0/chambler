import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CHAT_MAX_LENGTH } from './chat.js';
import { chatCounter } from './validation.js';
import { ClientChatGate } from './chat.js';
import { useT } from './i18nContext.js';

export interface ChatMessage {
  readonly id: string;
  readonly playerName: string;
  readonly text: string;
  readonly sentAt: number;
}

export interface ChatPanelProps {
  messages: readonly ChatMessage[];
  onSend: (text: string) => void;
  /** Katılmışsın gibi görünme; kullanıcı adı hâlen gerekli. */
  playerName: string;
  compact?: boolean;
}

/**
 * D1 — Sohbet paneli (lobby + HUD ortak). 300 karakter sayacı ve istemci
 * tarafı hız sınırı geri bildirimi sunar. `role="log"` ile yeni mesajlar
 * ekran okuyuculara bildirilir.
 */
export function ChatPanel({ messages, onSend, playerName, compact }: ChatPanelProps) {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const gate = useRef(new ClientChatGate());
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = gate.current.submit(playerName, draft);
    if (!result.allowed) {
      setFeedback(
        result.reason === 'rate_limited'
          ? t('err.CHAT_RATE_LIMITED')
          : result.reason === 'too_long'
            ? t('err.CHAT_TOO_LONG')
            : t('err.CHAT_EMPTY'),
      );
      return;
    }
    setFeedback(null);
    setDraft('');
    onSend(result.text);
  }

  const overLimit = Array.from(draft).length > CHAT_MAX_LENGTH;

  return (
    <section className={compact ? 'chat chat-compact' : 'chat'} aria-label={t('hud.chat.label')}>
      <div className="chat-log" ref={logRef} role="log" aria-live="polite">
        {messages.length === 0 ? <p className="muted chat-empty">{t('hud.chat.label')}</p> : null}
        {messages.map((message) => (
          <p key={message.id} className="chat-line">
            <strong>{message.playerName}:</strong> {message.text}
          </p>
        ))}
      </div>
      <form className="chat-form" onSubmit={submit} noValidate>
        <label className="visually-hidden" htmlFor="chat-input">
          {t('hud.chat.label')}
        </label>
        <input
          id="chat-input"
          className="text-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setFeedback(null);
          }}
          placeholder={t('hud.chat.placeholder')}
          aria-describedby={feedback ? 'chat-feedback' : 'chat-counter'}
          aria-invalid={feedback ? true : undefined}
        />
        <span className={`chat-counter${overLimit ? ' over' : ''}`} id="chat-counter" aria-live="polite">
          {chatCounter(draft, CHAT_MAX_LENGTH)}
        </span>
        <button type="submit" className="button primary" disabled={overLimit}>
          {t('hud.chat.send')}
        </button>
        {feedback ? (
          <p className="inline-error" id="chat-feedback" role="alert">
            {feedback}
          </p>
        ) : null}
      </form>
    </section>
  );
}
