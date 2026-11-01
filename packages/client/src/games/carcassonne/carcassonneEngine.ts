/**
 * Tile Kingdoms — Carcassonne tarzı karo yerleştirme & işçi (meeple) motoru.
 * Saf TypeScript: DOM yok, React yok, deterministik rng destekli.
 *
 * Kurallar (R3 sözleşmesi):
 *  - 72 karalık torba (24 tip, packs/tile-kingdoms/tiles/tiles.json ile birebir).
 *  - (0,0)'da başkent karosu sabit; torbada 71 karo kalır.
 *  - Kenar tipleri: road | city | field | shrine. Eşleşme: komşu kenarlar BİREBİR eşit olmalı.
 *  - Rotasyon saat yönünde: 0° [N,E,S,W] -> 90° [W,N,E,S].
 *  - Yol ağı iki uçtan kapandığında (komşusuz açık kenar kalmadığında / döngüde) puanlanır: karosayı × 1.
 *  - Kale tüm şehir kenarları çevrelendiğinde kapanır: karosayı × 2 + arma(pennant) × 2.
 *  - Mabet: etrafındaki 8 hücre dolunca 9 puan.
 *  - Puanlanan yapıdaki işçiler sahibinin eline döner.
 *  - Torba bitince açık yapılar ve çiftçiler skorlanır, oyun biter.
 */

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export type EdgeType = 'road' | 'city' | 'field' | 'shrine';
export type Feature = 'road' | 'city' | 'field' | 'shrine';
export type Rotation = 0 | 90 | 180 | 270;
export type Phase = 'DRAW' | 'PLACE_TILE' | 'PLACE_MEEPLE' | 'SCORE' | 'GAME_OVER';

export interface TileEdges {
  north: EdgeType;
  east: EdgeType;
  south: EdgeType;
  west: EdgeType;
}

export interface TileDef {
  id: string;
  edges: TileEdges;
  centre: 'city' | 'road' | 'field' | 'shrine' | 'none';
  pennants?: number;
  fortress?: boolean;
  start?: boolean;
}

export interface PlacedTile {
  tileId: string; // instance id, ör. "road-bend#3"
  typeId: string;
  def: TileDef;
  rotation: Rotation;
  x: number;
  y: number;
  key: string; // `${x},${y}`
}

export interface Player {
  id: string;
  name: string;
  color: string;
  score: number;
  meeplesAvailable: number;
}

export interface PlacedMeeple {
  tileKey: string;
  feature: Feature;
  ownerId: string;
}

export interface CurrentTile {
  instanceId: string;
  def: TileDef;
  rotation: Rotation;
}

export interface PlacementCell {
  x: number;
  y: number;
  key: string;
}

export interface CompletionEvent {
  kind: 'road' | 'city' | 'shrine' | 'farm';
  final?: boolean;
  label: string;
  tileKeys: string[];
  points: number;
  winners: string[];
  returnedOwners: string[];
  message: string;
}

export interface DrawResult {
  drawn: CurrentTile | null;
  discarded: string[];
  gameOver: boolean;
}

export interface EngineOptions {
  players?: Array<{ name: string; color?: string }>;
  seed?: number;
  rng?: () => number;
  /** Test/hata ayıklama: torbayı tip ID listesiyle hazır kur (ör. ['city-gate','open-field']). */
  bag?: string[];
  meepleCount?: number;
}

// ---------------------------------------------------------------------------
// Karo tanımları — packs/tile-kingdoms/tiles/tiles.json ile birebir (24 tip / 72 karo)
// ---------------------------------------------------------------------------

const T = (
  id: string,
  n: EdgeType,
  e: EdgeType,
  s: EdgeType,
  w: EdgeType,
  centre: TileDef['centre'],
  extra: Partial<TileDef> = {},
): TileDef => ({ id, edges: { north: n, east: e, south: s, west: w }, centre, ...extra });

