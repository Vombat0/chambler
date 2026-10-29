/**
 * 2D-1 — Board2DView: kristal netliğinde, tam tepeden kutu oyunu görünümü.
 *
 * Tahta veriden çizilir (paketteki `board.json` + `groups.json` + i18n):
 * 40 hücre, grup renkleri, sokak adları ve fiyatlar vektörde çizildiği için
 * her ekran yoğunluğunda jilet gibi okunur (raster büyütme yok, çarpılma yok
 * — sahne daima karenin içine sığdırılır).
 *
 * Piyonlar HTML katmanıdır (şartlı konteyner: stage karesi ölçülür, % ile
 * konumlanır): sürükle → ObjectEvents 20 Hz → köprü → diğer oyuncuda
 * interpolasyonla akıcı kayma; bırak → en yakın hücreye snap.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { PlayerInfo } from '@chambler/shared';
import type { Language } from '../ui/settings.js';
import {
  BOARD_UNITS,
  CELL_UNITS,
  buildCellGeometry,
  snapToCell,
  stackOffset,
  type CellGeom,
} from './boardGeometry.js';
import { BOARD_JSON, CHANCE_DECK, COMMUNITY_DECK, cardText, cellAccent, cellName } from './boardData.js';
import { DeckOrder } from './decks.js';
import type { DiceController } from './diceController.js';
import { TokenStore, type BoardToken } from './tokenStore.js';
import { Board2DBridge } from './board2dBridge.js';
import { makeB2dT } from './strings.js';
import { DieFace } from '../ui/DieFace.js';

export interface Board2DViewProps {
  players: readonly PlayerInfo[];
  selfId: string;
  localMode: boolean;
  language: Language;
  /** Colyseus Room ya da null (yerel masa). */
  getRoom: () => unknown;
  /** FIX-PLAYABILITY-1: App seviyesindeki evrensel zar denetleyicisi. */
  dice: DiceController;
}

interface DragState {
  pointerId: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  lastT: number;
  vx: number;
  vy: number;
}

interface DrawnCard {
  deck: 'chance' | 'community';
  index: number;
}

/* ------------------------------ küçük yardımcılar ------------------------------ */

function wrapLabel(name: string, maxChars: number): string[] {
  const words = name.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length === 0) line = word;
    else if ((line + ' ' + word).length <= maxChars) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.slice(0, 3);
}

const TYPE_GLYPH: Record<string, string> = {
  chance: '?',
  community: '≡',
  tax: '%',
  transport: '⚓',
  energy: '⚡',
  start: '→',
  jail: '▣',
  'free-parking': 'P',
  'go-to-jail': '⤳',
};

/* --------------------------------- bileşenler ---------------------------------- */

