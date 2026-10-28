/**
 * D1 — Ekran durum makinesi (router kütüphanesi YOK, saf TS).
 *
 * Ekranlar: `home` → `lobby` → `table`. Her ekranda ayarlar (`settings`)
 * modal olarak açılabilir; hata katmanı ekran durumundan bağımsızdır
 * (bkz. ErrorToasts) ve bu makinenin parçası değildir.
 *
 * Geçiş kuralları:
 * - `home`'dan `lobby`'ye yalnızca oda bilgisi (kod + isim) ile girilir.
 * - `home`'dan `table`'a yalnızca çevrimdışı (yerel oyna) ile girilir.
 * - `table`'dan çıkış: offline → home, online → lobby.
 * - `lobby`'den çıkış her zaman `home` (oda terk edilir).
 * - Ayarlar modalı ekran değişiminde kapatılır.
 *
 * React kullanımı: `useSyncExternalStore(machine.subscribe, machine.getSnapshot)`.
 */

export type AppScreen = 'home' | 'lobby' | 'table';

export interface RoomInfo {
  readonly code: string;
  readonly name: string;
}

export interface AppState {
  readonly screen: AppScreen;
  /** Mevcut oda bilgisi; `home`'da null, lobby/table'da dolu. */
  readonly room: RoomInfo | null;
  /** `table` + `room === null` ⇒ yerel/çevrimdışı oyun. */
  readonly online: boolean;
  readonly settingsOpen: boolean;
}

export interface AppMachine {
  getSnapshot(): AppState;
  subscribe(listener: () => void): () => void;
  /** Oda oluşturuldu / kodla katıldı → lobby (online). */
  joinedLobby(info: RoomInfo): void;
  /** Yerel oyna → table (offline). */
  startLocal(): void;
  /** Host "masaya başla" → table (online). */
  enterTable(): void;
  /** Lobby → home (oda terk edilir). */
  backToHome(): void;
  /** Table → lobby (online) veya home (offline). */
  leaveTable(): void;
  openSettings(): void;
  closeSettings(): void;
}

export function createAppMachine(initial?: Partial<AppState>): AppMachine {
  let state: AppState = {
    screen: 'home',
    room: null,
    online: false,
    settingsOpen: false,
    ...initial,
  };
  const listeners = new Set<() => void>();

  function set(next: AppState): void {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    joinedLobby(info) {
      if (state.screen === 'lobby' && state.room?.code === info.code) return;
      set({ screen: 'lobby', room: info, online: true, settingsOpen: false });
    },

    startLocal() {
      if (state.screen === 'table' && !state.online) return;
      set({ screen: 'table', room: null, online: false, settingsOpen: false });
    },

    enterTable() {
      if (state.screen !== 'lobby' || !state.room) return;
      set({ ...state, screen: 'table', settingsOpen: false });
    },

    backToHome() {
      if (state.screen === 'home') return;
      set({ screen: 'home', room: null, online: false, settingsOpen: false });
    },

    leaveTable() {
      if (state.screen !== 'table') return;
      if (state.online) {
        set({ screen: 'lobby', room: state.room, online: true, settingsOpen: false });
      } else {
        set({ screen: 'home', room: null, online: false, settingsOpen: false });
      }
    },

    openSettings() {
      if (state.settingsOpen) return;
      set({ ...state, settingsOpen: true });
    },

    closeSettings() {
      if (!state.settingsOpen) return;
      set({ ...state, settingsOpen: false });
    },
  };
}
