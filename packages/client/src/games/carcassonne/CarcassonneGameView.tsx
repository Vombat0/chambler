/**
 * CarcassonneGameView — Tile Kingdoms profesyonel masa oyunu arayüzü (R3).
 * Sürüklenebilir/yakınlaştırılabilir sonsuz masa, döndürülebilir karo,
 * yeşil nabızlı geçerli alanlar, meeple balonu ve kutlama bildirimleri.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CarcassonneEngine,
  cellKey,
  edgesAt,
  type Feature,
  type PlacementCell,
  type TileDef,
} from './carcassonneEngine.js';

const TILE = 100; // SVG birim hücresi

interface PlayerInput {
  name: string;
  color?: string;
}

interface CarcassonneGameViewProps {
  players?: PlayerInput[];
  onExit?: () => void;
}

interface Toast {
  id: number;
  text: string;
  born: number;
}

// ---------------------------------------------------------------------------
// Karo çizimi (prosedürel SVG — pack görsellerinin vektör karşılığı)
// ---------------------------------------------------------------------------

function EdgeBand({ edge, color, width }: { edge: 'north' | 'east' | 'south' | 'west'; color: string; width: number }) {
  const w = width;
  const c = TILE / 2;
  const t = c + w / 2;
  switch (edge) {
    case 'north':
      return <rect x={c - w / 2} y={0} width={w} height={t} fill={color} />;
    case 'south':
      return <rect x={c - w / 2} y={TILE - t} width={w} height={t} fill={color} />;
    case 'east':
      return <rect x={TILE - t} y={c - w / 2} width={t} height={w} fill={color} />;
    case 'west':
      return <rect x={0} y={c - w / 2} width={t} height={w} fill={color} />;
  }
}

const EDGE_COLORS = { city: '#a89a82', road: '#d8c294', shrine: '#9b7fc4', field: 'transparent' } as const;

function TileArt({ def }: { def: TileDef }) {
  const e = def.edges;
  const dirs = ['north', 'east', 'south', 'west'] as const;
  return (
    <g>
      <rect x={0} y={0} width={TILE} height={TILE} fill="#7d9c53" stroke="#6a8746" strokeWidth={1.5} />
      {/* çayır dokusu */}
      <circle cx={20} cy={22} r={2.4} fill="#6f8d49" />
      <circle cx={82} cy={78} r={2.4} fill="#6f8d49" />
      <circle cx={76} cy={18} r={2} fill="#6f8d49" />
      {dirs.map((d) =>
        e[d] !== 'field' ? <EdgeBand key={d} edge={d} color={EDGE_COLORS[e[d]]} width={e[d] === 'road' ? 26 : 44} /> : null,
      )}
      {/* kale duvarı çizgileri */}
      {dirs.map((d) =>
        e[d] === 'city' ? <EdgeBand key={`w${d}`} edge={d} color="#8f8068" width={6} /> : null,
      )}
      {/* kale merkezi */}
      {(def.centre === 'city' || def.start) && (
        <g>
          <rect x={26} y={26} width={48} height={48} rx={5} fill="#8d7f66" stroke="#6f6350" strokeWidth={3} />
          {[32, 46, 60].map((x) => (
            <rect key={x} x={x} y={22} width={9} height={8} fill="#8d7f66" stroke="#6f6350" strokeWidth={2} />
          ))}
          <rect x={44} y={54} width={12} height={20} rx={4} fill="#54483a" />
        </g>
      )}
      {/* arma / sancak */}
      {Array.from({ length: def.pennants ?? 0 }).map((_, i) => (
        <g key={`p${i}`} transform={`translate(${i === 0 ? 58 : 34},30)`}>
          <line x1={0} y1={0} x2={0} y2={-14} stroke="#3d342a" strokeWidth={2} />
          <path d="M0,-14 L12,-10 L0,-6 Z" fill={def.fortress && i === 1 ? '#c94f3d' : '#c9a667'} />
        </g>
      ))}
      {/* yol merkezi (kavşak/han/köy) */}
      {def.centre === 'road' && <circle cx={50} cy={50} r={11} fill="#d8c294" stroke="#b39c6e" strokeWidth={3} />}
      {/* mabet şapeli */}
      {def.centre === 'shrine' && (
        <g>
          <rect x={38} y={46} width={24} height={22} rx={2} fill="#efe7d6" stroke="#7a6a52" strokeWidth={2.5} />
          <path d="M34,48 L50,30 L66,48 Z" fill="#9b7fc4" stroke="#6f5a92" strokeWidth={2.5} />
          <line x1={50} y1={24} x2={50} y2={32} stroke="#6f5a92" strokeWidth={2.5} />
          <line x1={46} y1={27} x2={54} y2={27} stroke="#6f5a92" strokeWidth={2.5} />
        </g>
      )}
      {/* merkezi mabet kenarı (centre none ama kutsal kenar var) için parıltı */}
      {!def.centre && Object.values(def.edges).includes('shrine') && <circle cx={50} cy={50} r={7} fill="#9b7fc4" opacity={0.8} />}
    </g>
  );
}