export const TILE_TYPES: readonly TileDef[] = [
  T('start-capital', 'city', 'field', 'city', 'field', 'city', { pennants: 1, start: true }),
  T('city-gate', 'city', 'field', 'field', 'field', 'city', { pennants: 1 }),
  T('city-corner-keep', 'city', 'city', 'field', 'field', 'city', { pennants: 1 }),
  T('city-wall-straight', 'city', 'field', 'city', 'field', 'city'),
  T('city-corner-field', 'city', 'city', 'field', 'field', 'field'),
  T('city-fortress', 'city', 'city', 'city', 'field', 'city', { pennants: 2, fortress: true }),
  T('city-crossroad', 'city', 'road', 'field', 'field', 'none'),
  T('city-farm', 'city', 'field', 'field', 'field', 'field'),
  T('road-outpost', 'road', 'field', 'field', 'field', 'road'),
  T('road-straight', 'road', 'field', 'road', 'field', 'none'),
  T('road-bend', 'road', 'road', 'field', 'field', 'none'),
  T('road-crossing', 'road', 'road', 'road', 'road', 'road'),
  T('road-junction', 'road', 'road', 'road', 'field', 'road'),
  T('road-village', 'road', 'field', 'road', 'field', 'road'),
  T('road-shrine', 'road', 'field', 'field', 'field', 'shrine'),
  T('shrine-field', 'field', 'field', 'field', 'field', 'shrine'),
  T('shrine-crossroad', 'shrine', 'field', 'field', 'road', 'shrine'),
  T('shrine-border', 'shrine', 'field', 'field', 'field', 'shrine'),
  T('shrine-corner', 'shrine', 'shrine', 'field', 'field', 'none'),
  T('shrine-wall', 'shrine', 'field', 'shrine', 'field', 'shrine'),
  T('open-field', 'field', 'field', 'field', 'field', 'none'),
  T('field-farm', 'field', 'field', 'field', 'field', 'field'),
  T('field-pasture', 'field', 'field', 'field', 'field', 'field'),
  T('city-sprawltown', 'city', 'field', 'field', 'road', 'city'),
] as const;

/** typeId -> def */
export const TILE_BY_ID: ReadonlyMap<string, TileDef> = new Map(TILE_TYPES.map((d) => [d.id, d]));

/** Tam torba instance listesi: her tipten count adet (başkent dahil 72). */
export function buildFullBag(): string[] {
  const bag: string[] = [];
  for (const def of TILE_TYPES) {
    const count = def.id === 'start-capital' ? 1 : PACK_COUNTS[def.id] ?? 1;
    for (let i = 0; i < count; i += 1) bag.push(`${def.id}#${i}`);
  }
  return bag;
}

const PACK_COUNTS: Record<string, number> = {
  'start-capital': 1,
  'city-gate': 4,
  'city-corner-keep': 5,
  'city-wall-straight': 3,
  'city-corner-field': 3,
  'city-fortress': 2,
  'city-crossroad': 2,
  'city-farm': 2,
  'road-outpost': 2,
  'road-straight': 7,
  'road-bend': 7,
  'road-crossing': 1,
  'road-junction': 2,
  'road-village': 2,
  'road-shrine': 2,
  'shrine-field': 4,
  'shrine-crossroad': 2,
  'shrine-border': 2,
  'shrine-corner': 1,
  'shrine-wall': 1,
  'open-field': 7,
  'field-farm': 5,
  'field-pasture': 3,
  'city-sprawltown': 2,
};

export const TOTAL_TILES = 72;

// ---------------------------------------------------------------------------
// Geometri & rotasyon yardımcıları
// ---------------------------------------------------------------------------

export const DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
export type DirIndex = 0 | 1 | 2 | 3;

/** Birim vektörler: kuzey -y (ekran yukarı), doğu +x, güney +y, batı -x. */
export const DIR_DELTA: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // north
  [1, 0], // east
  [0, 1], // south
  [-1, 0], // west
];

export function oppositeIndex(d: number): DirIndex {
  return ((d + 2) % 4) as DirIndex;
}

