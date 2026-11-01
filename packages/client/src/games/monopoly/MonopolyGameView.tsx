/**
 * Mülk Tycoon — profesyonel dijital kutu oyunu görünümü.
 *
 * - 40 hücreli vektör tahta (paket verisi + `boardGeometry`)
 * - Adım adım piyon animasyonu: motorun `move.path` dizisi sırayla oynatılır;
 *   piyon asla "başa dönmez", her adımda gerçek hücreye oturur.
 * - Tapu kartı satın alma modalı, Fırsat/Topluluk kartı modalı
 * - Oyuncu portföy & kasa paneli, oyun günlüğü
 * - Yerel hot-seat ve isteğe bağlı Colyseus durum köprüsü
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Language } from '../../ui/settings.js';
import {
  BOARD_UNITS,
  buildCellGeometry,
  type CellGeom,
  type CellInput,
} from '../../board2d/boardGeometry.js';
import {
  CHANCE_DECK,
  COMMUNITY_DECK,
  cardText,
  cellAccent,
  cellName,
} from '../../board2d/boardData.js';
import {
  CELLS,
  GROUPS,
  JAIL_FINE,
  activePlayers,
  buildHouse,
  buyProperty,
  calculateRent,
  cellAt,
  createGame,
  currentPlayer,
  declinePurchase,
  dismissCard,
  endTurn,
  holdingOf,
  mortgageProperty,
  ownerOf,
  payJailFine,
  playerById,
  rollDice,
  rollForJail,
  sellHouse,
  summarizeEvent,
  unmortgageProperty,
  useJailCard,
  type GameEvent,
  type MonopolyCell,
  type MonopolyPlayer,
  type MonopolyState,
  type PendingCard,
} from './monopolyEngine.js';
import type { MonopolySync } from './monopolySync.js';
import { makeMpT } from './monopolyStrings.js';
import './monopoly.css';

export interface MonopolyGameViewProps {
  state: MonopolyState;
  onChange: (state: MonopolyState) => void;
  language?: Language;
  /** Yerel hot-seat'te null; çevrimiçi modda yerel oyuncunun kimliği. */
  selfId?: string | null;
  onExit?: () => void;
  onRestart?: () => void;
  sync?: MonopolySync;
}

const CELL_GEOM = buildCellGeometry(CELLS as unknown as CellInput[]);
const GEOM_BY_INDEX = new Map(CELL_GEOM.map((geom) => [geom.index, geom]));
const ALL_CARDS = [...CHANCE_DECK.cards, ...COMMUNITY_DECK.cards];
const GROUP_COLOR = new Map(GROUPS.map((group) => [group.id, group.color]));
const GROUP_MEMBERS = new Map(GROUPS.map((group) => [group.id, group.members]));

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

const DICE_PIPS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

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

function money(value: number): string {
  return `${value.toLocaleString('tr-TR')} ₡`;
}

function rentRows(cell: MonopolyCell, holding: { houses: number } | undefined, ownedCount: number, t: ReturnType<typeof makeMpT>) {
  const rows: { label: string; value: number; active: boolean }[] = [];
  const rents = cell.rent ?? [];
  if (cell.type === 'property') {
    rows.push({ label: t('mp.deed.rentBase'), value: rents[0] ?? 0, active: (holding?.houses ?? 0) === 0 && ownedCount < 2 });
    rows.push({ label: t('mp.deed.rentGroup'), value: rents[1] ?? (rents[0] ?? 0) * 2, active: (holding?.houses ?? 0) === 0 && ownedCount >= 2 });
    for (let house = 1; house <= 4; house += 1) {
      rows.push({
        label: t('mp.deed.rentHouse', { n: house }),
        value: rents[1 + house] ?? 0,
        active: holding?.houses === house,
      });
    }
    rows.push({ label: t('mp.deed.rentHotel'), value: rents[6] ?? 0, active: holding?.houses === 5 });
  } else if (cell.type === 'transport') {
    for (let count = 1; count <= 4; count += 1) {
      rows.push({
        label: t('mp.deed.rentPort', { n: count }),
        value: rents[count - 1] ?? 0,
        active: ownedCount === count,
      });
    }
  } else if (cell.type === 'energy') {
    rows.push({ label: t('mp.deed.rentEnergy1'), value: rents[0] ?? 4, active: ownedCount < 2 });
    rows.push({ label: t('mp.deed.rentEnergy2'), value: rents[1] ?? 10, active: ownedCount >= 2 });
  }
  return rows;
}

function groupOwnedCount(player: MonopolyPlayer, cell: MonopolyCell, state: MonopolyState): number {
  if (cell.type === 'transport') {
    return [5, 15, 25, 35].filter((index) => holdingOf(player, index) !== undefined).length;
  }
  if (cell.type === 'energy') {
    return [12, 28].filter((index) => holdingOf(player, index) !== undefined).length;
  }
  void state;
  return GROUP_MEMBERS.get(cell.groupId ?? '')?.filter((index) => holdingOf(player, index) !== undefined).length ?? 0;
}

