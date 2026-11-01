import { useCallback, useMemo, useRef, useState } from 'react';
import { NetworkClient } from './net/NetworkClient';
import { browserStorage, loadSettings, saveSettings, type Language, type Settings } from './ui/settings';
import { I18nProvider } from './ui/i18nContext';
import { GameHubScreen, GAME_CATALOG, type GameId } from './ui/GameHubScreen';
import { SettingsModal } from './ui/SettingsModal';
import { MonopolyEntry } from './games/monopoly';
import { RiskGameView } from './games/risk';
import { CarcassonneGameView } from './games/carcassonne/CarcassonneGameView';

/**
 * Tek servis dağıtımı: frontend ve backend aynı origin'den sunulur.
 * Geliştirmede VITE_CHAMBLER_URL ile ayrı sunucuya yönlendirilebilir.
 */
const SERVER_URL = String(import.meta.env.VITE_CHAMBLER_URL ?? window.location.origin);
const DEFAULT_NAME = 'Oyuncu';

interface ActiveGame {
  readonly id: GameId;
  readonly roomCode: string | null;
}

function nameOf(game: GameId): string {
  return GAME_CATALOG.find((entry) => entry.id === game)?.title ?? game;
}

/**
 * R0 — Uygulama kabuğu: Oyun Vitrini + üç tam oyun.
 *
 * Eski masa simülatörü (paket yükle, palet, nesne ekle) kaldırıldı. Her oyun
 * kendi tahtası, taşları, zarları ve kural motoruyla doğrudan açılır.
 */
export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(browserStorage));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [active, setActive] = useState<ActiveGame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ncRef = useRef<NetworkClient | null>(null);

  const tr = settings.language === 'tr';

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      saveSettings(browserStorage, next);
      return next;
    });
  }, []);

  const changeLanguage = useCallback(
    (language: Language) => patchSettings({ language }),
    [patchSettings],
  );

  const leaveRoom = useCallback(async () => {
    const client = ncRef.current;
    ncRef.current = null;
    if (client) {
      try {
        await client.leave();
      } catch {
        // Oda zaten kapanmış olabilir; vitrine dönüş engellenmez.
      }
    }
  }, []);

  const playLocal = useCallback((game: GameId) => {
    setError(null);
    setNotice(null);
    setActive({ id: game, roomCode: null });
  }, []);

  const createRoom = useCallback(
    async (game: GameId) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const client = ncRef.current ?? new NetworkClient(SERVER_URL);
        ncRef.current = client;
        const room = await client.createAndJoin(settings.name.trim() || DEFAULT_NAME);
        setActive({ id: game, roomCode: room.roomId });
        setNotice(room.roomId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await leaveRoom();
      } finally {
        setBusy(false);
      }
    },
    [busy, leaveRoom, settings.name],
  );

  const joinRoom = useCallback(
    async (game: GameId, code: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const client = ncRef.current ?? new NetworkClient(SERVER_URL);
        ncRef.current = client;
        const room = await client.join(code, settings.name.trim() || DEFAULT_NAME);
        setActive({ id: game, roomCode: room.roomId });
        setNotice(null);
      } catch (err) {
        setError(
          tr
            ? `Odaya katılınamadı: ${err instanceof Error ? err.message : String(err)}`
            : `Could not join the room: ${err instanceof Error ? err.message : String(err)}`,
        );
        await leaveRoom();
      } finally {
        setBusy(false);
      }
    },
    [busy, leaveRoom, settings.name, tr],
  );

  const exitGame = useCallback(() => {
    setActive(null);
    setNotice(null);
    setError(null);
    void leaveRoom();
  }, [leaveRoom]);

  const game = useMemo(() => {
    if (!active) return null;
    switch (active.id) {
      case 'monopoly':
        return <MonopolyEntry language={settings.language} onExit={exitGame} />;
      case 'risk':
        return <RiskGameView onExit={exitGame} />;
      case 'carcassonne':
        return <CarcassonneGameView onExit={exitGame} />;
      default:
        return null;
    }
  }, [active, exitGame, settings.language]);

  return (
    <I18nProvider language={settings.language}>
      <div className="app">
        {active ? (
          <div className="game-stage" aria-label={nameOf(active.id)}>
            {game}
            {active.roomCode ? (
              <div className="game-room-chip" role="status">
                🌐 {tr ? 'Oda' : 'Room'} <b>{active.roomCode}</b>
                <button
                  type="button"
                  className="game-room-copy"
                  onClick={() => {
                    void navigator.clipboard?.writeText(active.roomCode ?? '').catch(() => undefined);
                  }}
                >
                  {tr ? 'Kopyala' : 'Copy'}
                </button>
              </div>
            ) : null}
            {notice ? (
              <div className="room-modal-backdrop" role="dialog" aria-modal="true" aria-label={tr ? 'Oda hazır' : 'Room ready'}>
                <div className="room-modal">
                  <p className="room-modal-kicker">{tr ? 'ODA HAZIR' : 'ROOM READY'}</p>
                  <h2>{tr ? 'Arkadaşlarını davet et' : 'Invite your friends'}</h2>
                  <p className="room-modal-text">
                    {tr
                      ? 'Bu 5 haneli kodu paylaş; arkadaşların vitrinden “Kodla Katıl” ile aynı odaya girsin.'
                      : 'Share this 5-character code so friends can join the same room from the hub.'}
                  </p>
                  <div className="room-modal-code">
                    <span>{notice}</span>
                    <button
                      type="button"
                      className="hub-btn hub-btn--primary"
                      onClick={() => {
                        void navigator.clipboard?.writeText(notice).catch(() => undefined);
                      }}
                    >
                      {tr ? 'Kopyala' : 'Copy'}
                    </button>
                  </div>
                  <button type="button" className="hub-btn" onClick={() => setNotice(null)}>
                    {tr ? 'Masaya Otur' : 'Sit at the table'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <GameHubScreen
            language={settings.language}
            playerName={settings.name}
            busy={busy}
            error={error}
            onPlayerNameChange={(name) => patchSettings({ name })}
            onLanguageChange={changeLanguage}
            onOpenSettings={() => setSettingsOpen(true)}
            onPlayLocal={playLocal}
            onCreateRoom={(id) => { void createRoom(id); }}
            onJoinRoom={(id, code) => { void joinRoom(id, code); }}
          />
        )}

        <SettingsModal
          open={settingsOpen}
          settings={settings}
          allowTableReset={false}
          onChange={patchSettings}
          onLanguageChange={changeLanguage}
          onResetTable={() => undefined}
          onClose={() => setSettingsOpen(false)}
        />
      </div>
    </I18nProvider>
  );
}
