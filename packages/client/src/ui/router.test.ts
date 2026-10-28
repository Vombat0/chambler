import { describe, expect, it } from 'vitest';
import { createAppMachine } from './router.js';

describe('app machine (D1)', () => {
  it(' home → lobby (oda oluşturma)programs', () => {
    const machine = createAppMachine();
    machine.joinedLobby({ code: 'ABC23', name: 'Ay' });
    const state = machine.getSnapshot();
    expect(state.screen).toBe('lobby');
    expect(state.room?.code).toBe('ABC23');
    expect(state.room?.name).toBe('Ay');
    expect(state.online).toBe(true);
  });

  it(' home → table (yerel oyna, offline)', () => {
    const machine = createAppMachine();
    machine.startLocal();
    const state = machine.getSnapshot();
    expect(state.screen).toBe('table');
    expect(state.room).toBeNull();
    expect(state.online).toBe(false);
  });

  it(' lobby → table (masaya başla) ve table → lobby dönüşü', () => {
    const machine = createAppMachine();
    machine.joinedLobby({ code: 'ABC23', name: 'Ay' });
    machine.enterTable();
    let state = machine.getSnapshot();
    expect(state.screen).toBe('table');
    expect(state.room?.code).toBe('ABC23');
    machine.leaveTable();
    state = machine.getSnapshot();
    expect(state.screen).toBe('lobby');
  });

  it(' offline tabledan çıkış home ekranına döner (lobby yok)', () => {
    const machine = createAppMachine();
    machine.startLocal();
    machine.leaveTable();
    const state = machine.getSnapshot();
    expect(state.screen).toBe('home');
    expect(state.room).toBeNull();
  });

  it(' lobbydan çıkış home ekranına döner', () => {
    const machine = createAppMachine();
    machine.joinedLobby({ code: 'XY98K', name: 'Bo' });
    machine.backToHome();
    const state = machine.getSnapshot();
    expect(state.screen).toBe('home');
    expect(state.room).toBeNull();
  });

  it(' tableda iken home ekranında oda bilgisi sıfırlanır', () => {
    const machine = createAppMachine();
    machine.joinedLobby({ code: 'XY98K', name: 'Bo' });
    machine.leaveTable();
    machine.startLocal();
    expect(machine.getSnapshot().screen).toBe('table');
    machine.backToHome();
    expect(machine.getSnapshot().room).toBeNull();
  });

  it(' lobbyden home sonra tekrar joinedLobby geçerli', () => {
    const machine = createAppMachine();
    machine.joinedLobby({ code: 'XY98K', name: 'Bo' });
    machine.backToHome();
    machine.joinedLobby({ code: 'NEW99', name: 'Bo' });
    const state = machine.getSnapshot();
    expect(state.screen).toBe('lobby');
    expect(state.room?.code).toBe('NEW99');
  });

  it(' settings modalı ekrandan bağımsız aç/kapat', () => {
    const machine = createAppMachine();
    machine.openSettings();
    expect(machine.getSnapshot().settingsOpen).toBe(true);
    machine.closeSettings();
    expect(machine.getSnapshot().settingsOpen).toBe(false);
  });

  it(' settings açıkken leaveTable modalı kapatır', () => {
    const machine = createAppMachine();
    machine.startLocal();
    machine.openSettings();
    machine.leaveTable();
    const state = machine.getSnapshot();
    expect(state.settingsOpen).toBe(false);
    expect(state.screen).toBe('home');
  });

  it(' joinedLobby geçişinde settings modal kapatılır', () => {
    const machine = createAppMachine();
    machine.openSettings();
    machine.joinedLobby({ code: 'ABC23', name: 'Ay' });
    expect(machine.getSnapshot().settingsOpen).toBe(false);
  });

  it(' table (online) iken leaveTable lobbyye döner ve koda dokunulmaz', () => {
    const machine = createAppMachine();
    machine.joinedLobby({ code: 'QQ77T', name: 'Cey' });
    machine.enterTable();
    machine.leaveTable();
    expect(machine.getSnapshot().room?.code).toBe('QQ77T');
  });

  it(' enterTable yalnızca lobbyden çalışır (tabledan dönmez)', () => {
    const machine = createAppMachine();
    machine.startLocal();
    machine.enterTable();
    // room yok, online false; geçiş yok, ekranda kal
    expect(machine.getSnapshot()).toMatchObject({ screen: 'table', online: false, room: null });
  });

  it(' subscribe dinleyicileri bilgilendirilir', () => {
    const machine = createAppMachine();
    let calls = 0;
    const unsubscribe = machine.subscribe(() => {
      calls += 1;
    });
    machine.startLocal();
    machine.leaveTable();
    expect(calls).toBe(2);
    unsubscribe();
    machine.startLocal();
    expect(calls).toBe(2); // iptal edildi, yeni çağrı gelmez
  });
});