function Cell({ geom, language, cellIndex }: { geom: CellGeom; language: Language; cellIndex: number }): JSX.Element {
  const name = cellName(geom, language);
  const accent = cellAccent(geom);
  const band = 13;
  const lines = wrapLabel(name, 11);
  const glyph = TYPE_GLYPH[geom.type];
  const isCorner = geom.type === 'start' || geom.type === 'jail' || geom.type === 'free-parking' || geom.type === 'go-to-jail';
  const rotation = geom.side === 'left' ? -90 : geom.side === 'right' ? 90 : 0;

  // Grup bandı hücrenin tahta içine bakan kenarında çizilir.
  let bandRect = { x: geom.x + 3, y: geom.y + 3, w: geom.w - 6, h: band };
  if (geom.side === 'top') bandRect = { x: geom.x + 3, y: geom.y + geom.h - band - 3, w: geom.w - 6, h: band };
  if (geom.side === 'left') bandRect = { x: geom.x + geom.w - band - 3, y: geom.y + 3, w: band, h: geom.h - 6 };
  if (geom.side === 'right') bandRect = { x: geom.x + 3, y: geom.y + 3, w: band, h: geom.h - 6 };

  const cx = geom.cx;
  const cy = geom.cy;
  return (
    <g className="b2d-cell" data-cell={cellIndex}>
      <rect x={geom.x + 1.5} y={geom.y + 1.5} width={geom.w - 3} height={geom.h - 3} rx="6" className="b2d-cell-bg" />
      {!isCorner && <rect x={bandRect.x} y={bandRect.y} width={bandRect.w} height={bandRect.h} rx="4" fill={accent} opacity={0.92} />}
      {isCorner && <rect x={geom.x + 1.5} y={geom.y + 1.5} width={geom.w - 3} height={geom.h - 3} rx="6" fill={accent} opacity={0.22} />}
      {glyph && !isCorner ? (
        <text x={cx} y={geom.y + 34} textAnchor="middle" className="b2d-glyph" transform={`rotate(${rotation} ${cx} ${cy})`}>
          {glyph}
        </text>
      ) : null}
      <g transform={`rotate(${rotation} ${cx} ${cy})`}>
        {lines.map((line, i) => (
          <text key={i} x={cx} y={cy - ((lines.length - 1) * 13) / 2 + i * 13 - 1} textAnchor="middle" className="b2d-cell-name">
            {line}
          </text>
        ))}
        {typeof geom.price === 'number' ? (
          <text x={cx} y={cy + ((lines.length - 1) * 13) / 2 + 15} textAnchor="middle" className="b2d-cell-price">
            {geom.price}
          </text>
        ) : null}
        {geom.type === 'start' ? (
          <text x={cx} y={cy + 16} textAnchor="middle" className="b2d-cell-price start-salary">
            +200
          </text>
        ) : null}
      </g>
      {/* Snap yuvası: hafif parlayan halka */}
      <circle cx={cx} cy={cy} r={CELL_UNITS * 0.3} className="b2d-slot-halo" />
      <circle cx={cx} cy={cy} r={CELL_UNITS * 0.3} className="b2d-slot-ring" />
    </g>
  );
}

/* --------------------------------- ana görünüm --------------------------------- */

