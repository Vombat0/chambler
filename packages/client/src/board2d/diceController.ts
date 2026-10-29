/**
 * FIX-PLAYABILITY-1 — Evrensel zar denetleyicisi (2D + 3D).
 *
 * Zar sahibi artık App seviyesinde: `Board2DView` yalnızca 2D modda monte
 * olduğu için zar makinesi de onun içindeydi ve 3D modda "Zar At" butonu hiç
 * yoktu. Denetleyici, `DiceModel` + rAF tik + ağ bağlantısını (spawn /
 * release+claim+dieResult / uzak dinleme / sohbet duyurusu) tek yerde toplar;
 * hem `DicePanel` (her modda görünür) hem de `Board2DView` aynı anlık
 * görüntüyü `useSyncExternalStore` ile okur.
 *
 * Sunucu sözleşmesi değişmedi: zar, sahibi tarafından raporlanan yetkili bir
 * nesnedir (`dieObjectId(selfId)`, meta.faces = 12 → toplam 2..12). Yankı ve
 * yeniden bağlanma replikleri burada süzülür.
 */

import type { Language } from '../ui/settings.js';
import { DiceModel, type DicePhase } from './diceModel.js';
import { asWireRoom, dieDef, dieObjectId, type WireRoom } from './board2dBridge.js';
import { makeB2dT } from './strings.js';

export interface DiceSnapshot {
  readonly phase: DicePhase;
  /** Animasyonluk yüzler (rolling sırasında döner). */
  readonly a: number;
  readonly b: number;
  readonly rollId: number;
  /** Son duran toplam (hiç atış yoksa null). */
  readonly sum: number | null;
  readonly rollerId: string | null;
  /** Duran son atışın yüzleri (banner/duyuru için sabit). */
  readonly lastA: number;
  readonly lastB: number;
}

export interface DiceContext {
  getRoom: () => unknown;
  selfId: string;
  selfName: string;
  localMode: boolean;
  language: Language;
  /** Yerel masa: sohbet duyurusu doğrudan mesaj listesine eklenir. */
  onLocalChat?: (text: string) => void;
}

const IDLE: DiceSnapshot = {
  phase: 'idle',
  a: 1,
  b: 1,
  rollId: 0,
  sum: null,
  rollerId: null,
  lastA: 1,
  lastB: 1,
};

export class DiceController {
  private readonly model = new DiceModel();
  private readonly listeners = new Set<() => void>();
  private snapshot: DiceSnapshot = IDLE;
  private lastUi = '';

  private ctx: DiceContext = {
    getRoom: () => null,
    selfId: '',
    selfName: '',
    localMode: true,
    language: 'tr',
  };

  private wiredRoom: WireRoom | null = null;
  private wiredAt = 0;
  private dieSpawnRoom: WireRoom | null = null;
  private dieSpawnId = '';

  private running = false;
  private raf = 0;

  /** App her render'da güncel bağlamı verir (oda/self/dil). */
  bind(ctx: DiceContext): void {
    this.ctx = ctx;
    this.ensureRoom();
    this.ensureDie();
  }

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  };

  getSnapshot = (): DiceSnapshot => this.snapshot;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.raf = window.requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.raf !== 0) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** "ZAR AT": yerel atış başlatır; dönüyken yok sayılır. */
  roll(): void {
    this.ensureRoom();
    this.ensureDie();
    if (!this.model.roll(Date.now(), this.ctx.selfId || null)) return;
    this.publish();
  }

  private loop = (): void => {
    if (!this.running) return;
    this.raf = window.requestAnimationFrame(this.loop);
    this.ensureRoom();
    const now = Date.now();
    if (this.model.tick(now)) this.onOwnSettled();
    this.publish();
  };

  /* ------------------------------- ağ bağlantısı ------------------------------ */

  private ensureRoom(): void {
    const room = asWireRoom(this.ctx.getRoom());
    if (!room || room === this.wiredRoom) return;
    this.wiredRoom = room;
    this.wiredAt = Date.now();
    room.onMessage('dieResult', this.onRemoteDie);
  }

  /** Zar nesnesini bir kez spawn eder (oda + oyuncu başına). */
  private ensureDie(): void {
    const room = this.wiredRoom;
    if (!room || !this.ctx.selfId || this.ctx.localMode) return;
    if (this.dieSpawnRoom === room && this.dieSpawnId === this.ctx.selfId) return;
    this.dieSpawnRoom = room;
    this.dieSpawnId = this.ctx.selfId;
    const def = dieDef(this.ctx.selfId);
    // Zar mantıksal bir nesnedir; 3D masada üst üste binmesin diye hafifçe
    // saçılır (2D görünüm konumu hiç kullanmaz).
    def.transform = {
      ...def.transform,
      position: {
        x: Math.round((Math.random() * 3 - 1.5) * 100) / 100,
        y: 0.5,
        z: Math.round((Math.random() * 3 - 1.5) * 100) / 100,
      },
    };
    room.send('objectSpawn', { object: def });
  }

  private onRemoteDie = (message: unknown): void => {
    const msg = message as { objectId?: unknown; playerId?: unknown; value?: unknown; at?: unknown } | null;
    if (!msg || typeof msg.value !== 'number' || !Number.isInteger(msg.value)) return;
    const objectId = typeof msg.objectId === 'string' ? msg.objectId : '';
    const playerId = typeof msg.playerId === 'string' ? msg.playerId : null;
    if (objectId === dieObjectId(this.ctx.selfId) || playerId === this.ctx.selfId) return;
    // Bağlanma anından eski kayıtlar = yeniden bağlanma repliği → animasyon yok.
    if (typeof msg.at === 'number' && msg.at < this.wiredAt - 1500) return;
    this.model.rollFixed(Date.now(), msg.value, playerId);
    this.publish();
  };

  /* --------------------------- kendi atışımız durdu --------------------------- */

  private onOwnSettled(): void {
    const st = this.model.state;
    if (st.lastPlayerId !== (this.ctx.selfId || null)) return;
    const value = st.a + st.b;
    const text = this.announceText(st.a, st.b, value);
    const room = this.wiredRoom;
    if (room && !this.ctx.localMode && this.ctx.selfId) {
      // Sunucu yetkili rapor: taze claim epoch'u + sonuç + sohbet duyurusu.
      const dieId = dieObjectId(this.ctx.selfId);
      room.send('objectRelease', { objectId: dieId });
      room.send('objectClaim', { objectId: dieId });
      room.send('dieResult', { objectId: dieId, value });
      room.send('chat', { text });
    } else {
      this.ctx.onLocalChat?.(text);
    }
  }

  private announceText(a: number, b: number, sum: number): string {
    const t = makeB2dT(this.ctx.language);
    return t('b2d.dice.announce', { name: this.ctx.selfName || t('b2d.token.you'), a, b, sum });
  }

  /* --------------------------------- yayın ----------------------------------- */

  private publish(): void {
    const st = this.model.state;
    const faces = this.model.facesAt(Date.now());
    const next: DiceSnapshot = {
      phase: st.phase,
      a: faces.a,
      b: faces.b,
      rollId: st.rollId,
      sum: st.lastSum,
      rollerId: st.lastPlayerId,
      lastA: st.a,
      lastB: st.b,
    };
    const key = `${next.phase}:${next.a}:${next.b}:${next.rollId}:${next.sum}:${next.rollerId}`;
    if (key === this.lastUi) return;
    this.lastUi = key;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