/** Rotasyon uygulanmış kenarlar. 0° [N,E,S,W] -> 90° [W,N,E,S] (saat yönü). */
export function rotateEdges(edges: TileEdges, rotation: Rotation): TileEdges {
  const arr = [edges.north, edges.east, edges.south, edges.west];
  const steps = (rotation / 90) | 0;
  const out: EdgeType[] = [];
  for (let i = 0; i < 4; i += 1) {
    out.push(arr[(i - steps + 8) % 4] as EdgeType);
  }
  return { north: out[0] as EdgeType, east: out[1] as EdgeType, south: out[2] as EdgeType, west: out[3] as EdgeType };
}

export function edgesAt(placed: { def: TileDef; rotation: Rotation }): TileEdges {
  return rotateEdges(placed.def.edges, placed.rotation);
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

/** Karo bir mabet mi? (kutsal kenar taşıyan her karo bir mabet/şiir bölgesidir) */
export function isShrineTile(def: TileDef): boolean {
  if (def.centre === 'shrine') return true;
  return DIRECTIONS.some((d) => def.edges[d] === 'shrine');
}

/** Bu karoda bulunabilen işçi özellikleri. */
export function featuresOnTile(def: TileDef): Feature[] {
  const out: Feature[] = [];
  if (DIRECTIONS.some((d) => def.edges[d] === 'city')) out.push('city');
  if (DIRECTIONS.some((d) => def.edges[d] === 'road')) out.push('road');
  if (isShrineTile(def)) out.push('shrine');
  if (DIRECTIONS.some((d) => def.edges[d] === 'field')) out.push('field');
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function labelForDirection(cx: number, cy: number, kind: 'road' | 'city' | 'shrine'): string {
  const names = kind === 'city' ? 'Kalesi' : kind === 'road' ? 'Yolu' : 'Mabedi';
  if (Math.abs(cx) < 0.01 && Math.abs(cy) < 0.01) return `Merkez ${names}`;
  const horizontal = Math.abs(cx) >= Math.abs(cy);
  const primary = horizontal ? (cx > 0 ? 'Doğu' : 'Batı') : cy > 0 ? 'Güney' : 'Kuzey';
  const secondary = !horizontal ? (cx > 0.5 ? 'doğu' : cx < -0.5 ? 'batı' : '') : cy > 0.5 ? 'güney' : cy < -0.5 ? 'kuzey' : '';
  const dir = secondary ? `${primary}-${secondary}` : primary;
  return `${dir} ${names}`;
}

const DEFAULT_COLORS = ['#B3402A', '#2E7D9E', '#5E7D3A', '#7A4A6B', '#C9A667'];

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

export class CarcassonneEngine {
  readonly players: Player[];
  readonly meepleCount: number;
  boardGrid: Map<string, PlacedTile> = new Map();
  tileBag: string[] = [];
  placedMeeples: PlacedMeeple[] = [];
  currentTile: CurrentTile | null = null;
  activePlayerIndex = 0;
  phase: Phase = 'DRAW';
  /** Tamamlanıp skorlanmış mabetler (çift skor koruması). */
  scoredShrines: Set<string> = new Set();
  /** Kapanmış kalelere ait karo anahtarları (çiftçi skoru için). */
  completedCityTiles: Set<string> = new Set();
  /** Kapanmış kaleler: her biri {tileKeys, pennants} — çiftçi skoru şehir sayısı için. */
  completedCities: Array<{ tileKeys: string[]; pennants: number }> = [];
  /** Kutlama bildirimi geçmişi (UI son elemanları gösterir). */
  events: CompletionEvent[] = [];
  winners: string[] = [];
  private readonly rng: () => number;

  constructor(options: EngineOptions = {}) {
    this.rng = options.rng ?? mulberry32(options.seed ?? 20261101);
    this.meepleCount = options.meepleCount ?? 7;
    const playerDefs = options.players?.length
      ? options.players
      : [
          { name: 'Ahmet', color: DEFAULT_COLORS[0] },
          { name: 'Elif', color: DEFAULT_COLORS[1] },
        ];
    this.players = playerDefs.slice(0, 5).map((p, i) => ({
      id: `p${i + 1}`,
      name: p.name,
      color: p.color ?? (DEFAULT_COLORS[i] as string),
      score: 0,
      meeplesAvailable: this.meepleCount,
    }));

    // Başlangıç karosu (0,0)
    const start = TILE_BY_ID.get('start-capital');
    if (!start) throw new Error('start-capital tanımı bulunamadı');
    this.boardGrid.set(cellKey(0, 0), {
      tileId: 'start-capital#0',
      typeId: 'start-capital',
      def: start,
      rotation: 0,
      x: 0,
      y: 0,
      key: cellKey(0, 0),
    });

    // Torba: 72 karo, başkent hariç 71, karıştırılmış
    const full = buildFullBag().filter((id) => !id.startsWith('start-capital'));
    if (options.bag) {
      this.tileBag = [...options.bag];
    } else {
      this.tileBag = full;
      this.shuffle(this.tileBag);
    }
  }

  private shuffle(list: string[]): void {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = list[i] as string;
      list[i] = list[j] as string;
      list[j] = tmp;
    }
  }

  get activePlayer(): Player {
    return this.players[this.activePlayerIndex] as Player;
  }

  // ---- Torbadan çekme ------------------------------------------------------

  /** Torbadan karo çeker. Hiçbir rotasyonla hiçbir yere oturmayan karolar otomatik atılır. */
  drawTile(): DrawResult {
    if (this.phase === 'GAME_OVER') return { drawn: null, discarded: [], gameOver: true };
    if (this.phase !== 'DRAW') throw new Error(`DRAW fazında değilken karo çekilemez (faz: ${this.phase})`);
    const discarded: string[] = [];
    for (;;) {
      const instanceId = this.tileBag.shift();
      if (instanceId === undefined) {
        this.currentTile = null;
        this.finishGame();
        return { drawn: null, discarded, gameOver: true };
      }
      const typeId = instanceId.split('#')[0] as string;
      const def = TILE_BY_ID.get(typeId);
      if (!def) throw new Error(`Bilinmeyen karo tipi: ${typeId}`);
      const candidate: CurrentTile = { instanceId, def, rotation: 0 };
      if (this.hasAnyValidPlacement(candidate.def)) {
        this.currentTile = candidate;
        this.phase = 'PLACE_TILE';
        return { drawn: candidate, discarded, gameOver: false };
      }
      discarded.push(instanceId); // hiçbir yere oturmadı → torbadan çıkar
    }
  }

  /** Aktif karoyu 90° saat yönünde çevirir. */
  rotateCurrent(): void {
    if (!this.currentTile || this.phase !== 'PLACE_TILE') return;
    this.currentTile.rotation = nextRotation(this.currentTile.rotation);
  }

  // ---- Yerleşim -------------------------------------------------------------

  /** Komşu kenar eşleşmesi + en az bir komşu şartı. */
  canPlaceAt(def: TileDef, rotation: Rotation, x: number, y: number): boolean {
    const key = cellKey(x, y);
    if (this.boardGrid.has(key)) return false;
    const edges = rotateEdges(def.edges, rotation);
    let neighbors = 0;
    for (let d = 0; d < 4; d += 1) {
      const [dx, dy] = DIR_DELTA[d] as readonly [number, number];
      const nb = this.boardGrid.get(cellKey(x + dx, y + dy));
      if (!nb) continue;
      neighbors += 1;
      const nbEdge = edgesAt(nb)[DIRECTIONS[oppositeIndex(d)]];
      if (nbEdge !== edges[DIRECTIONS[d] as keyof TileEdges]) return false;
    }
    return neighbors >= 1;
  }

  getValidPlacements(def?: TileDef, rotation?: Rotation): PlacementCell[] {
    const tileDef = def ?? this.currentTile?.def;
    if (!tileDef) return [];
    const rot: Rotation =
      rotation ?? (this.currentTile && (def === undefined || def === this.currentTile.def) ? this.currentTile.rotation : 0);
    const cells = new Map<string, PlacementCell>();
    for (const t of this.boardGrid.values()) {
      for (let d = 0; d < 4; d += 1) {
        const [dx, dy] = DIR_DELTA[d] as readonly [number, number];
        const nx = t.x + dx;
        const ny = t.y + dy;
        const key = cellKey(nx, ny);
        if (cells.has(key) || this.boardGrid.has(key)) continue;
        if (this.canPlaceAt(tileDef, rot, nx, ny)) cells.set(key, { x: nx, y: ny, key });
      }
    }
    return [...cells.values()];
  }

  /** Karo herhangi bir rotasyonla herhangi bir yere oturuyor mu? */
  hasAnyValidPlacement(def: TileDef): boolean {
    for (const rot of [0, 90, 180, 270] as Rotation[]) {
      if (this.getValidPlacements(def, rot).length > 0) return true;
    }
    return false;
  }

  /** Aktif karoyu yerleştirir. Başarıda gerekirse PLACE_MEEPLE fazına geçer. */
  placeTile(x: number, y: number): boolean {
    if (this.phase !== 'PLACE_TILE' || !this.currentTile) return false;
    const { def, rotation, instanceId } = this.currentTile;
    if (!this.canPlaceAt(def, rotation, x, y)) return false;
    const key = cellKey(x, y);
    this.boardGrid.set(key, { tileId: instanceId, typeId: def.id, def, rotation, x, y, key });
    this.currentTile = null;
    this.pendingMeepleKey = key;
    const options = this.getMeepleOptions(key);
    if (this.activePlayer.meeplesAvailable > 0 && options.length > 0) {
      this.phase = 'PLACE_MEEPLE';
    } else {
      this.endTurn();
    }
    return true;
  }

  // ---- İşçi (meeple) --------------------------------------------------------

  /** Yerleştirilen karoda işçi koyulabilecek, çakışmasız özellikler. */
  getMeepleOptions(placedKey?: string): Feature[] {
    const key = placedKey ?? this.pendingMeepleKey;
    const tile = key ? this.boardGrid.get(key) : undefined;
    if (!tile) return [];
    return featuresOnTile(tile.def).filter((f) => this.canPlaceMeeple(f, tile));
  }

  private pendingMeepleKey?: string;

  /** Verili özellik ağı bu karo için işçi almaya uygun mu? (ağda başka işçi yoksa) */
  canPlaceMeeple(feature: Feature, tile: PlacedTile): boolean {
    if (feature === 'shrine') {
      if (!isShrineTile(tile.def)) return false;
      return !this.placedMeeples.some((m) => m.tileKey === tile.key && m.feature === 'shrine');
    }
    const comp = this.componentOf(tile, feature);
    return !this.placedMeeples.some((m) => m.feature === feature && comp.has(m.tileKey));
  }

  placeMeeple(feature: Feature): boolean {
    if (this.phase !== 'PLACE_MEEPLE') return false;
    const tile = this.pendingMeepleKey ? this.boardGrid.get(this.pendingMeepleKey) : undefined;
    if (!tile) return false;
    if (this.activePlayer.meeplesAvailable <= 0) return false;
    if (!this.canPlaceMeeple(feature, tile)) return false;
    this.placedMeeples.push({ tileKey: tile.key, feature, ownerId: this.activePlayer.id });
    this.activePlayer.meeplesAvailable -= 1;
    this.endTurn();
    return true;
  }

  /** İşçi koymadan turu bitirir. */
  passMeeple(): void {
    if (this.phase !== 'PLACE_MEEPLE') return;
    this.endTurn();
  }

  // ---- Tur sonu & puanlama ---------------------------------------------------

  private endTurn(): void {
    this.phase = 'SCORE';
    this.evaluateCompletions(); // pendingMeepleKey'i temizler
    if (this.tileBag.length === 0 && !this.currentTile) {
      this.finishGame();
      return;
    }
    this.activePlayerIndex = (this.activePlayerIndex + 1) % this.players.length;
    this.phase = 'DRAW';
  }

  /** Son yerleştirilen karonun tetiklediği tamamlanmaları puanlar. */
  evaluateCompletions(triggerKey?: string): CompletionEvent[] {
    const trigger = triggerKey ?? this.pendingMeepleKey ?? this.findLatestTile();
    this.pendingMeepleKey = undefined;
    if (!trigger) return [];
    const tile = this.boardGrid.get(trigger);
    if (!tile) return [];
    const produced: CompletionEvent[] = [];
    produced.push(...this.checkFeatureCompletion(tile, 'road'));
    produced.push(...this.checkFeatureCompletion(tile, 'city'));
    for (const ev of produced) this.applyCompletion(ev);
    produced.push(...this.checkShrineCompletions(tile));
    this.events.push(...produced);
    return produced;
  }

  private findLatestTile(): string | undefined {
    // placeTile sonrası pendingMeepleKey ayarlanmadıysa (pas geçildi) son eklenen karo:
    // Map insertion order korunur → en son eklenen.
    let last: string | undefined;
    for (const k of this.boardGrid.keys()) last = k;
    return last;
  }

  /** Verili özellik ağı kapandıysa puan olayı üretir. */
  private checkFeatureCompletion(tile: PlacedTile, feature: 'road' | 'city'): CompletionEvent[] {
    const comp = this.componentOf(tile, feature);
    if (comp.size === 0) return [];
    // Kapanma: ağdaki her özellik kenarının karşısında bir karo olmalı.
    // Birebir kenar eşleşmesi sayesinde açık kenar yoksa ağ dışa sızamaz (döngüler de kapanır).
    for (const key of comp) {
      const t = this.boardGrid.get(key);
      if (!t) continue;
      const edges = edgesAt(t);
      for (let d = 0; d < 4; d += 1) {
        if (edges[DIRECTIONS[d] as keyof TileEdges] !== feature) continue;
        const [dx, dy] = DIR_DELTA[d] as readonly [number, number];
        if (!this.boardGrid.has(cellKey(t.x + dx, t.y + dy))) return [];
      }
    }
    return [this.buildCompletionEvent(feature, comp)];
  }

  private buildCompletionEvent(feature: 'road' | 'city', comp: Set<string>): CompletionEvent {
    const tiles = [...comp];
    let pennants = 0;
    let sx = 0;
    let sy = 0;
    for (const key of tiles) {
      const t = this.boardGrid.get(key);
      if (!t) continue;
      sx += t.x;
      sy += t.y;
      if (feature === 'city' && t.def.centre === 'city') pennants += t.def.pennants ?? 0;
    }
    const points = feature === 'city' ? tiles.length * 2 + pennants * 2 : tiles.length;
    const label = labelForDirection(sx / tiles.length, sy / tiles.length, feature);
    const { winners, returned } = this.majorityOwners(tiles, feature);
    const kindName = feature === 'city' ? '🏰' : '🛤️';
    const names = winners.map((id) => this.players.find((p) => p.id === id)?.name ?? id).join(', ');
    const message = winners.length
      ? `${kindName} ${label} tamamlandı! ${names} +${points} puan kazandı, işçiler geri döndü!`
      : `${kindName} ${label} tamamlandı ama sahibi yok.`;
    return { kind: feature, label, tileKeys: tiles, points, winners, returnedOwners: returned, message };
  }

  /**tileKeys ve özellik üzerinde en çok işçisi olan oyuncular (beraberlikte hepsi). */
  private majorityOwners(tileKeys: string[], feature: Feature): { winners: string[]; returned: string[] } {
    const counts = new Map<string, number>();
    const returned = new Set<string>();
    for (const m of this.placedMeeples) {
      if (m.feature === feature && tileKeys.includes(m.tileKey)) {
        counts.set(m.ownerId, (counts.get(m.ownerId) ?? 0) + 1);
        returned.add(m.ownerId);
      }
    }
    let best = 0;
    for (const n of counts.values()) best = Math.max(best, n);
    const winners = best > 0 ? [...counts.entries()].filter(([, n]) => n === best).map(([id]) => id) : [];
    return { winners, returned: [...returned] };
  }

  private applyCompletion(ev: CompletionEvent): void {
    for (const id of ev.winners) {
      const p = this.players.find((pp) => pp.id === id);
      if (p) p.score += ev.points;
    }
    // İşçileri geri al
    this.placedMeeples = this.placedMeeples.filter((m) => {
      const keep = !(ev.returnedOwners.includes(m.ownerId) && ev.tileKeys.includes(m.tileKey) && m.feature === ev.kind);
      if (!keep) {
        const p = this.players.find((pp) => pp.id === m.ownerId);
        if (p) p.meeplesAvailable += 1;
      }
      return keep;
    });
    if (ev.kind === 'city') {
      this.completedCityTiles = new Set([...this.completedCityTiles, ...ev.tileKeys]);
      this.completedCities.push({ tileKeys: [...ev.tileKeys], pennants: 0 });
    }
  }

  // ---- Mabetler ---------------------------------------------------------------

  private checkShrineCompletions(near: PlacedTile): CompletionEvent[] {
    const out: CompletionEvent[] = [];
    // Yeni karo ancak kendisi mabet olan ya da mabet komşusu olan mabetleri tamamlayabilir.
    const candidates = new Set<string>([near.key]);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) candidates.add(cellKey(near.x + dx, near.y + dy));
    }
    for (const key of candidates) {
      if (this.scoredShrines.has(key)) continue;
      const t = this.boardGrid.get(key);
      if (!t || !isShrineTile(t.def)) continue;
      let filled = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (dx === 0 && dy === 0) continue;
          if (this.boardGrid.has(cellKey(t.x + dx, t.y + dy))) filled += 1;
        }
      }
      if (filled < 8) continue;
      this.scoredShrines.add(key);
      const meeples = this.placedMeeples.filter((m) => m.tileKey === key && m.feature === 'shrine');
      const owners = [...new Set(meeples.map((m) => m.ownerId))];
      const names = owners.map((id) => this.players.find((p) => p.id === id)?.name ?? id).join(', ');
      const label = labelForDirection(t.x, t.y, 'shrine');
      out.push({
        kind: 'shrine',
        label,
        tileKeys: [key],
        points: 9,
        winners: owners,
        returnedOwners: owners,
        message: owners.length
          ? `⛪ ${label} tamamlandı! ${names} +9 puan kazandı, keşiş geri döndü!`
          : `⛪ ${label} tamamlandı ama keşiş yoktu.`,
      });
      this.applyCompletion(out[out.length - 1] as CompletionEvent);
    }
    return out;
  }

  // ---- Bileşenler --------------------------------------------------------------

  /** Karodan başlayan yol/kale/çayır ağının bağlı bileşeni (karo anahtarları). */
  componentOf(start: PlacedTile, feature: Feature): Set<string> {
    const seen = new Set<string>();
    if (!DIRECTIONS.some((d) => edgesAt(start)[d] === feature)) return seen;
    const queue: PlacedTile[] = [start];
    seen.add(start.key);
    while (queue.length) {
      const t = queue.pop() as PlacedTile;
      const edges = edgesAt(t);
      for (let d = 0; d < 4; d += 1) {
        if (edges[DIRECTIONS[d] as keyof TileEdges] !== feature) continue;
        const [dx, dy] = DIR_DELTA[d] as readonly [number, number];
        const nb = this.boardGrid.get(cellKey(t.x + dx, t.y + dy));
        if (!nb || seen.has(nb.key)) continue;
        const nbEdges = edgesAt(nb);
        if (nbEdges[DIRECTIONS[oppositeIndex(d)]] !== feature) continue;
        if (!DIRECTIONS.some((dd) => nbEdges[dd] === feature)) continue;
        seen.add(nb.key);
        queue.push(nb);
      }
    }
    return seen;
  }

  // ---- Oyun sonu ---------------------------------------------------------------

  private finishGame(): void {
    if (this.phase === 'GAME_OVER') return;
    this.phase = 'SCORE';
    this.currentTile = null;

    // Eksik yapıları bul: işçisi olan bileşenler üzerinden.
    const scoredComponents = new Set<string>();
    for (const m of [...this.placedMeeples]) {
      const tile = this.boardGrid.get(m.tileKey);
      if (!tile) continue;
      if (m.feature === 'shrine') {
        const compKey = `shrine:${m.tileKey}`;
        if (scoredComponents.has(compKey) || this.scoredShrines.has(m.tileKey)) continue;
        scoredComponents.add(compKey);
        const owner = this.players.find((p) => p.id === m.ownerId);
        if (owner) {
          owner.score += 1;
          this.events.push({
            kind: 'shrine',
            final: true,
            label: `${labelForDirection(tile.x, tile.y, 'shrine')} (eksik)`,
            tileKeys: [m.tileKey],
            points: 1,
            winners: [owner.id],
            returnedOwners: [owner.id],
            message: `⛪ Eksik mabet: ${owner.name} +1 puan`,
          });
        }
        continue;
      }
      if (m.feature === 'field') continue; // çiftçiler aşağıda
      const comp = this.componentOf(tile, m.feature);
      const compKey = `${m.feature}:${[...comp].sort().join('|')}`;
      if (scoredComponents.has(compKey)) continue;
      scoredComponents.add(compKey);
      const tiles = [...comp];
      let pennants = 0;
      for (const key of tiles) {
        const t = this.boardGrid.get(key);
        if (m.feature === 'city' && t?.def.centre === 'city') pennants += t.def.pennants ?? 0;
      }
      const points = m.feature === 'city' ? tiles.length + pennants : tiles.length;
      const { winners } = this.majorityOwners(tiles, m.feature);
      for (const id of winners) {
        const p = this.players.find((pp) => pp.id === id);
        if (p) p.score += points;
      }
      const label = m.feature === 'city' ? 'Eksik kale' : 'Eksik yol';
      const names = winners.map((id) => this.players.find((p) => p.id === id)?.name ?? id).join(', ');
      this.events.push({
        kind: m.feature,
        final: true,
        label,
        tileKeys: tiles,
        points,
        winners,
        returnedOwners: winners,
        message: `${label} sayıldı: ${names || '—'} +${points} puan`,
      });
    }

    // Çiftçiler: bölgesine komşu her kapanmış kale 3 puan (bölge başına bir kez).
    const scoredRegions = new Set<string>();
    for (const m of [...this.placedMeeples]) {
      if (m.feature !== 'field') continue;
      const tile = this.boardGrid.get(m.tileKey);
      if (!tile) continue;
      const region = this.componentOf(tile, 'field');
      const regionKey = [...region].sort().join('|');
      const regionOwnerKey = `${m.ownerId}:${regionKey}`;
      if (scoredRegions.has(regionOwnerKey)) continue;
      scoredRegions.add(regionOwnerKey);
      const adjacentCities = new Set<number>();
      for (const key of region) {
        const t = this.boardGrid.get(key);
        if (!t) continue;
        for (let d = 0; d < 4; d += 1) {
          const [dx, dy] = DIR_DELTA[d] as readonly [number, number];
          const nbKey = cellKey(t.x + dx, t.y + dy);
          if (!this.completedCityTiles.has(nbKey)) continue;
          const idx = this.completedCities.findIndex((c) => c.tileKeys.includes(nbKey));
          if (idx >= 0) adjacentCities.add(idx);
        }
      }
      const points = adjacentCities.size * 3;
      if (points > 0) {
        const owner = this.players.find((p) => p.id === m.ownerId);
        if (owner) {
          owner.score += points;
          this.events.push({
            kind: 'farm',
            final: true,
            label: 'Çiftlik bölgesi',
            tileKeys: [...region],
            points,
            winners: [owner.id],
            returnedOwners: [owner.id],
            message: `🌾 ${owner.name}: ${adjacentCities.size} kale × 3 = +${points} puan`,
          });
        }
      }
    }

    const best = Math.max(...this.players.map((p) => p.score));
    this.winners = this.players.filter((p) => p.score === best).map((p) => p.id);
    this.phase = 'GAME_OVER';
  }

  /** Zafer sıralaması (puan azalan). */
  ranking(): Player[] {
    return [...this.players].sort((a, b) => b.score - a.score);
  }

  /** UI için: UI'nin meeple baloncuğunu bağladığı karo (PLACE_MEEPLE fazında). */
  pendingKey(): string | undefined {
    return this.phase === 'PLACE_MEEPLE' ? this.pendingMeepleKey : undefined;
  }
}