/* ---------------------------------- tahta ---------------------------------- */

interface BoardCellProps {
  geom: CellGeom;
  state: MonopolyState;
  language: Language;
  selected: boolean;
  visitLabel: string;
  onSelect: (index: number) => void;
}

function BoardCell({ geom, state, language, selected, visitLabel, onSelect }: BoardCellProps): JSX.Element {
  const cell = cellAt(geom.index);
  const name = cellName(geom, language);
  const accent = cellAccent(geom);
  const owner = ownerOf(state, geom.index);
  const holding = owner ? holdingOf(owner, geom.index) : undefined;
  const band = 13;
  const lines = wrapLabel(name, 11);
  const glyph = TYPE_GLYPH[geom.type];
  const isCorner =
    geom.type === 'start' || geom.type === 'jail' || geom.type === 'free-parking' || geom.type === 'go-to-jail';
  const rotation = geom.side === 'left' ? -90 : geom.side === 'right' ? 90 : 0;
  const innerEdge = {
    bottom: { x: geom.x + 3, y: geom.y + 24, w: geom.w - 6, h: 4 },
    top: { x: geom.x + 3, y: geom.y + geom.h - 28, w: geom.w - 6, h: 4 },
    left: { x: geom.x + geom.w - 28, y: geom.y + 3, w: 4, h: geom.h - 6 },
    right: { x: geom.x + 24, y: geom.y + 3, w: 4, h: geom.h - 6 },
  }[geom.side];

  let bandRect = { x: geom.x + 3, y: geom.y + 3, w: geom.w - 6, h: band };
  if (geom.side === 'top') bandRect = { x: geom.x + 3, y: geom.y + geom.h - band - 3, w: geom.w - 6, h: band };
  if (geom.side === 'left') bandRect = { x: geom.x + geom.w - band - 3, y: geom.y + 3, w: band, h: geom.h - 6 };
  if (geom.side === 'right') bandRect = { x: geom.x + 3, y: geom.y + 3, w: band, h: geom.h - 6 };

  const cx = geom.cx;
  const cy = geom.cy;
  const houses = holding?.houses ?? 0;

  return (
    <g
      className={`mp-cell${selected ? ' is-selected' : ''}${owner ? ' is-owned' : ''}`}
      data-cell={geom.index}
      role="button"
      tabIndex={0}
      aria-label={`${name}${cell?.price ? ` — ${cell.price} ₡` : ''}`}
      onClick={() => onSelect(geom.index)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(geom.index);
        }
      }}
    >
      <rect x={geom.x + 1.5} y={geom.y + 1.5} width={geom.w - 3} height={geom.h - 3} rx="7" className="mp-cell-bg" />
      {!isCorner ? (
        <rect x={bandRect.x} y={bandRect.y} width={bandRect.w} height={bandRect.h} rx="4" fill={accent} opacity={0.95} />
      ) : (
        <rect x={geom.x + 1.5} y={geom.y + 1.5} width={geom.w - 3} height={geom.h - 3} rx="7" fill={accent} opacity={0.2} />
      )}
      {owner ? <rect x={innerEdge.x} y={innerEdge.y} width={innerEdge.w} height={innerEdge.h} rx={2} fill={owner.color} /> : null}
      {holding?.mortgaged ? (
        <g transform={`rotate(${rotation} ${cx} ${cy})`}>
          <text x={cx} y={geom.y + 34} textAnchor="middle" className="mp-cell-mortgaged">
            İPOTEK
          </text>
        </g>
      ) : null}
      {glyph && !isCorner ? (
        <text x={cx} y={geom.y + 35} textAnchor="middle" className="mp-glyph" transform={`rotate(${rotation} ${cx} ${cy})`}>
          {glyph}
        </text>
      ) : null}
      <g transform={`rotate(${rotation} ${cx} ${cy})`}>
        {lines.map((line, index) => (
          <text
            key={line + index}
            x={cx}
            y={cy - ((lines.length - 1) * (isCorner ? 10 : 12)) / 2 + index * (isCorner ? 10 : 12) + (isCorner ? -8 : 0)}
            textAnchor="middle"
            className={isCorner ? 'mp-cell-name is-corner' : 'mp-cell-name'}
          >
            {line}
          </text>
        ))}
        {typeof geom.price === 'number' ? (
          <text x={cx} y={cy + ((lines.length - 1) * 12) / 2 + 15} textAnchor="middle" className="mp-cell-price">
            {geom.price} ₡
          </text>
        ) : null}
        {geom.type === 'start' ? (
          <text x={cx} y={cy + 18} textAnchor="middle" className="mp-cell-salary">
            +200 ₡
          </text>
        ) : null}
        {geom.type === 'jail' ? (
          <text x={cx} y={cy + 18} textAnchor="middle" className="mp-cell-salary">
            {visitLabel}
          </text>
        ) : null}
      </g>
      {houses > 0 && houses < 5 ? (
        <g transform={`translate(${cx}, ${geom.y + geom.h - 13})`}>
          {Array.from({ length: houses }).map((_, index) => (
            <circle key={index} cx={(index - (houses - 1) / 2) * 12} cy={0} r={5.4} className="mp-house-dot" />
          ))}
        </g>
      ) : null}
      {houses === 5 ? (
        <g transform={`translate(${cx}, ${geom.y + geom.h - 14})`}>
          <rect x={-13} y={-7} width={26} height={14} rx={3} className="mp-hotel-mark" />
          <path d="M-13 -1 h26" stroke="#0b1a12" strokeWidth="1.4" />
        </g>
      ) : null}
      {owner ? <circle cx={geom.x + geom.w - 15} cy={geom.y + 15} r={5.5} fill={owner.color} stroke="#0c1411" strokeWidth={1.5} /> : null}
      {selected ? <rect x={geom.x + 1} y={geom.y + 1} width={geom.w - 2} height={geom.h - 2} rx="7" className="mp-cell-selected" /> : null}
    </g>
  );
}