const MEEPLE_POS: Record<Feature, [number, number]> = {
  city: [50, 36],
  road: [50, 50],
  shrine: [50, 62],
  field: [50, 74],
};

const FEATURE_LABEL: Record<Feature, string> = {
  road: '🚶 Yola Gözcü',
  city: '🛡️ Kaleye Muhafız',
  shrine: '⛪ Mabete Keşiş',
  field: '🌾 Çayıra Çiftçi',
};

// ---------------------------------------------------------------------------
// Ana bileşen
// ---------------------------------------------------------------------------

export function CarcassonneGameView({ players, onExit }: CarcassonneGameViewProps) {
  const engineRef = useRef<CarcassonneEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new CarcassonneEngine({ players: players ?? undefined, seed: (Math.random() * 1e9) | 0 });
  }
  const engine = engineRef.current;
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const eventCount = useRef(0);
  const toastId = useRef(0);

  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ px: number; py: number; moved: boolean } | null>(null);

  // ortala
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setView({ tx: w / 2 - TILE / 2, ty: h / 2 - TILE / 2, k: Math.min(1.05, Math.max(0.7, w / 900)) });
  }, []);

  // toast kuyruğu
  useEffect(() => {
    if (engine.events.length > eventCount.current) {
      const fresh = engine.events.slice(eventCount.current);
      eventCount.current = engine.events.length;
      setToasts((prev) => [
        ...prev.slice(-3),
        ...fresh.map((ev) => ({ id: (toastId.current += 1), text: ev.message, born: Date.now() })),
      ]);
    }
  });
  useEffect(() => {
    const t = window.setInterval(() => setToasts((prev) => prev.filter((x) => Date.now() - x.born < 5000)), 900);
    return () => window.clearInterval(t);
  }, []);

  // sıra SENDEN: karo otomatik çekilir (torba bitişi hariç)
  useEffect(() => {
    if (engine.phase !== 'DRAW') return;
    const t = window.setTimeout(() => {
      const res = engine.drawTile();
      if (res.discarded.length > 0) {
        setToasts((prev) => [
          ...prev.slice(-3),
          { id: (toastId.current += 1), text: `⚠️ ${res.discarded.length} karo hiçbir yere oturmadı, elendi.`, born: Date.now() },
        ]);
      }
      bump();
    }, 420);
    return () => window.clearTimeout(t);
  }, [engine, engine.phase, engine.activePlayerIndex, bump]);

  // R ile döndür
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.key === 'r' || ev.key === 'R') && engine.phase === 'PLACE_TILE') {
        engine.rotateCurrent();
        bump();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, bump]);

  // tekerlekle zoom (imleç odaklı) — passive:false şart
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(2.6, Math.max(0.3, v.k * Math.exp(-e.deltaY * 0.0012)));
        return { k, tx: mx - ((mx - v.tx) * k) / v.k, ty: my - ((my - v.ty) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const act = useCallback(
    (fn: () => void) => {
      fn();
      bump();
    },
    [bump],
  );

  const myTurn = engine.phase === 'PLACE_TILE' && engine.currentTile !== null;
  const validCells: PlacementCell[] = useMemo(
    () => (myTurn && engine.currentTile ? engine.getValidPlacements(engine.currentTile.def, engine.currentTile.rotation) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myTurn, engine.currentTile?.instanceId, engine.currentTile?.rotation, engine.boardGrid.size],
  );
  const validSet = useMemo(() => new Set(validCells.map((c) => c.key)), [validCells]);
  const pendingKey = engine.pendingKey();
  const meepleOptions: Feature[] = pendingKey ? engine.getMeepleOptions(pendingKey) : [];

  const cellFromEvent = (e: React.PointerEvent | React.MouseEvent): { x: number; y: number } | null => {
    const el = wrapRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const v = viewRef.current;
    const bx = (e.clientX - rect.left - v.tx) / v.k / TILE;
    const by = (e.clientY - rect.top - v.ty) / v.k / TILE;
    return { x: Math.floor(bx), y: Math.floor(by) };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    dragRef.current = { px: e.clientX, py: e.clientY, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    d.px = e.clientX;
    d.py = e.clientY;
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const handlePointerUp = () => {
    setTimeout(() => (dragRef.current = null), 0);
  };
  const handleClick = (e: React.MouseEvent) => {
    if (dragRef.current?.moved) return;
    if (!myTurn || !engine.currentTile) return;
    const cell = cellFromEvent(e);
    if (!cell || !validSet.has(cellKey(cell.x, cell.y))) return;
    act(() => {
      engine.placeTile(cell.x, cell.y);
    });
  };

  const reset = () => {
    engineRef.current = new CarcassonneEngine({ players: players ?? undefined, seed: (Math.random() * 1e9) | 0 });
    eventCount.current = 0;
    setToasts([]);
    bump();
  };

  const ranked = engine.ranking();
  const bagLeft = engine.tileBag.length;
  const previewDef = engine.currentTile?.def;

  return (
    <div className="ck-root">
      <style>{CSS}</style>
      {/* --- masa --- */}
      <div
        ref={wrapRef}
        className="ck-board"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onClick={handleClick}
      >
        <svg width="100%" height="100%" style={{ cursor: 'grab', touchAction: 'none' }}>
          <defs>
            <radialGradient id="ck-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffe97a" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#ffe97a" stopOpacity={0} />
            </radialGradient>
          </defs>
          <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
            {/* yerleşik karolar */}
            {[...engine.boardGrid.values()].map((t) => (
              <g key={t.key} transform={`translate(${t.x * TILE},${t.y * TILE})`}>
                <g transform={`rotate(${t.rotation},${TILE / 2},${TILE / 2})`}>
                  <TileArt def={t.def} />
                </g>
              </g>
            ))}
            {/* geçerli hücreler: yeşil nabız */}
            {validCells.map((c) => (
              <rect
                key={`v${c.key}`}
                className="ck-pulse"
                x={c.x * TILE + 3}
                y={c.y * TILE + 3}
                width={TILE - 6}
                height={TILE - 6}
                rx={8}
                fill="rgba(84,214,120,0.22)"
                stroke="#54d678"
                strokeWidth={3}
                strokeDasharray="10 7"
              />
            ))}
            {/* meeple iğneleri */}
            {engine.placedMeeples.map((m, i) => {
              const t = engine.boardGrid.get(m.tileKey);
              if (!t) return null;
              const [fx, fy] = MEEPLE_POS[m.feature];
              const px = t.x * TILE + fx + (i % 2 === 0 ? 0 : 18) - 9;
              const pyy = t.y * TILE + fy;
              const color = engine.players.find((p) => p.id === m.ownerId)?.color ?? '#fff';
              return (
                <g key={`m${i}`} transform={`translate(${px},${pyy})`}>
                  <circle r={13} fill="url(#ck-glow)" />
                  <circle r={7.5} fill={color} stroke="#fff" strokeWidth={2.2} />
                  <circle cy={-1} r={2.4} fill="#ffffff" opacity={0.85} />
                </g>
              );
            })}
          </g>
        </svg>

        {/* --- kutlama bildirimleri --- */}
        <div className="ck-toasts">
          {toasts.map((t) => (
            <div key={t.id} className="ck-toast">
              {t.text}
            </div>
          ))}
        </div>

        {/* --- meeple balonu --- */}
        {engine.phase === 'PLACE_MEEPLE' && (
          <div className="ck-popover">
            <span className="ck-popover-title">İşçi yerleştir:</span>
            {meepleOptions.map((f) => (
              <button
                key={f}
                className="ck-chip"
                onClick={() => act(() => void engine.placeMeeple(f))}
              >
                {FEATURE_LABEL[f]}
              </button>
            ))}
            <button className="ck-chip ck-chip-pass" onClick={() => act(() => engine.passMeeple())}>
              ✕ Pas Geç
            </button>
          </div>
        )}

        {/* --- oyun sonu --- */}
        {engine.phase === 'GAME_OVER' && (
          <div className="ck-gameover">
            <div className="ck-gameover-card">
              <h2>⚑ Oyun Bitti!</h2>
              {ranked.map((p, i) => (
                <div key={p.id} className="ck-rank">
                  <span>{['🥇', '🥈', '🥉', '4.', '5.'][i]}</span>
                  <span className="ck-dot" style={{ background: p.color }} />
                  <b>{p.name}</b>
                  <span className="ck-score">{p.score} puan</span>
                </div>
              ))}
              <p className="ck-muted">
                {engine.winners.length
                  ? `🏆 Zafer: ${engine.winners.map((id) => engine.players.find((p) => p.id === id)?.name).join(' & ')}`
                  : 'Berabere!'}
              </p>
              <div className="ck-row">
                <button className="ck-btn" onClick={reset}>
                  🔄 Yeniden Oyna
                </button>
                {onExit && (
                  <button className="ck-btn ck-btn-ghost" onClick={onExit}>
                    ← Menü
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* --- HUD --- */}
      <aside className="ck-hud">
        <div className="ck-hud-title">
          🏰 Tile Kingdoms
          {onExit && (
            <button className="ck-btn ck-btn-mini" onClick={onExit}>
              ✕
            </button>
          )}
        </div>
        <div className="ck-turn" style={{ borderColor: engine.activePlayer.color }}>
          Sıra: <b style={{ color: engine.activePlayer.color }}>{engine.activePlayer.name}</b>
          <span className="ck-phase">
            {engine.phase === 'DRAW' && 'karo çekiliyor…'}
            {engine.phase === 'PLACE_TILE' && 'karo yerleştir'}
            {engine.phase === 'PLACE_MEEPLE' && 'işçi seç'}
            {engine.phase === 'SCORE' && 'puanlanıyor…'}
            {engine.phase === 'GAME_OVER' && 'bitti'}
          </span>
        </div>

        <div className="ck-preview-label">Elindeki karo</div>
        <div className="ck-preview">
          {previewDef ? (
            <svg viewBox="-4 -4 108 108" width={132} height={132}>
              <g transform={`rotate(${engine.currentTile?.rotation ?? 0},50,50)`}>
                <TileArt def={previewDef} />
              </g>
            </svg>
          ) : (
            <div className="ck-muted ck-center">{engine.phase === 'GAME_OVER' ? '—' : '…'}</div>
          )}
        </div>
        <button
          className="ck-btn"
          disabled={!myTurn}
          onClick={() => act(() => engine.rotateCurrent())}
          title="Kısayol: R"
        >
          ↻ Döndür (R)
        </button>
        <div className="ck-bag">🎴 Kalan Karo: <b>{bagLeft}</b></div>

        <div className="ck-players">
          {engine.players.map((p, i) => (
            <div key={p.id} className={`ck-player${engine.activePlayerIndex === i ? ' ck-active' : ''}`}>
              <span className="ck-dot" style={{ background: p.color }} />
              <span className="ck-pname">{p.name}</span>
              <span className="ck-pscore">{p.score} Puan</span>
              <span className="ck-pmeeple">{'👤'.repeat(p.meeplesAvailable) || '—'}</span>
            </div>
          ))}
        </div>
        <div className="ck-muted ck-help">
          Kenarlar birebir eşleşmeli. Yol/kale kapanınca işçin geri döner; mabet 8 komşuyla tamamlanır (9 puan).
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------

const CSS = `
.ck-root{display:flex;width:100%;height:100%;min-height:100vh;background:#141b0f;color:#f0ead8;font-family:system-ui,sans-serif;}
.ck-board{position:relative;flex:1;overflow:hidden;background:radial-gradient(ellipse at 50% 40%, #2c3a20 0%, #1a2313 70%, #10160b 100%);}
.ck-hud{width:240px;flex:none;display:flex;flex-direction:column;gap:10px;padding:14px;background:#00000059;border-left:1px solid #ffffff1c;backdrop-filter:blur(6px);}
.ck-hud-title{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:15px;}
.ck-turn{border:1.5px solid #ffffff33;border-radius:10px;padding:8px 10px;font-size:14px;display:flex;flex-direction:column;gap:2px;}
.ck-phase{font-size:12px;opacity:.75;}
.ck-preview{background:#ffffff0d;border:1px dashed #ffffff2e;border-radius:12px;display:flex;align-items:center;justify-content:center;min-height:140px;}
.ck-preview-label{font-size:12px;opacity:.7;margin-bottom:-4px;}
.ck-btn{background:#3e5c2b;color:#fff;border:1px solid #587a3f;border-radius:9px;padding:9px 12px;font-size:14px;cursor:pointer;width:100%;}
.ck-btn:hover:not(:disabled){background:#4c7034;}
.ck-btn:disabled{opacity:.4;cursor:default;}
.ck-btn-ghost{background:transparent;}
.ck-btn-mini{width:auto;padding:2px 8px;font-size:12px;}
.ck-bag{font-size:14px;text-align:center;}
.ck-players{display:flex;flex-direction:column;gap:6px;margin-top:4px;}
.ck-player{display:grid;grid-template-columns:14px 1fr auto;align-items:center;gap:6px;padding:5px 8px;border-radius:8px;background:#ffffff0a;font-size:13px;}
.ck-player.ck-active{background:#ffe97a1f;outline:1px solid #ffe97a55;}
.ck-dot{width:12px;height:12px;border-radius:50%;display:inline-block;border:1.5px solid #ffffff66;}
.ck-pscore{font-variant-numeric:tabular-nums;}
.ck-pmeeple{grid-column:2/4;font-size:11px;letter-spacing:1px;opacity:.9;}
.ck-muted{opacity:.65;font-size:12px;}
.ck-center{padding:30px;}
.ck-pulse{animation:ckpulse 1.2s ease-in-out infinite;}
@keyframes ckpulse{0%,100%{fill-opacity:.35;stroke-opacity:.9;}50%{fill-opacity:.08;stroke-opacity:.35;}}
.ck-toasts{position:absolute;top:12px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;z-index:5;}
.ck-toast{background:#1d2a12e6;border:1px solid #ffe97a66;color:#ffe9a8;padding:9px 16px;border-radius:999px;font-size:14px;box-shadow:0 4px 18px #00000088;animation:ckin .3s ease;}
@keyframes ckin{from{transform:translateY(-8px);opacity:0;}to{transform:none;opacity:1;}}
.ck-popover{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;gap:8px;align-items:center;background:#10170bf2;border:1px solid #ffffff2e;border-radius:14px;padding:10px 14px;box-shadow:0 8px 30px #000000aa;z-index:6;}
.ck-popover-title{font-size:13px;opacity:.8;margin-right:4px;}
.ck-chip{background:#3e5c2b;color:#fff;border:1px solid #587a3f;border-radius:10px;padding:8px 12px;font-size:13px;cursor:pointer;white-space:nowrap;}
.ck-chip:hover{background:#4c7034;}
.ck-chip-pass{background:transparent;border-color:#ffffff33;opacity:.85;}
.ck-gameover{position:absolute;inset:0;background:#000000a8;display:flex;align-items:center;justify-content:center;z-index:10;}
.ck-gameover-card{background:#1c2514;border:1px solid #ffe97a55;border-radius:16px;padding:24px 28px;min-width:300px;display:flex;flex-direction:column;gap:10px;box-shadow:0 12px 44px #000000cc;}
.ck-rank{display:flex;align-items:center;gap:10px;font-size:15px;}
.ck-score{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700;}
.ck-row{display:flex;gap:8px;margin-top:6px;}
@media (max-width:640px){.ck-root{flex-direction:column;}.ck-hud{width:100%;flex-direction:row;flex-wrap:wrap;}.ck-preview{min-height:96px;}}
`;

export default CarcassonneGameView;
