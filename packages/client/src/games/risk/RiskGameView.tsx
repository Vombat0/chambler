/**
 * R2 — Territory Wars: tam etkileşimli strateji arayüzü.
 *
 * - İnteraktif Voronoi harita (SVG, fit-to-screen)
 * - Faz çubuğu: Takviye → Saldırı → İntikal → Turu Bitir
 * - Sinematik Çatışma Arenası modalı (zar kapışması + fetih kaydırıcısı)
 * - Kıta kontrol tablosu, oyuncu güçleri, savaş günlüğü
 * - Sıra bazlı sıcak keyif (hotseat) + yerel yapay zekâ rakipler
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  CANVAS,
  CONTINENTS,
  CONTINENT_OF,
  NEIGHBORS,
  REGION_IDS,
  buildShapes,
  getRegion,
  mulberry32,
  toSvgPoints,
} from './boardData';
import {
  type AttackOutcome,
  type RiskCard,
  type RiskState,
  armyCount,
  attack,
  canAttack,
  canDeploy,
  confirmCapture,
  continentOwner,
  createInitialState,
  currentPlayer,
  deploy,
  endTurn,
  findTradeSet,
  fortify,
  goToAttack,
  goToFortify,
  ownedTerritories,
  trade,
  tradeValue,
} from './riskEngine';
import { aiStep } from './ai';

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const PLAYER_PRESETS = [
  { name: 'Kızıl Lejyon', color: '#E2574C' },
  { name: 'Gök Hanedanı', color: '#4D9FE8' },
  { name: 'Altın Sancak', color: '#E8B84D' },
  { name: 'Yeşil Kurda', color: '#46C08A' },
] as const;

const CONTINENT_COLOR = Object.fromEntries(CONTINENTS.map((c) => [c.id, c.color]));

// ---------------------------------------------------------------------------
// Kök bileşen
// ---------------------------------------------------------------------------

export interface RiskGameViewProps {
  onExit?: () => void;
}

export function RiskGameView({ onExit }: RiskGameViewProps) {
  const [phase, setPhase] = useState<'lobby' | 'game'>('lobby');
  const [setup, setSetup] = useState<SetupRow[]>(() =>
    PLAYER_PRESETS.slice(0, 2).map((p) => ({ name: p.name, color: p.color, ai: false })),
  );

  return (
    <div className="risk-root">
      <style>{CSS}</style>
      {phase === 'lobby' ? (
        <Lobby
          setup={setup}
          setSetup={setSetup}
          onStart={() => setPhase('game')}
          onExit={onExit}
        />
      ) : (
        <RiskBoard setup={setup} onExit={() => setPhase('lobby')} onQuit={onExit} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lobi
// ---------------------------------------------------------------------------

interface SetupRow {
  name: string;
  color: string;
  ai: boolean;
}

function Lobby({
  setup,
  setSetup,
  onStart,
  onExit,
}: {
  setup: SetupRow[];
  setSetup: (s: SetupRow[]) => void;
  onStart: () => void;
  onExit?: () => void;
}) {
  const shapes = useMemo(() => buildShapes(), []);
  return (
    <div className="lobby">
      <svg className="lobby-map" viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`} aria-hidden>
        {REGION_IDS.map((id) => (
          <polygon
            key={id}
            points={toSvgPoints(shapes[id]!.points)}
            className="lobby-poly"
            fill={CONTINENT_COLOR[CONTINENT_OF[id]!]}
          />
        ))}
      </svg>
      <div className="lobby-panel">
        {onExit ? (
          <button
            className="rk-btn ghost sm"
            style={{ marginBottom: 10 }}
            onClick={onExit}
          >
            ✕ Ana Menü
          </button>
        ) : null}
        <div className="lobby-title">⚔ TERRITORY WARS</div>
        <div className="lobby-sub">Aetheris&apos;i kana kana fethet — 28 bölge, 5 kıta, tek imparator.</div>
        <div className="lobby-rows">
          {setup.map((row, i) => (
            <div className="lobby-row" key={i}>
              <span className="dot" style={{ background: row.color }} />
              <input
                className="rk-input"
                value={row.name}
                maxLength={18}
                onChange={(e) =>
                  setSetup(setup.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                }
              />
              <button
                className={`seg ${!row.ai ? 'on' : ''}`}
                onClick={() => setSetup(setup.map((r, j) => (j === i ? { ...r, ai: false } : r)))}
              >
                🧑 İnsan
              </button>
              <button
                className={`seg ${row.ai ? 'on' : ''}`}
                onClick={() => setSetup(setup.map((r, j) => (j === i ? { ...r, ai: true } : r)))}
              >
                🤖 Sunai
              </button>
            </div>
          ))}
        </div>
        <div className="lobby-actions">
          {setup.length < 4 && (
            <button
              className="rk-btn"
              onClick={() =>
                setSetup([...setup, { ...PLAYER_PRESETS[setup.length]!, ai: true }])
              }
            >
              + Ordu Ekle
            </button>
          )}
          {setup.length > 2 && (
            <button className="rk-btn ghost" onClick={() => setSetup(setup.slice(0, -1))}>
              − Ordu Çıkar
            </button>
          )}
          <button className="rk-btn primary big" onClick={onStart}>
            ⚔ SAVAŞI BAŞLAT
          </button>
        </div>
        <div className="lobby-rules">
          Kurallar: Takviye (max(3, bölge/3)+kıta bonusu) → Saldırı (≥2 asker, komşu düşman;
          eşitlikte savunan kazanır) → İntikal (turda 1 kez). Fetheden oyuncu kart çeker; 3 kart
          takas edilerek ordu büyür. Tek hedef: 28 bölgenin tamamı.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tahta
// ---------------------------------------------------------------------------

function RiskBoard({
  setup,
  onExit,
  onQuit,
}: {
  setup: SetupRow[];
  onExit: () => void;
  onQuit?: () => void;
}) {
  const seedRef = useRef(Date.now() >>> 0);
  const rngRef = useRef(mulberry32((Date.now() >>> 0) ^ 0x9e3779b9));
  const [game, setGame] = useState<RiskState>(() =>
    createInitialState({
      players: setup.map((s) => ({ name: s.name || 'Ordu', color: s.color, ai: s.ai })),
      seed: seedRef.current,
    }),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [fortifyFrom, setFortifyFrom] = useState<string | null>(null);
  const [fortifySel, setFortifySel] = useState<{ from: string; to: string } | null>(null);
  const [combat, setCombat] = useState<{
    from: string;
    to: string;
    last: AttackOutcome | null;
    defId: string;
  } | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [captureCount, setCaptureCount] = useState(0);
  const [ack, setAck] = useState<string>('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const shapes = useMemo(() => buildShapes(), []);
  const me = currentPlayer(game);
  const humanCount = game.players.filter((p) => !p.ai).length;
  const aiTurn = me.ai && game.phase !== 'VICTORY';
  const needAck =
    !me.ai && humanCount > 1 && game.phase !== 'VICTORY' && ack !== `${game.turn}:${game.current}`;

  // --- Yapay zekâ sürücüsü: her state değişiminde tek adım -----------------
  useEffect(() => {
    if (game.phase === 'VICTORY' || !me.ai) return;
    const t = window.setTimeout(() => setGame(aiStep(game, rngRef.current)), 480);
    return () => window.clearTimeout(t);
  }, [game, me.ai]);

  // --- Türetilen vurgular ---------------------------------------------------
  const attackTargets = useMemo(() => {
    const out = new Set<string>();
    if (game.phase === 'ATTACK' && selected && !game.pendingCapture && !aiTurn) {
      for (const nb of NEIGHBORS[selected] ?? []) {
        if (isEnemy(game, nb, me.id)) out.add(nb);
      }
    }
    return out;
  }, [game, selected, aiTurn, me.id]);

  const fortifyTargets = useMemo(() => {
    const out = new Set<string>();
    if (game.phase === 'FORTIFY' && fortifyFrom && !game.fortifyUsed && !aiTurn) {
      const seen = new Set([fortifyFrom]);
      const q = [fortifyFrom];
      while (q.length) {
        const cur = q.shift()!;
        for (const nb of NEIGHBORS[cur] ?? []) {
          if (seen.has(nb) || game.territories[nb]!.ownerId !== me.id) continue;
          seen.add(nb);
          out.add(nb);
          q.push(nb);
        }
      }
    }
    return out;
  }, [game, fortifyFrom, aiTurn, me.id]);

  // --- Eylemler --------------------------------------------------------------
  const clickRegion = useCallback(
    (id: string) => {
      if (aiTurn || needAck || game.phase === 'VICTORY' || combat || game.pendingCapture) return;
      const t = game.territories[id]!;
      if (game.phase === 'DEPLOY') {
        if (canDeploy(game, id)) setGame(deploy(game, id, 1));
        return;
      }
      if (game.phase === 'ATTACK') {
        if (t.ownerId === me.id) {
          setSelected((s) => (s === id ? null : t.armies >= 2 ? id : s));
          return;
        }
        if (selected && canAttack(game, selected, id) === null) {
          setCombat({
            from: selected,
            to: id,
            last: null,
            defId: game.territories[id]!.ownerId,
          });
        }
        return;
      }
      if (game.phase === 'FORTIFY') {
        if (t.ownerId !== me.id) {
          setFortifyFrom(null);
          return;
        }
        if (!fortifyFrom) {
          if (t.armies > 1) setFortifyFrom(id);
          return;
        }
        if (id === fortifyFrom) {
          setFortifyFrom(null);
          return;
        }
        if (fortifyTargets.has(id)) setFortifySel({ from: fortifyFrom, to: id });
        else if (t.armies > 1) setFortifyFrom(id);
      }
    },
    [aiTurn, needAck, game, combat, me.id, selected, fortifyFrom, fortifyTargets],
  );

  const rollAttack = useCallback(() => {
    if (!combat || game.pendingCapture) return;
    const outcome = attack(game, combat.from, combat.to, rngRef.current);
    setGame(outcome.state);
    setCombat({ ...combat, last: outcome });
    setCaptureCount(outcome.state.pendingCapture?.min ?? 0);
    if (outcome.captured) setSelected(null);
  }, [combat, game]);

  const autoDeploy = useCallback(() => {
    let s = game;
    let guard = s.deployPool;
    while (s.deployPool > 0 && guard-- > 0) {
      const mine = ownedTerritories(s, me.id);
      const border = mine.filter((id) =>
        (NEIGHBORS[id] ?? []).some((n) => s.territories[n]!.ownerId !== me.id),
      );
      const pool = border.length > 0 ? border : mine;
      const weakest = pool.sort(
        (a, b) => s.territories[a]!.armies - s.territories[b]!.armies,
      )[0]!;
      s = deploy(s, weakest, 1);
    }
    setGame(s);
  }, [game, me.id]);

  const doTrade = useCallback(() => {
    const set = findTradeSet(me.cards);
    if (set) setGame(trade(game, set));
  }, [game, me.cards]);

  const confirmFortify = useCallback(
    (count: number) => {
      if (!fortifySel) return;
      setGame(fortify(game, fortifySel.from, fortifySel.to, count));
      setFortifySel(null);
      setFortifyFrom(null);
    },
    [fortifySel, game],
  );

  const closeCombat = useCallback(() => {
    setCombat(null);
  }, []);

  // --- Render ----------------------------------------------------------------
  const phaseIdx = game.phase === 'DEPLOY' ? 0 : game.phase === 'ATTACK' ? 1 : 2;

  return (
    <div className="board" ref={wrapRef}>
      <TopBar
        game={game}
        phaseIdx={phaseIdx}
        onAutoDeploy={autoDeploy}
        onToAttack={() => setGame(goToAttack(game))}
        onToFortify={() => {
          setGame(goToFortify(game));
          setSelected(null);
          setCombat(null);
        }}
        onEndTurn={() => {
          setGame(endTurn(game));
          setSelected(null);
          setFortifyFrom(null);
          setFortifySel(null);
        }}
        onExit={onQuit ?? onExit}
      />

      <div className="mid">
        <div className="map-wrap">
          <svg
            className="map"
            viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
            preserveAspectRatio="xMidYMid meet"
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <filter id="rk-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feDropShadow dx="0" dy="0" stdDeviation="7" floodOpacity="0.9" />
              </filter>
            </defs>
            {REGION_IDS.map((id) => {
              const shape = shapes[id]!;
              const t = game.territories[id]!;
              const owner = game.players.find((p) => p.id === t.ownerId)!;
              const isSel = selected === id || fortifyFrom === id;
              const isTarget = attackTargets.has(id);
              const isFortT = fortifyTargets.has(id) && !isSel;
              const cls = [
                'region',
                t.ownerId === me.id && !aiTurn ? 'mine' : '',
                isSel ? 'sel' : '',
                isTarget ? 'target' : '',
                isFortT ? 'fort-t' : '',
                game.phase === 'DEPLOY' && canDeploy(game, id) ? 'deployable' : '',
                hover?.id === id ? 'hov' : '',
              ]
                .filter(Boolean)
                .join(' ');
              const pts = toSvgPoints(shape.points);
              const [cx, cy] = shape.centroid;
              return (
                <g key={id}>
                  <polygon
                    className={cls}
                    points={pts}
                    fill={owner.color}
                    onClick={() => clickRegion(id)}
                    onMouseMove={(e) => {
                      const r = wrapRef.current?.getBoundingClientRect();
                      setHover({ id, x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
                    }}
                  />
                  {t.armies > 0 && (
                    <g className="badge" pointerEvents="none">
                      <circle
                        cx={cx}
                        cy={cy}
                        r={15}
                        fill={owner.color}
                        stroke="#ffe9b0"
                        strokeWidth={1.4}
                        filter="url(#rk-glow)"
                        style={{ color: owner.color }}
                      />
                      <text x={cx} y={cy + 4.5} textAnchor="middle" className="badge-txt">
                        {getRegion(id).fortress ? '🏰' : '🛡️'}
                        {t.armies}
                      </text>
                    </g>
                  )}
                  <text x={shape.label[0]} y={shape.label[1] + 26} className="rname" pointerEvents="none">
                    {getRegion(id).name}
                  </text>
                </g>
              );
            })}
          </svg>

          {hover && (
            <div className="tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
              <b>{getRegion(hover.id).name}</b>
              <span className="tip-cont">
                {CONTINENTS.find((c) => c.id === CONTINENT_OF[hover.id])?.name}
              </span>
              <span>
                {game.players.find((p) => p.id === game.territories[hover.id]!.ownerId)?.name} ·{' '}
                {game.territories[hover.id]!.armies} asker
              </span>
            </div>
          )}

          {fortifySel && (
            <FortifyPanel
              max={game.territories[fortifySel.from]!.armies - 1}
              from={fortifySel.from}
              to={fortifySel.to}
              onConfirm={confirmFortify}
              onCancel={() => setFortifySel(null)}
            />
          )}

          {combat && (
            <CombatModal
              game={game}
              from={combat.from}
              to={combat.to}
              defId={combat.defId}
              last={combat.last}
              captureCount={captureCount}
              setCaptureCount={setCaptureCount}
              onRoll={rollAttack}
              onClose={closeCombat}
              onConfirmCapture={(n) => {
                setGame(confirmCapture(game, n));
                setCombat(null);
              }}
            />
          )}

          {!combat && game.pendingCapture && !aiTurn && (
            <CapturePanel
              game={game}
              count={captureCount}
              setCount={setCaptureCount}
              onConfirm={(n) => setGame(confirmCapture(game, n))}
            />
          )}

          {needAck && (
            <div className="overlay">
              <div className="panel center">
                <div className="ov-title">Sıra sende, komutan</div>
                <div className="ov-sub">
                  <span className="dot" style={{ background: me.color }} /> {me.name} — cihazı
                  devral ve hazır olduğunda başla.
                </div>
                <button className="rk-btn primary big" onClick={() => setAck(`${game.turn}:${game.current}`)}>
                  ⚔ HAZIRIM
                </button>
              </div>
            </div>
          )}

          {game.phase === 'VICTORY' && (
            <div className="overlay">
              <div className="panel center">
                <div className="ov-crown">👑</div>
                <div className="ov-title gold">
                  {game.players.find((p) => p.id === game.winnerId)?.name ?? '—'} ZAFERİ KAZANDI!
                </div>
                <div className="ov-sub">Aetheris&apos;in tek hakimi. {game.turn} turda mutlak fetih.</div>
                <div className="row gap">
                  <button className="rk-btn primary big" onClick={onExit}>
                    🔁 Yeni Savaş
                  </button>
                  {onQuit && (
                    <button className="rk-btn ghost" onClick={onQuit}>
                      Ana Menü
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <Sidebar game={game} onTrade={doTrade} />
      </div>
    </div>
  );
}

function isEnemy(game: RiskState, regionId: string, myId: string): boolean {
  return game.territories[regionId]!.ownerId !== myId;
}

// ---------------------------------------------------------------------------
// Üst bar
// ---------------------------------------------------------------------------

function TopBar({
  game,
  phaseIdx,
  onAutoDeploy,
  onToAttack,
  onToFortify,
  onEndTurn,
  onExit,
}: {
  game: RiskState;
  phaseIdx: number;
  onAutoDeploy: () => void;
  onToAttack: () => void;
  onToFortify: () => void;
  onEndTurn: () => void;
  onExit?: () => void;
}) {
  const me = currentPlayer(game);
  const steps = [
    `1. Asker Dağıt${game.phase === 'DEPLOY' ? ` (Kalan: ${game.deployPool})` : ''}`,
    '2. Saldırı',
    '3. Asker Kaydır',
  ];
  return (
    <div className="top">
      <button className="rk-btn ghost sm" onClick={onExit}>
        ✕ Ana Menü
      </button>
      <div className="turn-chip" style={{ borderColor: me.color }}>
        <span className="dot" style={{ background: me.color }} />
        <b>{me.name}</b>
        <span className="muted">tur {game.turn}</span>
        {me.ai && <span className="badge-ai">🤖</span>}
      </div>
      <div className="steps">
        {steps.map((s, i) => (
          <span key={s} className={`step ${i === phaseIdx ? 'on' : ''} ${i < phaseIdx ? 'done' : ''}`}>
            {s}
          </span>
        ))}
        <span className={`step ${game.phase === 'FORTIFY' ? 'wait' : ''}`}>4. Bitir</span>
      </div>
      <div className="row gap">
        {game.phase === 'DEPLOY' && (
          <>
            <button className="rk-btn sm" onClick={onAutoDeploy} disabled={game.deployPool === 0 || !!game.pendingCapture}>
              Otomatik Dağıt
            </button>
            <button className="rk-btn primary sm" onClick={onToAttack} disabled={game.deployPool > 0 || me.ai}>
              Saldırıya Geç →
            </button>
          </>
        )}
        {game.phase === 'ATTACK' && (
          <button className="rk-btn primary sm" onClick={onToFortify} disabled={me.ai || !!game.pendingCapture}>
            İntikale Geç →
          </button>
        )}
        {game.phase === 'FORTIFY' && (
          <button className="rk-btn primary sm" onClick={onEndTurn} disabled={me.ai || !!game.pendingCapture}>
            Turu Bitir ⏭
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Yan panel
// ---------------------------------------------------------------------------

function Sidebar({ game, onTrade }: { game: RiskState; onTrade: () => void }) {
  const me = currentPlayer(game);
  const tradeSet = game.phase === 'DEPLOY' && !me.ai ? findTradeSet(me.cards) : null;
  return (
    <aside className="side">
      <section>
        <h3>Ordular</h3>
        {game.players.map((p, i) => (
          <div key={p.id} className={`prow ${i === game.current ? 'on' : ''} ${p.eliminated ? 'out' : ''}`}>
            <span className="dot" style={{ background: p.color }} />
            <span className="pname">
              {p.name} {p.ai ? '🤖' : ''}
            </span>
            <span className="pstat">{ownedTerritories(game, p.id).length} bölge</span>
            <span className="pstat">{armyCount(game, p.id)} asker</span>
            <span className="pstat">🃏{p.cards.length}</span>
          </div>
        ))}
      </section>

      <section>
        <h3>Kıta Kontrolü</h3>
        <table className="rk-table">
          <tbody>
            {CONTINENTS.map((c) => {
              const ownerId = continentOwner(game, c.id);
              const owner = ownerId ? game.players.find((p) => p.id === ownerId) : null;
              return (
                <tr key={c.id}>
                  <td>
                    <span className="dot" style={{ background: c.color }} /> {c.name}
                  </td>
                  <td className="num">+{c.bonus}</td>
                  <td className={owner ? '' : 'muted'}>
                    {owner ? owner.name : 'sahipsiz'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {!me.ai && (
        <section>
          <h3>
            Fetih Kartları — {me.name}{' '}
            <span className="muted">(sıradaki takas: +{tradeValue(game.tradesDone)})</span>
          </h3>
          <div className="cards">
            {me.cards.length === 0 && <span className="muted">Fetih turu bitirince kart çekilir.</span>}
            {me.cards.map((c) => (
              <CardChip key={c.id} card={c} />
            ))}
          </div>
          {tradeSet && (
            <button className="rk-btn primary sm" onClick={onTrade}>
              🃏 Seti Takas Et (+{tradeValue(game.tradesDone)})
            </button>
          )}
        </section>
      )}

      <section className="log-sec">
        <h3>Savaş Günlüğü</h3>
        <div className="log">
          {[...game.log].slice(-14).reverse().map((l, i) => (
            <div key={`${game.turn}-${i}`} className="log-line">
              {l}
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function CardChip({ card }: { card: RiskCard }) {
  const color = card.wild ? '#9aa4b2' : CONTINENT_COLOR[card.kind];
  const label = card.wild
    ? '🃏 Joker'
    : card.regionId
      ? getRegion(card.regionId).name
      : card.kind;
  return (
    <span className="card-chip" style={{ borderColor: color }}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Çatışma Arenası
// ---------------------------------------------------------------------------

function CombatModal({
  game,
  from,
  to,
  defId,
  last,
  captureCount,
  setCaptureCount,
  onRoll,
  onClose,
  onConfirmCapture,
}: {
  game: RiskState;
  from: string;
  to: string;
  defId: string;
  last: AttackOutcome | null;
  captureCount: number;
  setCaptureCount: (n: number) => void;
  onRoll: () => void;
  onClose: () => void;
  onConfirmCapture: (n: number) => void;
}) {
  const a = game.territories[from]!;
  const d = game.territories[to]!;
  const pc = game.pendingCapture;
  const atkPlayer = game.players.find((p) => p.id === a.ownerId)!;
  const defPlayer = game.players.find((p) => p.id === defId);
  const captured = last?.captured === true;
  const canRoll = game.phase === 'ATTACK' && !pc && a.armies >= 2 && d.armies >= 1;
  const rollKey = game.log.length;

  return (
    <div className="combat">
      <div className="panel combat-panel">
        <div className="combat-vs">
          <div className="combat-side">
            <div className="cs-name" style={{ color: atkPlayer.color }}>
              {getRegion(from).name} <span className="muted">· {atkPlayer.name}</span>
            </div>
            <div className="cs-armies">🛡️ {a.armies} asker</div>
            <DiceRow key={`a${rollKey}`} dice={last?.attackerDice ?? []} color="#E2574C" label="Saldıran" />
          </div>
          <div className="vs">VS</div>
          <div className="combat-side right">
            <div className="cs-name" style={{ color: defPlayer?.color ?? '#888' }}>
              {getRegion(to).name} <span className="muted">· {defPlayer?.name ?? '?'}</span>
            </div>
            <div className="cs-armies">🛡️ {captured ? 0 : d.armies} asker</div>
            <DiceRow key={`d${rollKey}`} dice={last?.defenderDice ?? []} color="#4D9FE8" label="Savunan" />
          </div>
        </div>

        {last && !captured && (
          <div className="verdict">
            {last.attackerLosses > 0 || last.defenderLosses > 0
              ? `Saldıran ${last.attackerLosses} kaybetti, Savunan ${last.defenderLosses} kaybetti`
              : 'Zarlar eşleşti — kayıp yok.'}
          </div>
        )}
        {!last && <div className="verdict muted">Zarları at! (Eşitlikte savunan kazanır)</div>}

        {captured && pc ? (
          <div className="capture">
            <div className="fetih">🏆 FETİH EDİLDİ — {getRegion(to).name} artık senin!</div>
            <label className="row gap slider-row">
              Aktarılacak asker: <b>{captureCount}</b>
              <input
                type="range"
                min={pc.min}
                max={pc.max}
                value={Math.min(Math.max(captureCount, pc.min), pc.max)}
                onChange={(e) => setCaptureCount(Number(e.target.value))}
              />
              <span className="muted">
                (en az {pc.min}, en fazla {pc.max} — bölgede 1 asker kalmalı)
              </span>
            </label>
            <button className="rk-btn primary big" onClick={() => onConfirmCapture(captureCount)}>
              ✅ Orduyu Taşı
            </button>
          </div>
        ) : (
          <div className="row gap combat-actions">
            <button
              className="rk-btn danger big"
              onClick={onRoll}
              disabled={!canRoll}
              key={last ? `${last.attackerDice.join()}-${last.defenderDice.join()}` : 'first'}
            >
              ⚔️ SALDIR! (Zar At)
            </button>
            <button className="rk-btn ghost" onClick={onClose} disabled={!!pc}>
              🏳 Bölgeden Çekil
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DiceRow({ dice, color, label }: { dice: readonly number[]; color: string; label: string }) {
  return (
    <div className={`dice-row ${label === 'Saldıran' ? 'atk' : 'def'}`}>
      <span className="dice-label">{label}</span>
      <div className="dice-cups">
        {dice.length === 0 && <span className="muted">— —</span>}
        {dice.map((v, i) => (
          <Die key={`${i}-${v}`} value={v} color={color} />
        ))}
      </div>
    </div>
  );
}

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function Die({ value, color }: { value: number; color: string }) {
  return (
    <span className="die" style={{ '--die': color } as CSSProperties}>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={PIPS[value]?.includes(i) ? 'pip on' : 'pip'} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Fetih / İntikal panelleri
// ---------------------------------------------------------------------------

function CapturePanel({
  game,
  count,
  setCount,
  onConfirm,
}: {
  game: RiskState;
  count: number;
  setCount: (n: number) => void;
  onConfirm: (n: number) => void;
}) {
  const pc = game.pendingCapture!;
  return (
    <div className="bottom-panel">
      <b>🏆 FETİH: {getRegion(pc.to).name}</b>
      <input
        type="range"
        min={pc.min}
        max={pc.max}
        value={Math.min(Math.max(count, pc.min), pc.max)}
        onChange={(e) => setCount(Number(e.target.value))}
      />
      <span>
        {Math.min(Math.max(count, pc.min), pc.max)} asker taşı
      </span>
      <button className="rk-btn primary sm" onClick={() => onConfirm(Math.max(count, pc.min))}>
        Onayla
      </button>
    </div>
  );
}

function FortifyPanel({
  from,
  to,
  max,
  onConfirm,
  onCancel,
}: {
  from: string;
  to: string;
  max: number;
  onConfirm: (n: number) => void;
  onCancel: () => void;
}) {
  const [n, setN] = useState(max);
  return (
    <div className="bottom-panel">
      <b>
        ⇢ {getRegion(from).name} → {getRegion(to).name}
      </b>
      <input type="range" min={1} max={Math.max(1, max)} value={Math.min(n, max)} onChange={(e) => setN(Number(e.target.value))} />
      <span>{Math.min(n, max)} asker</span>
      <button className="rk-btn primary sm" onClick={() => onConfirm(Math.min(n, max))} disabled={max < 1}>
        Kaydır
      </button>
      <button className="rk-btn ghost sm" onClick={onCancel}>
        Vazgeç
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSS (kapsamlı)
// ---------------------------------------------------------------------------

const CSS = `
.risk-root { position: fixed; inset: 0; z-index: 40; display: flex; flex-direction: column;
  font-family: 'Segoe UI', system-ui, sans-serif; color: #dbe4f0;
  background: radial-gradient(1200px 700px at 50% -10%, #1a2c45 0%, #0b1220 60%, #070b14 100%); }
.risk-root * { box-sizing: border-box; }
.risk-root .muted { color: #8fa0b8; font-weight: 400; }
.risk-root .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; box-shadow: 0 0 6px currentColor; }
.risk-root .row { display: flex; align-items: center; } .risk-root .gap { gap: 8px; }

/* Lobi */
.risk-root .lobby { position: absolute; inset: 0; display: grid; place-items: center; }
.risk-root .lobby-map { position: absolute; inset: 4% 0 auto 0; width: 100%; max-height: 46%; opacity: .5; filter: saturate(.7); }
.risk-root .lobby-poly { stroke: #0b1220; stroke-width: 4; }
.risk-root .lobby-panel { position: relative; z-index: 2; width: min(560px, 94%); padding: 26px 28px; border-radius: 14px;
  background: rgba(10, 16, 28, .88); border: 1px solid rgba(217, 164, 65, .35); box-shadow: 0 24px 80px rgba(0,0,0,.6); backdrop-filter: blur(6px); }
.risk-root .lobby-title { font-size: 30px; letter-spacing: 4px; font-weight: 800; color: #f0c674; text-shadow: 0 0 24px rgba(240,198,116,.35); }
.risk-root .lobby-sub { color: #9fb0c8; margin: 6px 0 18px; }
.risk-root .lobby-rows { display: flex; flex-direction: column; gap: 8px; }
.risk-root .lobby-row { display: flex; gap: 8px; align-items: center; }
.risk-root .rk-input { flex: 1; background: #101a2c; border: 1px solid #2a3a55; color: #e6edf7; padding: 8px 10px; border-radius: 8px; font-size: 14px; }
.risk-root .seg { background: #131f33; border: 1px solid #2a3a55; color: #93a5be; padding: 7px 10px; border-radius: 8px; cursor: pointer; font-size: 12.5px; }
.risk-root .seg.on { background: #24405f; border-color: #4d7ba8; color: #eaf2fc; }
.risk-root .lobby-actions { display: flex; gap: 10px; margin-top: 18px; align-items: center; }
.risk-root .lobby-rules { margin-top: 16px; font-size: 12px; color: #7e90aa; line-height: 1.55; }

/* Butonlar */
.risk-root .rk-btn { background: #18263d; border: 1px solid #33486b; color: #dbe6f5; padding: 9px 14px; border-radius: 9px; cursor: pointer; font-size: 13.5px; transition: all .15s; }
.risk-root .rk-btn:hover:not(:disabled) { border-color: #55719e; background: #1f3150; }
.risk-root .rk-btn:disabled { opacity: .4; cursor: not-allowed; }
.risk-root .rk-btn.primary { background: linear-gradient(180deg, #b98a3c, #8a6324); border-color: #d9a441; color: #fff8e8; font-weight: 700; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
.risk-root .rk-btn.primary:hover:not(:disabled) { filter: brightness(1.12); }
.risk-root .rk-btn.danger { background: linear-gradient(180deg, #b03a30, #7e241d); border-color: #e2574c; color: #ffe9e6; font-weight: 800; }
.risk-root .rk-btn.danger:hover:not(:disabled) { filter: brightness(1.15); }
.risk-root .rk-btn.ghost { background: transparent; }
.risk-root .rk-btn.sm { padding: 7px 11px; font-size: 12.5px; }
.risk-root .rk-btn.big { padding: 12px 22px; font-size: 15px; }
.risk-root .step.wait { opacity: .55; }

/* Tahta */
.risk-root .board { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.risk-root .top { display: flex; align-items: center; gap: 14px; padding: 10px 14px; border-bottom: 1px solid rgba(217,164,65,.25); background: rgba(8,12,22,.75); flex-wrap: wrap; }
.risk-root .turn-chip { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border: 1.5px solid; border-radius: 999px; background: rgba(20,30,50,.8); font-size: 13.5px; }
.risk-root .badge-ai { font-size: 12px; }
.risk-root .steps { display: flex; gap: 6px; flex: 1; flex-wrap: wrap; }
.risk-root .step { font-size: 12px; padding: 5px 10px; border-radius: 999px; background: #101a2c; border: 1px solid #263a58; color: #7e90aa; }
.risk-root .step.on { background: #2b2412; border-color: #d9a441; color: #f0c674; font-weight: 700; box-shadow: 0 0 14px rgba(217,164,65,.25); }
.risk-root .step.done { color: #5d7191; text-decoration: line-through; }
.risk-root .mid { flex: 1; display: flex; min-height: 0; }
.risk-root .map-wrap { position: relative; flex: 1; min-width: 0; }
.risk-root .map { width: 100%; height: 100%; display: block; }

.risk-root polygon.region { stroke: #0a1322; stroke-width: 2.4; opacity: .62; cursor: pointer; transition: opacity .15s, filter .15s; }
.risk-root polygon.region:hover, .risk-root polygon.region.hov { opacity: .95; filter: brightness(1.25) drop-shadow(0 0 8px rgba(255, 225, 150, .55)); }
.risk-root polygon.region.mine { opacity: .78; stroke: rgba(255, 233, 176, .5); }
.risk-root polygon.region.deployable { animation: rk-soft 1.6s ease-in-out infinite; }
.risk-root polygon.region.sel { opacity: .95; stroke: #ffd97a; stroke-width: 4; filter: drop-shadow(0 0 12px rgba(255, 217, 122, .9)); }
.risk-root polygon.region.target { stroke: #ff5a4e; stroke-width: 3.4; animation: rk-pulse 0.9s ease-in-out infinite; cursor: crosshair; }
.risk-root polygon.region.fort-t { stroke: #57e0c2; stroke-width: 3; animation: rk-pulse 1.2s ease-in-out infinite; cursor: pointer; }
@keyframes rk-pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; filter: drop-shadow(0 0 10px rgba(255,90,78,.8)); } }
@keyframes rk-soft { 0%,100% { opacity: .78; } 50% { opacity: .95; } }
.risk-root .badge circle { filter: drop-shadow(0 0 6px currentColor); }
.risk-root .badge-txt { font-size: 12.5px; font-weight: 800; fill: #fff6df; paint-order: stroke; stroke: rgba(0,0,0,.55); stroke-width: 3px; }
.risk-root .rname { font-size: 12.5px; fill: #c6d4e8; text-anchor: middle; opacity: .85; font-weight: 600; }
.risk-root .rname:hover { opacity: 1; }

.risk-root .tip { position: absolute; z-index: 6; pointer-events: none; display: flex; flex-direction: column; gap: 2px;
  background: rgba(10,16,28,.95); border: 1px solid rgba(217,164,65,.5); padding: 8px 11px; border-radius: 8px; font-size: 12.5px; max-width: 230px; }
.risk-root .tip-cont { color: #d9a441; font-size: 11.5px; }

/* Yan panel */
.risk-root .side { width: 292px; flex-shrink: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 16px; border-left: 1px solid rgba(217,164,65,.2); background: rgba(8,12,22,.6); }
.risk-root .side h3 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 1.6px; color: #d9a441; }
.risk-root .prow { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 8px; font-size: 12.5px; }
.risk-root .prow.on { background: rgba(217,164,65,.12); outline: 1px solid rgba(217,164,65,.4); }
.risk-root .prow.out { opacity: .45; text-decoration: line-through; }
.risk-root .pname { flex: 1; font-weight: 600; }
.risk-root .pstat { color: #93a5be; font-size: 11.5px; white-space: nowrap; }
.risk-root .rk-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.risk-root .rk-table td { padding: 4px 6px; border-bottom: 1px solid rgba(80,100,130,.2); }
.risk-root .rk-table .num { text-align: right; color: #d9a441; font-variant-numeric: tabular-nums; }
.risk-root .cards { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; font-size: 12px; }
.risk-root .card-chip { border: 1px solid; border-radius: 6px; padding: 3px 8px; background: #101a2c; }
.risk-root .log-sec { flex: 1; min-height: 120px; display: flex; flex-direction: column; }
.risk-root .log { flex: 1; overflow-y: auto; font-size: 11.5px; color: #93a5be; display: flex; flex-direction: column; gap: 4px; }
.risk-root .log-line { border-left: 2px solid rgba(217,164,65,.35); padding-left: 7px; }

/* Modallar / overlayler */
.risk-root .overlay { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(4,8,16,.72); z-index: 9; backdrop-filter: blur(3px); }
.risk-root .panel { background: linear-gradient(180deg, rgba(18,28,46,.97), rgba(12,18,32,.97)); border: 1px solid rgba(217,164,65,.45); border-radius: 14px; box-shadow: 0 30px 90px rgba(0,0,0,.7); }
.risk-root .panel.center { padding: 30px 38px; display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; }
.risk-root .ov-title { font-size: 24px; font-weight: 800; letter-spacing: 1px; }
.risk-root .ov-title.gold { color: #f0c674; text-shadow: 0 0 30px rgba(240,198,116,.5); }
.risk-root .ov-crown { font-size: 54px; }
.risk-root .ov-sub { color: #9fb0c8; }

.risk-root .combat { position: absolute; inset: 0; z-index: 8; display: grid; place-items: center; background: rgba(4,8,16,.55); backdrop-filter: blur(2px); }
.risk-root .combat-panel { width: min(640px, 94%); padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; }
.risk-root .combat-vs { display: grid; grid-template-columns: 1fr auto 1fr; gap: 14px; align-items: center; }
.risk-root .combat-side.right { text-align: right; }
.risk-root .cs-name { font-size: 16px; font-weight: 800; }
.risk-root .cs-armies { font-size: 13px; color: #b9c7db; margin: 2px 0 8px; }
.risk-root .vs { font-size: 22px; font-weight: 900; color: #f0c674; text-shadow: 0 0 18px rgba(240,198,116,.6); }
.risk-root .dice-row { display: flex; flex-direction: column; gap: 5px; }
.risk-root .combat-side.right .dice-row { align-items: flex-end; }
.risk-root .dice-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 1.5px; color: #8fa0b8; }
.risk-root .dice-cups { display: flex; gap: 7px; }
.risk-root .die { width: 34px; height: 34px; border-radius: 7px; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
  padding: 5px; background: linear-gradient(150deg, #f6f2ea, #d8d2c4); box-shadow: 0 3px 8px rgba(0,0,0,.5), inset 0 0 4px rgba(255,255,255,.7);
  animation: rk-roll .5s cubic-bezier(.2,1.6,.4,1); }
.risk-root .die .pip { border-radius: 50%; }
.risk-root .die .pip.on { background: var(--die, #E2574C); box-shadow: 0 0 5px var(--die, #E2574C), inset 0 1px 1px rgba(0,0,0,.4); }
@keyframes rk-roll { 0% { transform: rotate(-160deg) scale(.4); opacity: 0; } 60% { transform: rotate(12deg) scale(1.12); } 100% { transform: rotate(0) scale(1); } }
.risk-root .verdict { text-align: center; font-size: 15px; font-weight: 700; color: #f0d9a4; min-height: 20px; }
.risk-root .combat-actions { justify-content: center; }
.risk-root .capture { display: flex; flex-direction: column; gap: 10px; align-items: center; text-align: center; }
.risk-root .fetih { font-size: 19px; font-weight: 900; color: #7ee08a; text-shadow: 0 0 22px rgba(126,224,138,.55); animation: rk-pop .45s cubic-bezier(.2,1.7,.4,1); }
@keyframes rk-pop { 0% { transform: scale(.4); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
.risk-root .slider-row { font-size: 13px; }
.risk-root input[type='range'] { accent-color: #d9a441; width: 190px; }

.risk-root .bottom-panel { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 7;
  display: flex; align-items: center; gap: 12px; padding: 12px 18px; font-size: 13.5px;
  background: rgba(12,18,32,.95); border: 1px solid rgba(217,164,65,.5); border-radius: 12px; box-shadow: 0 16px 50px rgba(0,0,0,.6); }
`;
