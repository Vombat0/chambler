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
import { PLAYER_COLORS } from './ui/lobby';
import { PALETTE_ITEMS, pawnItem, type PaletteItemDef } from './palette/paletteItems';
import { PalettePanel } from './palette/PalettePanel';
import { TableTools } from './palette/TableTools';
import { occupiedFrom, planPaletteSpawn } from './palette/paletteSpawn';
import { createSpawnQueue } from './palette/spawnQueue';
import { OptimisticSpawns, SPAWN_REJECT_CODES } from './palette/optimistic';
import {
  buildPackTable,
  initialProgress,
  stepProgress,
  PACK_STEPS,
  type PackLoadProgress,
  type PackStepId,
} from './palette/packLoader';
import { fetchPropertyTycoonManifest } from './palette/packSource';

const delay = (ms: number) => new Promise<void>((resolve) => { window.setTimeout(resolve, ms); });

/** Masa tarafındaki nesneleri placer girdisine çevirir. */
function tableOccupied(controller: InteractionController) {
  return occupiedFrom(
    controller.objects.list().map((object) => ({
      kind: object.def.kind,
      x: object.mesh.position.x,
      z: object.mesh.position.z,
    })),
  );
}

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [packProgress, setPackProgress] = useState<PackLoadProgress | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const errorSeq = useRef(0);
  const playersRef = useRef<PlayerInfo[]>([]);
  const settingsRef = useRef<Settings>(settings);
  const selfIdRef = useRef<string>('');
  const stateRef = useRef(state);
  const isHostRef = useRef(true);
  const optimisticRef = useRef(new OptimisticSpawns());
  const spawnPumpRef = useRef<number | null>(null);
  const applySpawnRef = useRef<(def: ObjectDef) => void>(() => undefined);
  const spawnQueueRef = useRef(createSpawnQueue<ObjectDef>((def) => applySpawnRef.current(def)));
  const paletteApiRef = useRef<{
    spawn: (item: PaletteItemDef, count: number, color: string) => number;
    loadPack: () => Promise<void>;
    clearTable: () => void;
  } | null>(null);

  playersRef.current = players;
  settingsRef.current = settings;
  selfIdRef.current = selfId;
  stateRef.current = state;
  const localMode = !state.online;
  const isHost = localMode || players.some((player) => player.id === selfId && player.isHost);
  isHostRef.current = isHost;

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
        // Optimistik spawn: sunucu reddi → yerel nesneyi geri al.
        if (SPAWN_REJECT_CODES.includes(message.code)) {
          const notice = optimisticRef.current.rejectOldest(performance.now());
          if (notice) controllerRef.current?.objects.remove(notice.id);
        }
        pushError(message.code, message.message);
      });
      // Kendi spawn'ımızın onayı: aynı id ile yayın geldiğinde bekleme biter.
      room.onMessage('objectSpawn', (raw) => {
        const message = raw as { object?: { id?: unknown } };
        const id = message?.object?.id;
        if (typeof id === 'string') optimisticRef.current.confirm(id);
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

  /* ----------------------------- palet / araçlar ---------------------------- */

  // Yerel spawn: her zaman sahnede; online ise ağa da iletilir + optimistik izlenir.
  const applySpawn = useCallback((def: ObjectDef) => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.spawn(def);
    if (stateRef.current.online) {
      optimisticRef.current.track(def.id, performance.now());
      ncRef.current?.getRoom()?.send('objectSpawn', { object: def });
    }
  }, []);
  applySpawnRef.current = applySpawn;

  const pumpSpawnQueue = useCallback(() => {
    if (spawnPumpRef.current !== null) return;
    const step = () => {
      spawnQueueRef.current.drainFrame();
      if (spawnQueueRef.current.pending() > 0) {
        spawnPumpRef.current = window.requestAnimationFrame(step);
      } else {
        spawnPumpRef.current = null;
      }
    };
    spawnPumpRef.current = window.requestAnimationFrame(step);
  }, []);

  // Ekran değişiminde bekleyen kareleri iptal et.
  useEffect(() => () => {
    if (spawnPumpRef.current !== null) window.cancelAnimationFrame(spawnPumpRef.current);
    spawnPumpRef.current = null;
  }, []);

  const addFromPalette = useCallback(
    (item: PaletteItemDef, count: number, color: string): number => {
      const controller = controllerRef.current;
      if (!controller) return 0;
      const plan = planPaletteSpawn({
        item,
        count,
        color,
        occupied: tableOccupied(controller),
      });
      spawnQueueRef.current.push(plan.defs);
      pumpSpawnQueue();
      if (plan.defs.length === 0) pushError('TABLE_FULL');
      return plan.defs.length;
    },
    [pumpSpawnQueue, pushError],
  );

  const clearTable = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (stateRef.current.online && !isHostRef.current) {
      pushError('HOST_ONLY');
      return;
    }
    const room = ncRef.current?.getRoom();
    for (const object of controller.objects.list()) {
      controller.objects.remove(object.def.id);
      if (stateRef.current.online) room?.send('objectRemove', { objectId: object.def.id });
    }
    spawnQueueRef.current.clear();
    optimisticRef.current.reset();
  }, [pushError]);

  const loadPack = useCallback(async () => {
    if (packBusy) return;
    const controller = controllerRef.current;
    setPackBusy(true);
    let progress = initialProgress();
    setPackProgress(progress);
    let currentStep: PackStepId = 'validate';

    const mark = (id: PackStepId, status: 'running' | 'ok' | 'failed', message?: string) => {
      progress = stepProgress(progress, id, status, message);
      setPackProgress(progress);
    };

    try {
      if (!controller) throw new Error('Table is not ready');
      mark('validate', 'running');
      await delay(60);
      const manifest = await fetchPropertyTycoonManifest();
      mark('validate', 'ok');

      // Aynı paket daha önce yüklendiyse önce onu kaldır (üst üste tahta olmasın).
      const room = ncRef.current?.getRoom();
      for (const object of controller.objects.list()) {
        if (object.def.meta.sourcePack !== manifest.packId) continue;
        controller.objects.remove(object.def.id);
        if (stateRef.current.online) room?.send('objectRemove', { objectId: object.def.id });
      }

      const table = buildPackTable(manifest, tableOccupied(controller));

      for (const id of PACK_STEPS) {
        if (id === 'validate') continue;
        currentStep = id;
        mark(id, 'running');
        await delay(120);
        spawnQueueRef.current.push(table.defsByStep[id]);
        pumpSpawnQueue();
        mark(id, 'ok');
      }

      if (table.skipped > 0) pushError('PACK_PARTIAL', `${table.skipped} objects skipped`);
    } catch (error) {
      mark(currentStep, 'failed', error instanceof Error ? error.message : String(error));
      pushError('PACK_INVALID', error instanceof Error ? error.message : String(error));
    } finally {
      setPackBusy(false);
    }
  }, [packBusy, pumpSpawnQueue, pushError]);

  paletteApiRef.current = { spawn: addFromPalette, loadPack, clearTable };

  // `B` kısayolu paleti açar/kapatır (yazı alanlarında ve modallarda değil).
  useEffect(() => {
    if (state.screen !== 'table') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'b' && event.key !== 'B') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (state.settingsOpen) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      setPaletteOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.screen, state.settingsOpen]);

  // Masadan çıkınca palet kapansın.
  useEffect(() => {
    if (state.screen !== 'table') setPaletteOpen(false);
  }, [state.screen]);

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
          isHost: isHostRef.current,
          paletteItems: [...PALETTE_ITEMS.map((item) => item.id), pawnItem().id],
          openPalette: () => setPaletteOpen(true),
          closePalette: () => setPaletteOpen(false),
          spawnPaletteItem: (id: string, count = 1, color?: string) => {
            const item = id === 'pawn'
              ? pawnItem()
              : PALETTE_ITEMS.find((entry) => entry.id === id);
            const api = paletteApiRef.current;
            if (!item || !api) return 0;
            return api.spawn(item, count, color ?? PLAYER_COLORS[0]);
          },
          loadPack: () => paletteApiRef.current?.loadPack(),
          clearTable: () => paletteApiRef.current?.clearTable(),
          objectCount: () => controller.objects.count(),
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
        <TableTools
          paletteOpen={paletteOpen}
          onTogglePalette={() => setPaletteOpen((open) => !open)}
          packProgress={packProgress}
          packBusy={packBusy}
          onLoadPack={() => { void loadPack(); }}
          onClearTable={clearTable}
          canClear={isHost}
          isHost={isHost}
        />
        <PalettePanel
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onAdd={addFromPalette}
        />
        {overlays}
      </div>
    </I18nProvider>
  );
}