/* --------------------------------- piyonlar -------------------------------- */

interface PawnLayerProps {
  state: MonopolyState;
  positions: Record<string, number>;
  currentId: string;
}

function PawnLayer({ state, positions, currentId }: PawnLayerProps): JSX.Element {
  const groups = new Map<number, MonopolyPlayer[]>();
  for (const player of state.players) {
    const position = positions[player.id] ?? player.position;
    const list = groups.get(position) ?? [];
    list.push(player);
    groups.set(position, list);
  }
  const pawns: JSX.Element[] = [];
  for (const [cellIndex, list] of groups) {
    const geom = GEOM_BY_INDEX.get(cellIndex);
    if (!geom) continue;
    list.forEach((player, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(2, list.length) - Math.PI / 2;
      const radius = list.length > 1 ? 19 : 0;
      const x = geom.cx + Math.cos(angle) * radius;
      const y = geom.cy + 6 + Math.sin(angle) * radius;
      pawns.push(
        <g
          key={player.id}
          className={`mp-pawn${player.id === currentId ? ' is-current' : ''}${player.bankrupt ? ' is-bankrupt' : ''}`}
          style={{ transform: `translate(${x}px, ${y}px)` }}
        >
          <circle r={12} fill={player.color} stroke="#0b1210" strokeWidth={2} />
          <circle r={8} fill="rgba(255,255,255,0.22)" />
          <text y={3.5} textAnchor="middle" className="mp-pawn-letter">
            {player.name.slice(0, 1).toUpperCase()}
          </text>
        </g>,
      );
    });
  }
  return <g className="mp-pawns" aria-hidden="true">{pawns}</g>;
}

/* ----------------------------------- zar ----------------------------------- */

function Die({ value, rolling }: { value: number; rolling: boolean }): JSX.Element {
  const pips = DICE_PIPS[Math.min(6, Math.max(1, value))] ?? DICE_PIPS[1]!;
  return (
    <div className={`mp-die${rolling ? ' is-rolling' : ''}`} aria-label={`${value}`}>
      {Array.from({ length: 9 }).map((_, index) => (
        <span key={index} className={pips.includes(index) ? 'mp-pip' : 'mp-pip is-empty'} />
      ))}
    </div>
  );
}

/* -------------------------------- tapu kartı ------------------------------- */

interface DeedCardProps {
  state: MonopolyState;
  cellIndex: number;
  language: Language;
  t: ReturnType<typeof makeMpT>;
  compact?: boolean;
  onClose?: () => void;
}

