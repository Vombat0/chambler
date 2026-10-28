import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ObjectDef, PlayerInfo } from '@chambler/shared';
import { SceneManager } from './sim/SceneManager';
import { InteractionController } from './input/InteractionController';
import { InspectController } from './inspect/InspectController';
import { NetworkClient, type ConnectionStatus } from './net/NetworkClient';
import { browserStorage, loadSettings, saveSettings, type Language, type Settings } from './ui/settings';
import { I18nProvider } from './ui/i18nContext';
import { createAppMachine } from './ui/router';
import { HomeScreen } from './ui/HomeScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { Hud } from './ui/Hud';
import { SettingsModal } from './ui/SettingsModal';
import { ErrorToasts, type AppError } from './ui/ErrorToasts';
import type { ChatMessage } from './ui/ChatPanel';
import { joinFailureCode } from './ui/errors';
import { sanitizeChatText } from './ui/chat';
import { applySettingsToScene } from './ui/settingsApply';

/* A6 demo seti — yalnızca yerel/çevrimdışı masada spawn edilir. */
const DEMO_DEFS: ObjectDef[] = [
  {
    id: 'die_demo',
    kind: 'die',
    assetRef: '',
    transform: { position: { x: 0.0, y: 0.6, z: -0.2 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {},
  },
  {
    id: 'card_demo',
    kind: 'card',
    assetRef: 'risk/i-build-kizil-kule',
    transform: { position: { x: 3.2, y: 0.05, z: 0.5 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: { name: 'Kızıl Kule', type: 'Bina Kartı', description: 'Üç tur boyunca saldırı zarını iki katına çıkarır; yıkılırsa bölge düşer.' },
  },
  {
    id: 'tile_demo',
    kind: 'tile',
    assetRef: 'carcassonne/yol-kavsagi',
    transform: { position: { x: -1.2, y: 0.05, z: 1.8 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: { name: 'Yol Kavşağı', edges: { north: 'yol', east: 'tarla', south: 'tarla', west: 'yol' }, rotation: 90 },
  },
  {
    id: 'board_demo',
    kind: 'board',
    assetRef: 'risk/orta-dunya',
    transform: { position: { x: -1.0, y: 0.06, z: -1.6 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {
      name: 'Orta Dünya',
      slots: [
        { id: 'A1', position: { x: -2.5, y: -1.0, z: 0 } },
        { id: 'B1', position: { x: -1.0, y: -1.0, z: 0 } },
        { id: 'C1', position: { x: 0.5, y: -1.0, z: 0 } },
      ],
    },
  },
  {
    id: 'token_demo',
    kind: 'token',
    assetRef: 'generic/kervan-tokeni',
    transform: { position: { x: 2.4, y: 0.12, z: 1.6 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: { name: 'Kervan', label: 'Kervan', count: 3 },
  },
];

const SERVER_URL = String(import.meta.env.VITE_CHAMBLER_URL ?? 'http://localhost:3001');
/** Yerel masanın tek oyuncusu (offline HUD gösterimi). */
const LOCAL_PLAYER: PlayerInfo = { id: 'local', name: 'Yerel', color: '#e63946', seat: 0, isHost: true };

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(browserStorage));
  const machine = useMemo(() => createAppMachine(), []);
  const state = useSyncExternalStore(machine.subscribe, machine.getSnapshot);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const managerRef = useRef<Awaited<ReturnType<typeof SceneManager.create>> | null>(null);
  const controllerRef = useRef<InteractionController | null>(null);
  const ncRef = useRef<NetworkClient | null>(null);

  const [fps, setFps] = useState(0);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<AppError[]>([]);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [selfId, setSelfId] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const errorSeq = useRef(0);
  const playersRef = useRef<PlayerInfo[]>([]);
  const settingsRef = useRef<Settings>(settings);
  const selfIdRef = useRef<string>('');

  playersRef.current = players;
  settingsRef.current = settings;
  selfIdRef.current = selfId;

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      saveSettings(browserStorage, next);
      return next;
    });
  }, []);

  const pushError = useCallback((code: string, serverMessage = '') => {
    errorSeq.current += 1;
    const id = errorSeq.current;
    setErrors((previous) => [...previous.slice(-3), { id, code, serverMessage }]);
    window.setTimeout(() => {
      setErrors((previous) => previous.filter((error) => error.id !== id));
    }, 6000);
  }, []);

  const dismissError = useCallback((id: number) => {
    setErrors((previous) => previous.filter((error) => error.id !== id));
  }, []);

  const applySettingsToSceneLive = useCallback(() => {
    const manager = managerRef.current;
    if (!manager) return;
    applySettingsToScene(
      {
        controls: manager.cameraController.controls,
        renderer: manager.renderer,
        scene: manager.scene,
      },
      settingsRef.current,
    );
  }, []);

  /* ---------------------------------- oda ---------------------------------- */

  const wireRoom = useCallback(
    (nc: NetworkClient) => {
      const room = nc.getRoom();
      if (!room) return;
      setSelfId(room.sessionId);
      room.onStateChange((nextState: unknown) => {
        const table = nextState as { players?: Map<string, PlayerInfo>; maxPlayers?: number };
        if (table.players) setPlayers([...table.players.values()]);
        if (typeof table.maxPlayers === 'number') setMaxPlayers(table.maxPlayers);
      });
      room.onMessage('chat', (raw) => {
        const message = raw as { playerId: string; text: string; sentAt: number };
        const sender = playersRef.current.find((player) => player.id === message.playerId);
        setMessages((previous) => [
          ...previous.slice(-80),
          {
            id: `${message.playerId}-${message.sentAt}-${previous.length}`,
            playerName: sender?.name ?? message.playerId,
            text: message.text,
            sentAt: message.sentAt,
          },
        ]);
      });
      room.onMessage('error', (raw) => {
        const message = raw as { code: string; message: string };
        pushError(message.code, message.message);
      });
      nc.onStatus((status) => setConnectionStatus(status));
    },
    [pushError],
  );

  const connect = useCallback(
    async (name: string, code: string | null) => {
      setBusy(true);
      try {
        const nc = ncRef.current ?? new NetworkClient(SERVER_URL);
        ncRef.current = nc;
        const room = code === null ? await nc.createAndJoin(name) : await nc.join(code, name);
        wireRoom(nc);
        machine.joinedLobby({ code: room.roomId, name });
      } catch (err) {
        pushError(joinFailureCode(err), err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [machine, pushError, wireRoom],
  );

  const sendChat = useCallback((text: string) => {
    ncRef.current?.getRoom()?.send('chat', { text: sanitizeChatText(text) ?? text });
  }, []);

  const changeSeat = useCallback((seat: number) => {
    ncRef.current?.getRoom()?.send('seat', { seat });
  }, []);

  const changeColor = useCallback((color: string) => {
    ncRef.current?.getRoom()?.send('color', { color });
  }, []);

  const leaveLobby = useCallback(() => {
    const nc = ncRef.current;
    ncRef.current = null;
    void nc?.leave().catch(() => undefined);
    setMessages([]);
    setPlayers([]);
    setSelfId('');
    setConnectionStatus('idle');
    machine.backToHome();
  }, [machine]);

  const leaveTable = useCallback(() => {
    // Online: lobiye geri (oda bağlı kalır). Offline: home.
    machine.leaveTable();
  }, [machine]);

  const resetLocalTable = useCallback(() => {
    const bridge = (window as unknown as Record<string, unknown>).__chambler as
      | { reset?: () => void }
      | undefined;
    bridge?.reset?.();
  }, []);

  const changeLanguage = useCallback((language: Language) => patchSettings({ language }), [patchSettings]);

  /* ------------------------------- 3D sahne ------------------------------- */

  useEffect(() => {
    if (state.screen !== 'table') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    SceneManager.create(canvas, { onFps: (value) => { if (!disposed) setFps(value); } })
      .then((manager) => {
        if (disposed) {
          manager.dispose();
          return;
        }
        managerRef.current = manager;
        const managerPriv = manager as unknown as { renderer: typeof manager.renderer; frame: () => void };
        const inspect = new InspectController({
          camera: manager.camera,
          domElement: canvas,
          getObjects: () => controller.objects,
          pauseRender: () => manager.renderer.setAnimationLoop(null),
          resumeRender: () => manager.renderer.setAnimationLoop(() => managerPriv.frame()),
        });
        const controller = new InteractionController(manager, { localPlayerId: selfIdRef.current || 'local' });
        controllerRef.current = controller;

        const offline = !state.online;
        // Yerel masada demo nesneleri; online masada spawn A3b/A5 ağ akışına aittir.
        if (offline) for (const def of DEMO_DEFS) controller.spawn(def);
        applySettingsToScene(
          { controls: manager.cameraController.controls, renderer: manager.renderer, scene: manager.scene },
          settingsRef.current,
        );

        (window as unknown as Record<string, unknown>).__chambler = {
          inspect,
          objects: controller.objects,
          camera: manager.camera,
          isOffline: offline,
          reset: () => {
            for (const object of controller.objects.list()) controller.objects.remove(object.def.id);
            if (offline) for (const def of DEMO_DEFS) controller.spawn(def);
          },
          applySettings: () => {
            applySettingsToScene(
              { controls: manager.cameraController.controls, renderer: manager.renderer, scene: manager.scene },
              settingsRef.current,
            );
          },
        };

        cleanup = () => {
          inspect.dispose();
          controller.dispose();
          manager.dispose();
          managerRef.current = null;
          controllerRef.current = null;
        };
      })
      .catch((err) => console.error(err));

    return () => {
      disposed = true;
      cleanup?.();
    };
    // Sahne ekran/oda modu değiştikçe yeniden kurulur; ayarlar canlı uygulanır.
  }, [state.screen, state.online, connect]);

  // Ayar değiştiğinde sahneye uygula (sahne yüklüyse).
  useEffect(() => {
    applySettingsToSceneLive();
  }, [settings, applySettingsToSceneLive]);

  /* -------------------------------- ekranlar -------------------------------- */

  const overlays = (
    <>
      <ErrorToasts errors={errors} onDismiss={dismissError} />
      <SettingsModal
        open={state.settingsOpen}
        settings={settings}
        allowTableReset={state.screen === 'table' && !state.online}
        onChange={patchSettings}
        onLanguageChange={changeLanguage}
        onResetTable={resetLocalTable}
        onClose={() => machine.closeSettings()}
      />
    </>
  );

  if (state.screen === 'home') {
    return (
      <I18nProvider language={settings.language}>
        <div className="app">
          <HomeScreen
            initialName={settings.name}
            language={settings.language}
            onLanguageChange={changeLanguage}
            onCreateRoom={(name) => { patchSettings({ name }); void connect(name, null); }}
            onJoinRoom={(code, name) => { patchSettings({ name }); void connect(name, code); }}
            onPlayLocal={(name) => { patchSettings({ name }); machine.startLocal(); }}
            onOpenSettings={() => machine.openSettings()}
            busy={busy}
          />
          {overlays}
        </div>
      </I18nProvider>
    );
  }

  if (state.screen === 'lobby') {
    return (
      <I18nProvider language={settings.language}>
        <div className="app">
          <LobbyScreen
            roomCode={state.room?.code ?? ''}
            players={players}
            selfId={selfId}
            maxPlayers={maxPlayers}
            messages={messages}
            onSendChat={sendChat}
            onSeatChange={changeSeat}
            onColorChange={changeColor}
            onStart={() => machine.enterTable()}
            onBack={leaveLobby}
            busy={busy}
          />
          {overlays}
        </div>
      </I18nProvider>
    );
  }

  const localMode = !state.online;
  return (
    <I18nProvider language={settings.language}>
      <div className="app">
        <Hud
          roomCode={localMode ? null : (state.room?.code ?? null)}
          players={localMode ? [LOCAL_PLAYER] : players}
          selfId={localMode ? 'local' : selfId}
          localMode={localMode}
          connectionStatus={connectionStatus}
          messages={messages}
          onSendChat={sendChat}
          fps={fps}
          onOpenSettings={() => machine.openSettings()}
          onLeave={leaveTable}
          language={settings.language}
          onLanguageChange={changeLanguage}
        />
        <canvas ref={canvasRef} className="table" />
        {overlays}
      </div>
    </I18nProvider>
  );
}