export function Board2DView(props: Board2DViewProps): JSX.Element {
  const { players, selfId, localMode, language, getRoom, dice } = props;
  const t = useMemo(() => makeB2dT(language), [language]);
  // FIX-PLAYABILITY-1: zar durumu App seviyesindeki DiceController'dan gelir.
  const snap = useSyncExternalStore(dice.subscribe, dice.getSnapshot);
  const rolling = snap.phase === 'rolling';

  const store = useMemo(() => new TokenStore(), []);
  const version = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getVersion(),
  );
  const tokens = useMemo(() => store.list().slice(), [version]);

  const geometry = useMemo(() => buildCellGeometry(BOARD_JSON.cells), []);
  const geometryByIndex = useMemo(() => new Map(geometry.map((geom) => [geom.index, geom])), [geometry]);

  const bridgeRef = useRef<Board2DBridge | null>(null);
  const roomRef = useRef<unknown>(null);
  roomRef.current = getRoom();

  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const deckOrders = useMemo(
    () => ({ chance: new DeckOrder(CHANCE_DECK.cards.length), community: new DeckOrder(COMMUNITY_DECK.cards.length) }),
    [],
  );

  const [stageSize, setStageSize] = useState(640);
  const [banner, setBanner] = useState<{ a: number; b: number; sum: number; playerId: string | null } | null>(null);
  const [drawnCard, setDrawnCard] = useState<DrawnCard | null>(null);
  const bannerTimer = useRef<number | null>(null);

  /* --------------------------------- köprü --------------------------------- */

  const showBanner = (a: number, b: number, sum: number, playerId: string | null): void => {
    setBanner({ a, b, sum, playerId });
    if (bannerTimer.current !== null) window.clearTimeout(bannerTimer.current);
    bannerTimer.current = window.setTimeout(() => setBanner(null), 3500);
  };

  if (!bridgeRef.current) {
    bridgeRef.current = new Board2DBridge({
      getRoom: () => roomRef.current,
      selfId,
      onRemoteToken: (info) => {
        // Varlığı garanti et (spawn mesajı kaçırılmış olabilir); akış konumu
        // interpolatörden gelir, bu yüzden mevcut piyonun yerine dokunma.
        if (store.get(info.playerId)) return;
        const cell0 = geometryByIndex.get(0);
        const occupants = store.list().filter((token) => !token.self).length;
        const offset = cell0 ? stackOffset(occupants + 1, occupants) : { x: 0, y: 0 };
        store.upsert(info.playerId, {
          x: (cell0?.cx ?? 500) + offset.x,
          y: (cell0?.cy ?? 500) + offset.y,
          self: false,
          cellIndex: 0,
        });
      },
    });
  }
  const bridge = bridgeRef.current;

  useEffect(() => {
    bridge.setRoomGetter(() => roomRef.current);
    bridge.setSelf(selfId);
    // FIX-PLAYABILITY-1: uzak zar sonuçlarını artık DiceController dinler;
    // köprü yalnızca piyon hareketinden sorumludur.
  }, [bridge, selfId]);

  // Zar durduğunda tahtanın ortasında büyük sonuç: 🎲 a + b = sum
  const bannerShownFor = useRef(-1);
  useEffect(() => {
    if (snap.phase !== 'settled' || snap.rollId === bannerShownFor.current) return;
    bannerShownFor.current = snap.rollId;
    showBanner(snap.lastA, snap.lastB, snap.sum ?? snap.lastA + snap.lastB, snap.rollerId);
  }, [snap]);

  /* ------------------------------ kadro → piyon ------------------------------ */

  const rosterSizeRef = useRef(0);
  useEffect(() => {
    bridge.syncRoom();
    const cell0 = geometryByIndex.get(0);
    const center = { x: cell0?.cx ?? 500, y: cell0?.cy ?? 500 };
    players.forEach((player, index) => {
      const offset = stackOffset(players.length, index);
      store.upsert(player.id, {
        name: player.name,
        color: player.color,
        x: center.x + offset.x,
        y: center.y + offset.y,
        self: player.id === selfId,
        cellIndex: store.get(player.id)?.cellIndex ?? 0,
      });
    });
    // Yeni oyuncu geldiyse konumumuzu bir kez duyur (geç katılan görsün).
    if (rosterSizeRef.current !== 0 && players.length > rosterSizeRef.current) bridge.announceSelf();
    rosterSizeRef.current = players.length;
  }, [players, selfId, store, bridge, geometryByIndex]);

  /* ------------------------------- rAF döngüsü ------------------------------- */

  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      raf = window.requestAnimationFrame(loop);
      bridge.flush();
      const nowMs = Date.now();
      // FIX-PLAYABILITY-1: zar tik'i DiceController'ın kendi döngüsüne taşındı.

      for (const token of store.list()) {
        if (token.self) continue;
        const sampled = bridge.sampleRemote(token.playerId, nowMs);
        if (!sampled) continue;
        if (Math.abs(sampled.x - token.x) < 0.05 && Math.abs(sampled.y - token.y) < 0.05) continue;
        store.upsert(token.playerId, { x: sampled.x, y: sampled.y, cellIndex: null, dragging: false });
      }
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [bridge, store]);

  /* ------------------------------ sahne ölçüsü ------------------------------ */

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setStageSize(Math.max(240, Math.floor(Math.min(rect.width, rect.height))));
    });
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  /* -------------------------------- sürükleme -------------------------------- */

  const pointFromEvent = (event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(BOARD_UNITS, Math.max(0, ((event.clientX - rect.left) / rect.width) * BOARD_UNITS)),
      y: Math.min(BOARD_UNITS, Math.max(0, ((event.clientY - rect.top) / rect.height) * BOARD_UNITS)),
    };
  };

  const onTokenPointerDown = (event: ReactPointerEvent, token: BoardToken): void => {
    if (!token.self) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const p = pointFromEvent(event);
    if (!p) return;
    dragRef.current = { pointerId: event.pointerId, x: token.x, y: token.y, lastX: p.x, lastY: p.y, lastT: performance.now(), vx: 0, vy: 0 };
    store.upsert(token.playerId, { dragging: true, cellIndex: null });
  };

  const onStagePointerMove = (event: ReactPointerEvent): void => {
    const drag = dragRef.current;
    const self = store.get(selfId);
    if (!drag || !self || !self.dragging) return;
    const p = pointFromEvent(event);
    if (!p) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    drag.vx = ((p.x - drag.lastX) / dt) * 1000;
    drag.vy = ((p.y - drag.lastY) / dt) * 1000;
    drag.lastX = p.x;
    drag.lastY = p.y;
    drag.lastT = now;
    drag.x = p.x;
    drag.y = p.y;
    store.upsert(selfId, { x: p.x, y: p.y });
    bridge.reportDrag(p.x, p.y, { vx: drag.vx, vy: drag.vy });
  };

  const onStagePointerUp = (event: ReactPointerEvent): void => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const p = pointFromEvent(event) ?? { x: drag.x, y: drag.y };
    const occupants = store.occupantsOfRect({ x: 0, y: 0, w: BOARD_UNITS, h: BOARD_UNITS }, selfId);
    // Snap: bırakılan noktaya en yakın hücre; hücredeki diğer piyonlar kadar
    // yelpaze ofseti uygulanır ki üst üste binmesinler.
    const rough = snapToCell(geometry, p, 0);
    const sameCellCount = rough
      ? occupants.filter((token) => {
          const cell = geometryByIndex.get(token.cellIndex ?? -1) ?? geometry.find(
            (geom) => token.x >= geom.x && token.x <= geom.x + geom.w && token.y >= geom.y && token.y <= geom.y + geom.h,
          );
          return !!cell && rough.cell.index === cell.index;
        }).length
      : 0;
    const snap = snapToCell(geometry, p, sameCellCount);
    if (!snap) return;
    store.upsert(selfId, { x: snap.x, y: snap.y, dragging: false, cellIndex: snap.cell.index, vx: 0, vy: 0 });
    bridge.reportSettle(snap.x, snap.y);
    // Sürükleyerek hareket ettirildiyse bu atışın rehberliği tamamlanmıştır.
    if (guidanceActive) guidanceHandled.current = snapRoll;
  };

  /* --------------------- oynanabilirlik: piyon kılavuzu ---------------------- */

  // FIX-PLAYABILITY-1: kendi zarımız durduysa ve henüz hareket etmediysek
  // hedef hücre yeşil parlar; hücreye tıklamak piyonu oraya taşır.
  const guidanceHandled = useRef(0);
  const snapRoll = snap.rollId;
  const guidanceActive =
    snap.phase === 'settled' && snap.rollerId === selfId && snap.sum != null && snapRoll !== guidanceHandled.current;
  const selfCell = tokens.find((token) => token.self)?.cellIndex ?? 0;
  const targetGeom = guidanceActive && snap.sum != null ? geometry[(selfCell + snap.sum) % geometry.length] ?? null : null;
  const guidanceText =
    targetGeom && snap.sum != null ? t('b2d.target.move', { sum: snap.sum, cell: cellName(targetGeom, language) }) : '';

  const moveSelfToCell = (index: number): void => {
    const geom = geometryByIndex.get(index);
    if (!geom) return;
    const occupants = store.occupantsOfRect({ x: 0, y: 0, w: BOARD_UNITS, h: BOARD_UNITS }, selfId);
    const sameCount = occupants.filter((token) => token.cellIndex === index).length;
    const offset = stackOffset(sameCount + 1, sameCount);
    const x = geom.cx + offset.x;
    const y = geom.cy + offset.y;
    store.upsert(selfId, { x, y, dragging: false, cellIndex: index, vx: 0, vy: 0 });
    bridge.reportSettle(x, y);
    guidanceHandled.current = snapRoll;
  };

  /* ---------------------------------- zarlar --------------------------------- */

  const onRoll = (): void => {
    dice.roll();
  };

  const lastRollName =
    banner == null ? '' : banner.playerId === selfId ? t('b2d.token.you') : players.find((player) => player.id === banner.playerId)?.name ?? '';

  /* ---------------------------------- desteler -------------------------------- */

  const drawDeck = (deck: 'chance' | 'community'): void => {
    setDrawnCard({ deck, index: deckOrders[deck].next() });
  };

  const deckSize = { w: 118, h: 162 };
  const chanceCard = drawnCard && drawnCard.deck === 'chance' ? CHANCE_DECK.cards[drawnCard.index] : null;
  const communityCard = drawnCard && drawnCard.deck === 'community' ? COMMUNITY_DECK.cards[drawnCard.index] : null;
  const activeCard = chanceCard ?? communityCard;
  const activeDeckName = drawnCard?.deck === 'community' ? t('b2d.card.community') : t('b2d.card.chance');

  const tokenFont = Math.max(9, Math.round(stageSize * 0.021));

  return (
    <div className="b2d" data-testid="board2d">
      <div className="b2d-mat">
        <div className="b2d-stage-wrap" ref={wrapRef}>
          <div className="b2d-stage" ref={stageRef} style={{ width: stageSize, height: stageSize }}>
            <svg viewBox={`0 0 ${BOARD_UNITS} ${BOARD_UNITS}`} className="b2d-board" role="img" aria-label={t('b2d.boardAria')}>
              <defs>
                <radialGradient id="b2d-center" cx="50%" cy="42%" r="75%">
                  <stop offset="0%" stopColor="#182238" />
                  <stop offset="100%" stopColor="#101623" />
                </radialGradient>
              </defs>
              <rect x="0" y="0" width={BOARD_UNITS} height={BOARD_UNITS} rx="18" fill="url(#b2d-center)" />
              {geometry.map((geom, index) => (
                <Cell key={geom.id ?? geom.index} geom={geom} language={language} cellIndex={index} />
              ))}

              {/* Orta alan: oyun adı */}
              <text x={BOARD_UNITS / 2} y={BOARD_UNITS / 2 - 66} textAnchor="middle" className="b2d-brand">
                MÜLK TYCOON
              </text>

              {/* Desteler: kart destesi görünümü, tıklanınca üstten açılır */}
              {(['chance', 'community'] as const).map((deckKind, deckIndex) => {
                const deckX = BOARD_UNITS / 2 + (deckKind === 'chance' ? -150 : 32);
                const deckY = BOARD_UNITS / 2 - 34;
                const accent = deckKind === 'chance' ? '#c2456b' : '#2e8b8b';
                const label = deckKind === 'chance' ? t('b2d.card.chance') : t('b2d.card.community');
                const glyph = deckKind === 'chance' ? '?' : '≡';
                return (
                  <g
                    key={deckKind}
                    className="b2d-deck"
                    role="button"
                    tabIndex={0}
                    aria-label={`${label} — ${t('b2d.deck.draw')}`}
                    onClick={() => drawDeck(deckKind)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        drawDeck(deckKind);
                      }
                    }}
                    transform={`translate(${deckX} ${deckY}) rotate(${deckIndex === 0 ? -3 : 2.5})`}
                  >
                    <rect x={7} y={9} width={deckSize.w} height={deckSize.h} rx="10" className="b2d-card-shadow" />
                    <rect x={3.5} y={4.5} width={deckSize.w} height={deckSize.h} rx="10" className="b2d-card-shadow" />
                    <rect x={0} y={0} width={deckSize.w} height={deckSize.h} rx="10" className="b2d-card-back" stroke={accent} />
                    <circle cx={deckSize.w / 2} cy={deckSize.h / 2 - 14} r="26" fill={accent} opacity="0.9" />
                    <text x={deckSize.w / 2} y={deckSize.h / 2 - 4} textAnchor="middle" className="b2d-deck-glyph">
                      {glyph}
                    </text>
                    <text x={deckSize.w / 2} y={deckSize.h - 30} textAnchor="middle" className="b2d-deck-name">
                      {label}
                    </text>
                    <text x={deckSize.w / 2} y={deckSize.h - 12} textAnchor="middle" className="b2d-deck-hint">
                      {t('b2d.deck.draw')}
                    </text>
                  </g>
                );
              })}

              {/* Son zar sonucu: tahtanın ortasında büyük ve neşeli */}
              {banner ? (
                <g className="b2d-banner" pointerEvents="none">
                  <text x={BOARD_UNITS / 2} y={BOARD_UNITS / 2 + 128} textAnchor="middle" className="b2d-banner-sum">
                    {`🎲 ${banner.a} + ${banner.b} = ${banner.sum}`}
                  </text>
                </g>
              ) : null}

              {/* Piyon kılavuzu: hedef hücre yeşil parlar, tıklayınca piyon gider */}
              {targetGeom ? (
                <rect
                  x={targetGeom.x + 2}
                  y={targetGeom.y + 2}
                  width={targetGeom.w - 4}
                  height={targetGeom.h - 4}
                  rx={8}
                  className="b2d-target-glow"
                  role="button"
                  aria-label={guidanceText}
                  onClick={() => moveSelfToCell(targetGeom.index)}
                />
              ) : null}
              {targetGeom ? (
                <text
                  x={BOARD_UNITS / 2}
                  y={BOARD_UNITS / 2 + 182}
                  textAnchor="middle"
                  className="b2d-target-note"
                  pointerEvents="none"
                >
                  {guidanceText}
                </text>
              ) : null}
            </svg>

            {/* Piyon katmanı (HTML — jilet metin, kabartma gölge) */}
            <div
              className="b2d-tokens"
              onPointerMove={onStagePointerMove}
              onPointerUp={onStagePointerUp}
              onPointerCancel={onStagePointerUp}
              aria-label={t('b2d.tokens.label')}
            >
              {tokens.map((token) => {
                const font = tokenFont;
                return (
                  <div
                    key={token.playerId}
                    className={`b2d-token${token.self ? ' self' : ''}${token.dragging ? ' dragging' : ''}`}
                    style={
                      {
                        left: `${(token.x / BOARD_UNITS) * 100}%`,
                        top: `${(token.y / BOARD_UNITS) * 100}%`,
                        ['--token-color' as string]: token.color,
                        width: font * 2.6,
                        height: font * 2.6,
                        fontSize: font,
                      } as CSSProperties
                    }
                    title={`${token.name}${token.self ? ` (${t('b2d.token.you')})` : ''}`}
                    onPointerDown={(event) => onTokenPointerDown(event, token)}
                    data-testid={`token-${token.playerId}`}
                  >
                    <span className="b2d-token-label">{token.name.trim().charAt(0).toUpperCase() || '?'}</span>
                    <span className="b2d-token-name">{token.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Alt bar: 2D zarlar (controller durumuyla senkron) */}
      <div className="b2d-dicebar" role="group" aria-label={t('b2d.dice.label')}>
        <div className="b2d-dice">
          <DieFace value={snap.a} rolling={rolling} tone="self" />
          <DieFace value={snap.b} rolling={rolling} tone="self" />
        </div>
        <button type="button" className="button primary b2d-roll" onClick={onRoll} disabled={rolling}>
          {rolling ? t('b2d.dice.rolling') : t('b2d.dice.roll')}
        </button>
        <span className="b2d-dice-result" role="status" aria-live="polite">
          {banner
            ? `${lastRollName ? `${lastRollName}: ` : ''}${banner.a} + ${banner.b} = ${banner.sum}`
            : guidanceActive && guidanceText
              ? guidanceText
              : t('b2d.dice.label')}
        </span>
      </div>

      {/* Kart açılımı */}
      {activeCard && drawnCard ? (
        <div className="b2d-card-scrim" onClick={() => setDrawnCard(null)} role="presentation">
          <article
            className="b2d-card"
            data-deck={drawnCard.deck}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label={activeDeckName}
          >
            <header className="b2d-card-head" data-deck={drawnCard.deck}>
              <span>{activeDeckName}</span>
              <button type="button" className="button ghost b2d-card-close" onClick={() => setDrawnCard(null)}>
                ✕ <span className="visually-hidden">{t('b2d.deck.close')}</span>
              </button>
            </header>
            <h3 className="b2d-card-title">{cardText(activeCard, language).title}</h3>
            <p className="b2d-card-text">{cardText(activeCard, language).text}</p>
          </article>
        </div>
      ) : null}
    </div>
  );
}