function DeedCard({ state, cellIndex, language, t, compact, onClose }: DeedCardProps): JSX.Element | null {
  const cell = cellAt(cellIndex);
  if (!cell) return null;
  const owner = ownerOf(state, cellIndex);
  const holding = owner ? holdingOf(owner, cellIndex) : undefined;
  const ownedCount = owner ? groupOwnedCount(owner, cell, state) : 0;
  const rows = rentRows(cell, holding, ownedCount, t);
  const accent = cell.groupId ? GROUP_COLOR.get(cell.groupId) ?? '#6b7a88' : cell.type === 'transport' ? '#2c6fa8' : '#b8862b';
  const mortgageValue = cell.mortgage ?? Math.floor((cell.price ?? 0) / 2);

  return (
    <article className={`mp-deed${compact ? ' is-compact' : ''}`} style={{ ['--deed-accent' as string]: accent }}>
      <header className="mp-deed-head">
        <span className="mp-deed-band" />
        <p className="mp-deed-kicker">{cell.type === 'transport' ? 'LİMAN' : cell.type === 'energy' ? 'ENERJİ' : (cell.groupId ?? 'MÜLK').toUpperCase()}</p>
        <h3>{cellName(cell, language)}</h3>
        <p className="mp-deed-price">{cell.price !== undefined ? money(cell.price) : '—'}</p>
      </header>
      <div className="mp-deed-body">
        <div className="mp-deed-rents">
          <p className="mp-deed-label">{t('mp.deed.rent')}</p>
          {rows.map((row) => (
            <div key={row.label} className={`mp-deed-row${row.active ? ' is-active' : ''}`}>
              <span>{row.label}</span>
              <b>{money(row.value)}</b>
            </div>
          ))}
        </div>
        <dl className="mp-deed-meta">
          <div>
            <dt>{t('mp.deed.price')}</dt>
            <dd>{cell.price !== undefined ? money(cell.price) : '—'}</dd>
          </div>
          {cell.houseCost !== undefined ? (
            <div>
              <dt>{t('mp.deed.houseCost')}</dt>
              <dd>{money(cell.houseCost)}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('mp.deed.mortgage')}</dt>
            <dd>{money(mortgageValue)}</dd>
          </div>
          <div>
            <dt>{t('mp.portfolio.cash')}</dt>
            <dd>{owner ? money(owner.cash) : '—'}</dd>
          </div>
        </dl>
        <p className={`mp-deed-owner${owner ? '' : ' is-free'}`}>
          {owner ? t('mp.deed.ownedBy', { name: owner.name }) : t('mp.deed.unowned')}
          {holding?.mortgaged ? <span className="mp-deed-tag">{t('mp.deed.mortgaged')}</span> : null}
          {holding && holding.houses > 0 ? (
            <span className="mp-deed-tag">
              {holding.houses === 5 ? t('mp.deed.hotel') : t('mp.deed.houses', { n: holding.houses })}
            </span>
          ) : null}
        </p>
      </div>
      {onClose ? (
        <button type="button" className="mp-deed-close" onClick={onClose} aria-label={t('mp.deed.close')}>
          ×
        </button>
      ) : null}
    </article>
  );
}

/* --------------------------------- ana görünüm ------------------------------ */

export function MonopolyGameView(props: MonopolyGameViewProps): JSX.Element {
  const { state, onChange, language = 'tr', selfId = null, onExit, onRestart, sync } = props;
  const t = useMemo(() => makeMpT(language), [language]);
  const current = currentPlayer(state);
  const selfIsCurrent = selfId === null || current.id === selfId;

  const [display, setDisplay] = useState<Record<string, number>>(() =>
    Object.fromEntries(state.players.map((player) => [player.id, player.position])),
  );
  const [animating, setAnimating] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [rollFaces, setRollFaces] = useState({ a: 1, b: 1 });
  const [selected, setSelected] = useState<number | null>(null);
  const [log, setLog] = useState<{ key: string; text: string }[]>([]);

  const prevStateRef = useRef<MonopolyState | null>(null);
  const seqRef = useRef(-1);
  const publishedSeqRef = useRef(-1);
  const timersRef = useRef<number[]>([]);
  const intervalsRef = useRef<number[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
      for (const interval of intervalsRef.current) window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!sync) return;
    return sync.subscribe((remote) => {
      if (remote.actionSeq === publishedSeqRef.current) return;
      onChangeRef.current(remote);
    });
  }, [sync]);

  const formatEvent = (event: GameEvent): string => {
    const name = (id: string): string => playerById(state, id)?.name ?? id;
    const cellNameOf = (index: number): string => {
      const cell = cellAt(index);
      return cell ? cellName(cell, language) : `#${index}`;
    };
    switch (event.type) {
      case 'dice':
        return `${name(event.playerId)}: ${event.die1} + ${event.die2} = ${event.sum}${event.doubles ? ' · çift' : ''}`;
      case 'move':
        return `${name(event.playerId)} · ${cellNameOf(event.from)} → ${cellNameOf(event.to)}${event.passedGo ? ' · +200 ₡' : ''}`;
      case 'salary':
        return `${name(event.playerId)} · ${t('mp.center.salary')}`;
      case 'purchase':
        return `${name(event.playerId)} · ${cellNameOf(event.cellIndex)} — ${money(event.price)}`;
      case 'decline':
        return `${name(event.playerId)} · ${cellNameOf(event.cellIndex)} (${t('mp.buy.decline')})`;
      case 'rent':
        return `${name(event.from)} → ${name(event.to)} · ${money(event.amount)}`;
      case 'tax':
        return `${name(event.playerId)} · ${cellNameOf(event.cellIndex)} − ${money(event.amount)}`;
      case 'card':
        return `${name(event.playerId)} · ${event.title}`;
      case 'jail':
        return `${name(event.playerId)} · ${t('mp.center.jail')}`;
      case 'jail-release': {
        const label = {
          pay: t('mp.jail.release.pay'),
          card: t('mp.jail.release.card'),
          doubles: t('mp.jail.release.doubles'),
          timeout: t('mp.jail.release.timeout'),
        }[event.method];
        return `${name(event.playerId)} · ${label}`;
      }
      case 'bankrupt':
        return `${name(event.playerId)} · ${t('mp.bankrupt')}`;
      case 'build':
        return `${name(event.playerId)} · ${cellNameOf(event.cellIndex)} · ${event.houses}`;
      case 'sell-house':
        return `${name(event.playerId)} · ${cellNameOf(event.cellIndex)} · ${money(event.refund)}`;
      case 'mortgage':
        return `${name(event.playerId)} · ${cellNameOf(event.cellIndex)} · +${money(event.amount)}`;
      case 'unmortgage':
        return `${name(event.playerId)} · ${cellNameOf(event.cellIndex)} · −${money(event.amount)}`;
      case 'turn':
        return t('mp.turnAnnounce', { name: name(event.playerId) });
      case 'skip-turn':
        return `${name(event.playerId)} · ${t('mp.skip')}`;
      case 'winner':
        return t('mp.winner.title', { name: name(event.playerId) });
      case 'purchase-offer':
        return t('mp.event.purchaseOffer', { name: name(event.playerId), cell: cellNameOf(event.cellIndex) });
      case 'info':
        return event.message;
      default:
        return summarizeEvent(state, event);
    }
  };

  useEffect(() => {
    if (prevStateRef.current === state) return;
    prevStateRef.current = state;
    const reset = state.actionSeq <= seqRef.current;
    seqRef.current = state.actionSeq;
    const appendLog = (): void => {
      setLog((previous) => {
        const base = reset ? [] : previous;
        const next = state.lastEvents.map((event, index) => ({
          key: `${state.actionSeq}-${index}-${event.type}`,
          text: formatEvent(event),
        }));
        return [...base, ...next].slice(-60);
      });
    };
    if (reset) {
      setDisplay(Object.fromEntries(state.players.map((player) => [player.id, player.position])));
      setAnimating(false);
      setRolling(false);
      appendLog();
      return;
    }
    appendLog();
    const moves = state.lastEvents.filter((event): event is Extract<GameEvent, { type: 'move' }> => event.type === 'move');
    if (moves.length === 0) {
      setDisplay(Object.fromEntries(state.players.map((player) => [player.id, player.position])));
      return;
    }
    let cancelled = false;
    setAnimating(true);
    void (async () => {
      for (const move of moves) {
        const path = move.path.length > 0 ? move.path : [move.to];
        for (const step of path) {
          if (cancelled) return;
          setDisplay((previous) => ({ ...previous, [move.playerId]: step }));
          await sleep(move.reason === 'jail' ? 85 : 115);
        }
        await sleep(70);
      }
      if (cancelled) return;
      setDisplay(Object.fromEntries(state.players.map((player) => [player.id, player.position])));
      setAnimating(false);
    })();
    return () => {
      cancelled = true;
    };
    // formatEvent/state bağımlılığı actionSeq ile sınırlandırılır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const apply = (next: MonopolyState): void => {
    if (next === state) return;
    publishedSeqRef.current = next.actionSeq;
    onChange(next);
    sync?.publish(next);
  };

  const canAct = !state.winnerId && selfIsCurrent && !animating && !rolling;
  const canRoll = canAct && state.phase === 'ROLL';

  const startRoll = (kind: 'normal' | 'jail'): void => {
    if (rolling || animating || !selfIsCurrent || state.winnerId) return;
    if (kind === 'normal' && state.phase !== 'ROLL') return;
    if (kind === 'jail' && state.phase !== 'JAIL_DECISION') return;
    const next = kind === 'jail' ? rollForJail(state) : rollDice(state);
    setRolling(true);
    const interval = window.setInterval(() => {
      setRollFaces({ a: 1 + Math.floor(Math.random() * 6), b: 1 + Math.floor(Math.random() * 6) });
    }, 75);
    intervalsRef.current.push(interval);
    const timer = window.setTimeout(() => {
      window.clearInterval(interval);
      intervalsRef.current = intervalsRef.current.filter((entry) => entry !== interval);
      setRollFaces({ a: next.dice.die1 || 1, b: next.dice.die2 || 1 });
      setRolling(false);
      apply(next);
    }, 720);
    timersRef.current.push(timer);
  };

  const active = activePlayers(state);
  const pendingPurchase = state.pendingPurchase;
  const purchaseCell = pendingPurchase !== null ? cellAt(pendingPurchase) : undefined;
  const pendingCard: PendingCard | null = state.pendingCard;

  const cardView = useMemo(() => {
    if (!pendingCard) return null;
    const card = ALL_CARDS.find((entry) => entry.id === pendingCard.cardId);
    return card ? cardText(card, language) : { title: pendingCard.title, text: pendingCard.text };
  }, [pendingCard, language]);

  const selectedCell = selected !== null ? cellAt(selected) : undefined;
  const winner = state.winnerId ? playerById(state, state.winnerId) : undefined;
  const displayDice = state.dice.die1 > 0 ? state.dice : { die1: rollFaces.a, die2: rollFaces.b };
  const selectedOwner = selected !== null ? ownerOf(state, selected) : undefined;
  const selectedHolding = selectedOwner && selected !== null ? holdingOf(selectedOwner, selected) : undefined;

  return (
    <div className="mp-root">
      <header className="mp-topbar">
        <div className="mp-brand">
          <span className="mp-brand-mark">₡</span>
          <div>
            <h1>{t('mp.title')}</h1>
            <p>{t('mp.subtitle')}</p>
          </div>
        </div>
        <div className="mp-topstats">
          <span className="mp-chip">{t('mp.round', { n: state.round })}</span>
          <span className="mp-chip">
            {t('mp.stats', { n: state.players.length, r: state.round })}
          </span>
          {onExit ? (
            <button type="button" className="mp-btn ghost small" onClick={onExit}>
              {t('mp.exit')}
            </button>
          ) : null}
        </div>
      </header>

      <div className="mp-layout">
        <aside className="mp-side mp-side-left" aria-label={t('mp.portfolio.title')}>
          <div className="mp-panel-head">
            <h2>{t('mp.portfolio.title')}</h2>
            <span className="mp-badge">{active.length}</span>
          </div>
          <div className="mp-players">
            {state.players.map((player) => {
              const isCurrent = player.id === current.id;
              const properties = Object.keys(player.properties)
                .map((key) => ({ index: Number(key), holding: player.properties[key]! }))
                .sort((a, b) => a.index - b.index);
              return (
                <section
                  key={player.id}
                  className={`mp-player${isCurrent ? ' is-current' : ''}${player.bankrupt ? ' is-bankrupt' : ''}`}
                  style={{ ['--player-color' as string]: player.color }}
                  aria-current={isCurrent ? 'true' : undefined}
                >
                  <div className="mp-player-head">
                    <span className="mp-avatar">{player.name.slice(0, 1).toUpperCase()}</span>
                    <div className="mp-player-id">
                      <strong>
                        {player.name}
                        {player.id === selfId ? <em> · {t('mp.you')}</em> : null}
                      </strong>
                      <span className="mp-cash">{money(player.cash)}</span>
                    </div>
                    {player.bankrupt ? <span className="mp-tag danger">{t('mp.bankrupt')}</span> : null}
                    {player.inJail && !player.bankrupt ? <span className="mp-tag">{t('mp.portfolio.jail')}</span> : null}
                  </div>
                  <div className="mp-mini-meta">
                    {player.getOutOfJailCards > 0 ? <span>🎟 {t('mp.portfolio.cards', { n: player.getOutOfJailCards })}</span> : null}
                    {player.position > 0 ? <span>#{player.position}</span> : null}
                  </div>
                  <div className="mp-props">
                    {properties.length === 0 ? <span className="mp-empty">{t('mp.portfolio.none')}</span> : null}
                    {properties.map(({ index, holding }) => {
                      const cell = cellAt(index);
                      if (!cell) return null;
                      const color = cell.groupId ? GROUP_COLOR.get(cell.groupId) ?? '#546' : cell.type === 'transport' ? '#2c6fa8' : '#b8862b';
                      return (
                        <button
                          key={index}
                          type="button"
                          className={`mp-prop${holding.mortgaged ? ' is-mortgaged' : ''}`}
                          style={{ ['--prop-color' as string]: color }}
                          onClick={() => setSelected(index)}
                          title={cellName(cell, language)}
                        >
                          <span className="mp-prop-name">{cellName(cell, language)}</span>
                          {holding.houses > 0 ? (
                            <span className="mp-prop-houses">{holding.houses === 5 ? 'H' : '•'.repeat(holding.houses)}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </aside>

        <main className="mp-main">
          <div className="mp-board-shell">
            <div className="mp-board-wrap">
              <svg viewBox={`0 0 ${BOARD_UNITS} ${BOARD_UNITS}`} className="mp-board" role="img" aria-label={t('mp.boardAria')}>
                <defs>
                  <radialGradient id="mp-felt" cx="50%" cy="42%" r="74%">
                    <stop offset="0%" stopColor="#173d31" />
                    <stop offset="58%" stopColor="#102c24" />
                    <stop offset="100%" stopColor="#0a1d18" />
                  </radialGradient>
                  <linearGradient id="mp-gold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f0d79a" />
                    <stop offset="100%" stopColor="#b98c3c" />
                  </linearGradient>
                  <filter id="mp-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.45" />
                  </filter>
                </defs>
                <rect x="0" y="0" width={BOARD_UNITS} height={BOARD_UNITS} rx="22" fill="#0a1713" />
                <rect x="10" y="10" width={BOARD_UNITS - 20} height={BOARD_UNITS - 20} rx="18" fill="url(#mp-felt)" stroke="url(#mp-gold)" strokeWidth="3" />
                <rect x="20" y="20" width={BOARD_UNITS - 40} height={BOARD_UNITS - 40} rx="14" fill="none" stroke="rgba(217,179,108,0.22)" strokeWidth="1.2" />
                {CELL_GEOM.map((geom) => (
                  <BoardCell
                    key={geom.index}
                    geom={geom}
                    state={state}
                    language={language}
                    selected={selected === geom.index}
                    visitLabel={t('mp.center.visit')}
                    onSelect={setSelected}
                  />
                ))}

                <g className="mp-center" filter="url(#mp-soft-shadow)">
                  <circle cx={500} cy={500} r={236} fill="rgba(6,18,14,0.55)" stroke="rgba(217,179,108,0.26)" strokeWidth="1.5" strokeDasharray="3 7" />
                  <text x="500" y="408" textAnchor="middle" className="mp-center-kicker">
                    {t('mp.center.round', { n: state.round })}
                  </text>
                  <text x="500" y="456" textAnchor="middle" className="mp-center-brand">
                    {t('mp.center.brand')}
                  </text>
                  <line x1="356" y1="478" x2="644" y2="478" stroke="url(#mp-gold)" strokeWidth="2" opacity="0.75" />
                  <g transform="translate(500, 522)">
                    <circle r={34} fill={current.color} opacity={0.95} stroke="#0a1713" strokeWidth="3" />
                    <text y={8} textAnchor="middle" className="mp-center-initial">
                      {current.name.slice(0, 1).toUpperCase()}
                    </text>
                  </g>
                  <text x="500" y="584" textAnchor="middle" className="mp-center-turn">
                    {selfIsCurrent ? t('mp.turn.self') : t('mp.turn.other', { name: current.name })}
                  </text>
                  <text x="500" y="612" textAnchor="middle" className="mp-center-cash">
                    {money(current.cash)}
                  </text>
                  <g transform="translate(500, 650)">
                    <rect x={-86} y={-15} width={172} height={30} rx={15} fill="rgba(255,255,255,0.05)" stroke="rgba(217,179,108,0.25)" />
                    <text y={5} textAnchor="middle" className="mp-center-pot">
                      {t('mp.center.pot')}: {money(state.freeParkingPot)}
                    </text>
                  </g>
                  <text x="500" y="700" textAnchor="middle" className="mp-center-salary">
                    {t('mp.center.go')} · {t('mp.center.salary')}
                  </text>
                </g>

                <PawnLayer state={state} positions={display} currentId={current.id} />
              </svg>
            </div>
          </div>

          <div className="mp-dock">
            <div className="mp-dock-dice">
              <Die value={displayDice.die1 || 1} rolling={rolling} />
              <Die value={displayDice.die2 || 1} rolling={rolling} />
            </div>
            <div className="mp-dock-center">
              <span className={`mp-turn-pill${selfIsCurrent ? ' is-self' : ''}`}>
                <i style={{ background: current.color }} />
                {selfIsCurrent ? t('mp.turn.self') : t('mp.turn.other', { name: current.name })}
              </span>
              <span className="mp-dock-hint">
                {state.phase === 'JAIL_DECISION'
                  ? t('mp.jail.hint')
                  : state.phase === 'ACTION'
                    ? t('mp.buy.title')
                    : state.dice.doublesCount > 0
                      ? t('mp.roll.again')
                      : t('mp.jail.turns', { n: current.jailTurns })}
              </span>
            </div>
            <div className="mp-dock-actions">
              {state.phase === 'TURN_END' && !state.winnerId ? (
                <button type="button" className="mp-btn primary mp-end is-live" disabled={!canAct} onClick={() => apply(endTurn(state))}>
                  {t('mp.endTurn')}
                </button>
              ) : state.phase === 'JAIL_DECISION' ? (
                <div className="mp-jail-actions">
                  <button type="button" className="mp-btn primary" disabled={!canAct} onClick={() => startRoll('jail')}>
                    {rolling ? t('mp.rolling') : t('mp.jail.roll')}
                  </button>
                  <button type="button" className="mp-btn" disabled={!canAct || current.cash < JAIL_FINE} onClick={() => apply(payJailFine(state))}>
                    {t('mp.jail.pay')}
                  </button>
                  <button type="button" className="mp-btn ghost" disabled={!canAct || current.getOutOfJailCards <= 0} onClick={() => apply(useJailCard(state))}>
                    {t('mp.jail.card', { n: current.getOutOfJailCards })}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={`mp-btn primary mp-roll${canRoll ? ' is-live' : ''}`}
                  disabled={!canRoll}
                  onClick={() => startRoll('normal')}
                >
                  {rolling
                    ? t('mp.rolling')
                    : canRoll
                      ? state.dice.doublesCount > 0
                        ? t('mp.roll.again')
                        : t('mp.roll')
                      : t('mp.roll.wait', { name: current.name })}
                </button>
              )}
            </div>
          </div>
        </main>

        <aside className="mp-side mp-side-right">
          {selectedCell ? (
            <div className="mp-panel">
              <div className="mp-panel-head">
                <h2>{t('mp.selected')}</h2>
                <button type="button" className="mp-icon-btn" onClick={() => setSelected(null)} aria-label={t('mp.deed.close')}>
                  ×
                </button>
              </div>
              <DeedCard state={state} cellIndex={selectedCell.index} language={language} t={t} compact />
              {selectedOwner && selectedHolding && selectedOwner.id === current.id && !state.winnerId ? (
                <div className="mp-deed-live">
                  {selectedCell.type === 'property' ? (
                    <>
                      <button type="button" className="mp-btn small" onClick={() => apply(buildHouse(state, selectedCell.index))} disabled={!selectedCell.houseCost || selectedHolding.houses >= 5}>
                        {t('mp.deed.build', { cost: selectedCell.houseCost ?? 0 })}
                      </button>
                      <button type="button" className="mp-btn small ghost" onClick={() => apply(sellHouse(state, selectedCell.index))} disabled={selectedHolding.houses <= 0}>
                        {t('mp.deed.sell', { refund: Math.floor((selectedCell.houseCost ?? 0) / 2) })}
                      </button>
                    </>
                  ) : null}
                  {selectedHolding.mortgaged ? (
                    <button type="button" className="mp-btn small ghost" onClick={() => apply(unmortgageProperty(state, selectedCell.index))}>
                      {t('mp.deed.unmortgageBtn', { amount: Math.ceil((selectedCell.mortgage ?? 0) * 1.1) })}
                    </button>
                  ) : (
                    <button type="button" className="mp-btn small ghost" onClick={() => apply(mortgageProperty(state, selectedCell.index))} disabled={selectedHolding.houses > 0}>
                      {t('mp.deed.mortgageBtn', { amount: selectedCell.mortgage ?? Math.floor((selectedCell.price ?? 0) / 2) })}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mp-panel mp-log-panel">
              <div className="mp-panel-head">
                <h2>{t('mp.log.title')}</h2>
              </div>
              <ol className="mp-log">
                {log.length === 0 ? <li className="mp-empty">{t('mp.log.empty')}</li> : null}
                {[...log].reverse().map((entry) => (
                  <li key={entry.key}>{entry.text}</li>
                ))}
              </ol>
            </div>
          )}
          {selectedCell ? (
            <div className="mp-panel mp-log-panel mp-log-small">
              <div className="mp-panel-head">
                <h2>{t('mp.log.title')}</h2>
              </div>
              <ol className="mp-log">
                {[...log].reverse().slice(0, 8).map((entry) => (
                  <li key={entry.key}>{entry.text}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </aside>
      </div>

      {/* ---------------------------- satın alma modalı ---------------------------- */}
      {purchaseCell && purchaseCell.price !== undefined && !animating && !pendingCard ? (
        <div className="mp-overlay" role="dialog" aria-modal="true" aria-label={t('mp.buy.title')}>
          <div className="mp-modal mp-modal-buy">
            <p className="mp-modal-kicker">{t('mp.buy.title')}</p>
            <DeedCard state={state} cellIndex={purchaseCell.index} language={language} t={t} />
            <div className="mp-modal-actions">
              <button
                type="button"
                className="mp-btn primary"
                disabled={current.cash < purchaseCell.price || !selfIsCurrent}
                onClick={() => apply(buyProperty(state))}
              >
                {current.cash < purchaseCell.price ? t('mp.buy.noCash') : t('mp.buy.confirm', { price: purchaseCell.price })}
              </button>
              <button type="button" className="mp-btn" onClick={() => apply(declinePurchase(state))}>
                {t('mp.buy.decline')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ------------------------------- kart modalı ------------------------------- */}
      {pendingCard && cardView && !animating ? (
        <div className="mp-overlay" role="dialog" aria-modal="true" aria-label={pendingCard.deck === 'chance' ? t('mp.card.chance') : t('mp.card.community')}>
          <div className={`mp-modal mp-card-modal is-${pendingCard.deck}`}>
            <p className="mp-card-deck">{pendingCard.deck === 'chance' ? t('mp.card.chance') : t('mp.card.community')}</p>
            <div className="mp-card-face">
              <span className="mp-card-corner">₡</span>
              <h3>{cardView.title}</h3>
              <p>{cardView.text}</p>
              <span className="mp-card-glyph">{pendingCard.deck === 'chance' ? '?' : '≡'}</span>
            </div>
            <button type="button" className="mp-btn primary" onClick={() => apply(dismissCard(state))}>
              {t('mp.card.ok')}
            </button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------ kazanan modalı ----------------------------- */}
      {winner ? (
        <div className="mp-overlay" role="dialog" aria-modal="true" aria-label={t('mp.winner.title', { name: winner.name })}>
          <div className="mp-modal mp-winner" style={{ ['--winner-color' as string]: winner.color }}>
            <span className="mp-winner-crown">♛</span>
            <h2>{t('mp.winner.title', { name: winner.name })}</h2>
            <p>{t('mp.winner.text')}</p>
            <div className="mp-winner-cash">{money(winner.cash)}</div>
            <div className="mp-modal-actions">
              {onRestart ? (
                <button type="button" className="mp-btn primary" onClick={onRestart}>
                  {t('mp.winner.restart')}
                </button>
              ) : null}
              {onExit ? (
                <button type="button" className="mp-btn ghost" onClick={onExit}>
                  {t('mp.winner.exit')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Dışarıdan yeni oyun kurmak için kısa yardımcı (setup ekranı kullanır). */
export function newMonopolyGame(names: readonly string[]): MonopolyState {
  return createGame(names.map((name) => ({ name })));
}

export { calculateRent, cellName };
