/**
 * Carcassonne (Tile Kingdoms) motor testleri — R3 kabul kriterleri.
 * 30 test: rotasyon, kenar eşleşme, torba, işçi kuralları, kapanış/puanlama, oyun sonu.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CarcassonneEngine,
  TILE_BY_ID,
  TILE_TYPES,
  TOTAL_TILES,
  buildFullBag,
  cellKey,
  edgesAt,
  featuresOnTile,
  isShrineTile,
  nextRotation,
  oppositeIndex,
  rotateEdges,
  type Feature,
  type DrawResult,
  type TileEdges,
} from './carcassonneEngine.js';

// --- yardımcılar -------------------------------------------------------------

function mk(bag: string[], players = 2): CarcassonneEngine {
  return new CarcassonneEngine({
    bag,
    players: Array.from({ length: players }, (_, i) => ({ name: `Oyuncu ${i + 1}` })),
  });
}

/** Bir tur oynar: çek → döndür → yerleştir → (isteğe bağlı) işçi koy / pas. */
function playTurn(e: CarcassonneEngine, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0, meeple?: Feature): DrawResult {
  const res = e.drawTile();
  for (let i = 0; i < rotation / 90; i += 1) e.rotateCurrent();
  expect(e.placeTile(x, y)).toBe(true);
  if (e.phase === 'PLACE_MEEPLE') {
    if (meeple) expect(e.placeMeeple(meeple)).toBe(true);
    else e.passMeeple();
  }
  return res;
}

const PAD = ['open-field#90', 'open-field#91', 'open-field#92', 'open-field#93', 'open-field#94', 'open-field#95'];

// --- 1) Rotasyon & kenar kayması ---------------------------------------------

describe('rotasyon — kenarlar saat yönünde kayar', () => {
  it('0° kimlik dönüşümü', () => {
    const def = TILE_BY_ID.get('city-crossroad')!;
    expect(rotateEdges(def.edges, 0)).toEqual(def.edges);
  });

  it('90°: [N,E,S,W] -> [W,N,E,S]', () => {
    const def = TILE_BY_ID.get('city-crossroad')!; // N=city E=road S=field W=field
    const r = rotateEdges(def.edges, 90);
    expect(r).toEqual<TileEdges>({ north: 'field', east: 'city', south: 'road', west: 'field' });
  });

  it('180° ve 270° kaymaları', () => {
    const def = TILE_BY_ID.get('city-crossroad')!;
    expect(rotateEdges(def.edges, 180)).toEqual<TileEdges>({ north: 'field', east: 'field', south: 'city', west: 'road' });
    expect(rotateEdges(def.edges, 270)).toEqual<TileEdges>({ north: 'road', east: 'field', south: 'field', west: 'city' });
  });

  it('dört 90° dönüş başa döner; rotateCurrent 0→90→180→270→0 döngüsü', () => {
    const e = mk(['city-crossroad#0', ...PAD]);
    expect(e.currentTile).toBeNull(); // henüz çekilmedi
    e.drawTile();
    const seq: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      seq.push(e.currentTile!.rotation);
      e.rotateCurrent();
    }
    expect(seq).toEqual([0, 90, 180, 270, 0]);
    expect(nextRotation(270)).toBe(0);
    expect(oppositeIndex(1)).toBe(3);
  });

  it('edgesAt yerleştirilmiş karonun rotasyonunu uygular', () => {
    const e = mk(['city-crossroad#0', ...PAD]);
    playTurn(e, 0, -1, 180);
    const placed = e.boardGrid.get(cellKey(0, -1))!;
    expect(placed.rotation).toBe(180);
    expect(edgesAt(placed).south).toBe('city'); // start-capital N=city ile eşleşen kenar
  });
});

// --- 2) Torba & başlangıç durumu ------------------------------------------------

describe('torba ve başlangıç durumu', () => {
  it('72 karoluk tam torba, 24 tip; motor torbası başkent hariç 71', () => {
    const full = buildFullBag();
    expect(full).toHaveLength(TOTAL_TILES);
    expect(TILE_TYPES).toHaveLength(24);
    const e = new CarcassonneEngine();
    expect(e.tileBag).toHaveLength(71);
    expect(e.tileBag.some((id) => id.startsWith('start-capital'))).toBe(false);
  });

  it('tip sayıları pack ile birebir (road-straight 7, city-gate 4, road-crossing 1)', () => {
    const count = (prefix: string) => buildFullBag().filter((id) => id.startsWith(`${prefix}#`)).length;
    expect(count('road-straight')).toBe(7);
    expect(count('road-bend')).toBe(7);
    expect(count('open-field')).toBe(7);
    expect(count('city-gate')).toBe(4);
    expect(count('city-fortress')).toBe(2);
    expect(count('road-crossing')).toBe(1);
    expect(TILE_BY_ID.get('city-fortress')!.pennants).toBe(2);
    expect(TILE_BY_ID.get('start-capital')!.pennants).toBe(1);
  });

  it('motor tipleri packs/tile-kingdoms/tiles/tiles.json ile senkron', () => {
    const url = new URL('../../../../../packs/tile-kingdoms/tiles/tiles.json', import.meta.url);
    const pack = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as {
      totalTiles: number;
      types: Array<{ id: string; count: number; edges: TileEdges; centre: string; pennants?: number }>;
    };
    expect(pack.totalTiles).toBe(72);
    expect(pack.types).toHaveLength(24);
    for (const t of pack.types) {
      const def = TILE_BY_ID.get(t.id);
      expect(def, `eksik tip: ${t.id}`).toBeDefined();
      expect(def!.edges).toEqual(t.edges);
      expect(def!.centre).toBe(t.centre);
      expect(def!.pennants ?? 0).toBe(t.pennants ?? 0);
    }
    expect(buildFullBag()).toHaveLength(pack.types.reduce((s, t) => s + t.count, 0));
  });

  it('başlangıç: (0,0) başkent, DRAW fazı, 7 işçi, sıfır puan', () => {
    const e = new CarcassonneEngine({ seed: 7 });
    expect(e.boardGrid.size).toBe(1);
    expect(e.boardGrid.get('0,0')!.typeId).toBe('start-capital');
    expect(e.phase).toBe('DRAW');
    expect(e.activePlayerIndex).toBe(0);
    expect(e.players[0]!.meeplesAvailable).toBe(7);
    expect(e.players.every((p) => p.score === 0)).toBe(true);
  });

  it('seed deterministik çekim sırası üretir', () => {
    const a = new CarcassonneEngine({ seed: 42 });
    const b = new CarcassonneEngine({ seed: 42 });
    const c = new CarcassonneEngine({ seed: 1337 });
    expect(a.tileBag).toEqual(b.tileBag);
    expect(a.tileBag.slice(0, 12)).not.toEqual(c.tileBag.slice(0, 12));
  });

  it('drawTile yalnızca DRAW fazında çalışır; rotateCurrent PLACE_TILE dışında sessiz', () => {
    const e = mk(['open-field#0', ...PAD]);
    e.drawTile();
    expect(e.phase).toBe('PLACE_TILE');
    expect(() => e.drawTile()).toThrow();
    const r = e.currentTile!.rotation;
    e.passMeeple.call(e); // faz dışı: no-op
    expect(e.currentTile!.rotation).toBe(r);
  });
});

// --- 3) Geçerli yerleşim ---------------------------------------------------------

describe('kenar eşleşmeli yerleşim', () => {
  it('city-gate rot0 için geçerli hücreler: (0,1),(1,0),(-1,0); rot90 yalnız (1,0)', () => {
    const e = mk(['city-gate#0', ...PAD]);
    e.drawTile();
    expect(e.getValidPlacements().map((c) => c.key).sort()).toEqual(['-1,0', '0,1', '1,0']);
    e.rotateCurrent();
    expect(e.getValidPlacements().map((c) => c.key)).toEqual(['1,0']);
  });

  it('geçersiz hücre reddedilir: (0,-1) S=field ≠ başkent N=city', () => {
    const e = mk(['city-gate#0', ...PAD]);
    e.drawTile();
    expect(e.placeTile(0, -1)).toBe(false); // gate rot0 S=field, başkent N=city
    expect(e.boardGrid.size).toBe(1);
    expect(e.phase).toBe('PLACE_TILE');
  });

  it('komşusu olmayan hücreye yerleşim yok; dolu hücre yok', () => {
    const e = mk(['open-field#0', ...PAD]);
    expect(e.canPlaceAt(TILE_BY_ID.get('open-field')!, 0, 5, 5)).toBe(false);
    expect(e.canPlaceAt(TILE_BY_ID.get('open-field')!, 0, 0, 0)).toBe(false);
  });

  it('iki komşunun da eşleşmesi şart: gate (1,1) kuzeydeki open-field ile çakışır', () => {
    const e = mk(['open-field#0', 'city-gate#0', 'city-gate#1', 'open-field#1', ...PAD]);
    playTurn(e, 1, 0); // open-field doğuya
    playTurn(e, 0, 1, 0); // gate güneye
    e.drawTile(); // ikinci gate — hedef (1,1)
    expect(e.placeTile(1, 1)).toBe(false); // N=city ≠ open-field S=field
    expect(e.getValidPlacements().some((c) => c.key === '1,1')).toBe(false);
    // open-field olsa (1,1) geçerliydi:
    const f = mk(['open-field#0', 'city-gate#0', 'open-field#1', ...PAD]);
    playTurn(f, 1, 0);
    playTurn(f, 0, 1);
    f.drawTile();
    expect(f.placeTile(1, 1)).toBe(true);
  });

  it('hiçbir yere oturmayan karo otomatik atılır, sıradaki çekilir', () => {
    const e = mk(['road-crossing#0', 'open-field#0', ...PAD]);
    const res = e.drawTile();
    expect(res.discarded).toEqual(['road-crossing#0']);
    expect(res.drawn?.def.id).toBe('open-field');
    expect(e.hasAnyValidPlacement(TILE_BY_ID.get('road-crossing')!)).toBe(false);
    expect(e.tileBag.filter((id) => id.startsWith('road-crossing'))).toHaveLength(0);
  });
});

// --- 4) İşçi (meeple) kuralları ----------------------------------------------------

describe('meeple yerleştirme', () => {
  it('karonun özellikleri: başkent [city,field], open-field [field], mabet tanımı', () => {
    expect(featuresOnTile(TILE_BY_ID.get('start-capital')!)).toEqual(['city', 'field']);
    expect(featuresOnTile(TILE_BY_ID.get('open-field')!)).toEqual(['field']);
    expect(featuresOnTile(TILE_BY_ID.get('road-shrine')!)).toEqual(['road', 'shrine', 'field']);
    expect(isShrineTile(TILE_BY_ID.get('shrine-field')!)).toBe(true);
    expect(isShrineTile(TILE_BY_ID.get('shrine-corner')!)).toBe(true); // kutsal kenar taşı
    expect(isShrineTile(TILE_BY_ID.get('road-straight')!)).toBe(false);
  });

  it('işçi koyulunca el azalır, kayda geçer; puanlama sonrası geri döner', () => {
    const e = mk(['city-gate#0', ...PAD]);
    playTurn(e, 0, 1, 0, 'city');
    expect(e.players[0]!.meeplesAvailable).toBe(6);
    expect(e.placedMeeples).toEqual([{ tileKey: '0,1', feature: 'city', ownerId: 'p1' }]);
    expect(e.phase).toBe('DRAW');
    expect(e.activePlayerIndex).toBe(1);
  });

  it('ağda işçi varsa ikinci işçi koyulamaz (yol örneği)', () => {
    const e = mk(['city-crossroad#0', 'open-field#0', 'road-straight#0', ...PAD]);
    playTurn(e, 0, -1, 180, 'road'); // crossroad: W=road ucu (-1,-1)'de açık
    playTurn(e, 1, 0); // P2 bir yere karo koyar, işçisiz
    e.drawTile(); // P1 road-straight
    for (let i = 0; i < 1; i += 1) e.rotateCurrent(); // 90°: E=road
    expect(e.placeTile(-1, -1)).toBe(true);
    expect(e.phase).toBe('PLACE_MEEPLE');
    expect(e.getMeepleOptions()).not.toContain('road'); // P1'in işçisi ağda
    expect(e.getMeepleOptions()).toContain('field');
    expect(e.placeMeeple('road')).toBe(false);
    e.passMeeple();
  });

  it('çayır bölgesinde rakip çiftçi varsa işçi seçeneği hiç açılmaz', () => {
    const e = mk(['open-field#0', 'open-field#1', 'open-field#2', ...PAD]);
    playTurn(e, 1, 0, 0, 'field'); // P1 çiftçisi
    const e2 = e;
    e2.drawTile();
    expect(e2.placeTile(2, 0)).toBe(true); // aynı çayır bölgesi
    expect(e2.phase).toBe('DRAW'); // seçenek yok → PLACE_MEEPLE atlandı
  });

  it('işçisi biten oyuncuya baloncuk açılmaz', () => {
    const e = mk(['open-field#0', 'open-field#1', ...PAD]);
    e.players[1]!.meeplesAvailable = 0; // P2'siz başlar
    playTurn(e, 1, 0, 0, 'field'); // P1 çiftçisini koyar
    e.drawTile(); // P2 sıra
    expect(e.placeTile(2, 0)).toBe(true);
    expect(e.phase).toBe('DRAW'); // meeplesAvailable 0 → PLACE_MEEPLE atlandı
    expect(e.placedMeeples.every((m) => m.ownerId === 'p1')).toBe(true);
  });

  it('placeMeeple/placeTile faz korumaları', () => {
    const e = mk(['open-field#0', ...PAD]);
    expect(e.placeMeeple('field')).toBe(false); // DRAW fazında
    expect(e.placeTile(1, 0)).toBe(false); // PLACE_TILE olmadan
    e.drawTile();
    expect(e.placeTile(0, -1)).toBe(false); // başkent N=city ≠ field
    e.passMeeple.call(e); // PLACE_TILE fazında pas: no-op
    expect(e.phase).toBe('PLACE_TILE');
  });
});

// --- 5) Kapanış ve puanlama ----------------------------------------------------------

describe('yol kapanışı', () => {
  it('yol iki uçtan kapanınca uzunluk×1 puan, işçi geri döner', () => {
    const e = mk(['city-crossroad#0', 'open-field#0', 'road-outpost#0', ...PAD]);
    playTurn(e, 0, -1, 180, 'road'); // crossroad W=road ucu (-1,-1)'de açık
    playTurn(e, 1, 0); // P2 pas
    playTurn(e, -1, -1, 90, undefined); // outpost E=road → yol {crossroad,outpost} kapandı
    const ev = e.events.find((x) => x.kind === 'road' && !x.final);
    expect(ev).toBeDefined();
    expect(ev!.points).toBe(2);
    expect(ev!.winners).toEqual(['p1']);
    expect(ev!.message).toContain('tamamlandı');
    expect(e.players[0]!.score).toBe(2);
    expect(e.players[0]!.meeplesAvailable).toBe(7); // işçi ele döndü
    expect(e.placedMeeples).toHaveLength(0);
  });

  it('yarım açık yol puanlanmaz, işçide kalır', () => {
    const e = mk(['city-crossroad#0', 'open-field#0', 'road-straight#0', 'open-field#1', ...PAD]);
    playTurn(e, 0, -1, 180, 'road');
    playTurn(e, 1, 0);
    playTurn(e, -1, -1, 90); // straight W ucu (-2,-1)'de hâlâ açık
    expect(e.events.some((x) => x.kind === 'road' && !x.final)).toBe(false);
    expect(e.players[0]!.score).toBe(0);
    expect(e.placedMeeples).toHaveLength(1);
  });
});

describe('kale kapanışı', () => {
  it('başkent kalesi kapanışı: 3 karo×2 + 3 arma×2 = 12 puan', () => {
    const e = mk(['city-gate#0', 'open-field#0', 'city-gate#1', ...PAD]);
    playTurn(e, 0, 1, 0, 'city'); // P1 muhafızı kalede
    playTurn(e, 1, 0); // P2 pas
    playTurn(e, 0, -1, 180); // ikinci gate kuzeye → kale kapandı
    const ev = e.events.find((x) => x.kind === 'city' && !x.final)!;
    expect(ev.points).toBe(12); // 3×2 + 3 arma×2
    expect(ev.winners).toEqual(['p1']);
    expect(ev.label).toContain('Kalesi');
    expect(e.players[0]!.score).toBe(12);
    expect(e.players[0]!.meeplesAvailable).toBe(7);
    expect(e.completedCityTiles.has('0,0')).toBe(true);
    expect(e.completedCityTiles.has('0,1')).toBe(true);
    expect(e.completedCityTiles.has('0,-1')).toBe(true);
  });

  it('sahipsiz kapanan kale puan vermez ama kapanmış sayılır', () => {
    const e = mk(['city-gate#0', 'city-gate#1', ...PAD]);
    playTurn(e, 0, 1);
    playTurn(e, 0, -1, 180);
    const ev = e.events.find((x) => x.kind === 'city' && !x.final)!;
    expect(ev.winners).toHaveLength(0);
    expect(e.players.every((p) => p.score === 0)).toBe(true);
    expect(e.completedCityTiles.has('0,0')).toBe(true);
  });
});

describe('mabet (3×3) kapanışı', () => {
  it('8 komşu dolunca +9 puan, keşiş geri döner; eksikken puan yok', () => {
    const e = mk([
      'shrine-field#0', // 1) mabet (1,0)
      'city-gate#0', // 2) (0,-1) rot180 — şehre komşu
      'open-field#0', // 3) (1,1)
      'open-field#1', // 4) (2,0)
      'open-field#2', // 5) (2,1)
      'city-gate#1', // 6) (0,1) rot0
      'open-field#3', // 7) (1,-1) — 7/8
      'open-field#4', // 8) (2,-1) — 8/8 kapanır
      ...PAD,
    ]);
    playTurn(e, 1, 0, 0, 'shrine'); // P1 keşişi mabete
    playTurn(e, 0, -1, 180);
    playTurn(e, 1, 1);
    playTurn(e, 2, 0);
    playTurn(e, 2, 1);
    expect(e.events.some((x) => x.kind === 'shrine' && x.points === 9)).toBe(false); // henüz 7/8
    playTurn(e, 0, 1);
    expect(e.events.some((x) => x.kind === 'shrine' && x.points === 9)).toBe(false);
    playTurn(e, 1, -1);
    playTurn(e, 2, -1); // kapanış
    const ev = e.events.find((x) => x.kind === 'shrine')!;
    expect(ev.points).toBe(9);
    expect(ev.winners).toEqual(['p1']);
    expect(ev.message).toContain('keşiş geri döndü');
    expect(e.players[0]!.score).toBe(9);
    expect(e.players[0]!.meeplesAvailable).toBe(7);
    expect(e.scoredShrines.has('1,0')).toBe(true);
  });

  it('skorlanmış mabet bir daha skorlanmaz', () => {
    const e = mk(['shrine-field#0', ...PAD]);
    playTurn(e, 1, 0, 0, 'shrine');
    const before = e.events.length;
    expect(e.evaluateCompletions('1,0')).toHaveLength(0);
    expect(e.events.length).toBe(before);
    expect(e.players[0]!.score).toBe(0); // tek başına mabet kapalı değil
  });
});

// --- 6) Oyun sonu ---------------------------------------------------------------------

describe('oyun sonu', () => {
  it('torba bitince GAME_OVER; eksik kale (karo+arma) ve eksik yol (karo) skorlanır', () => {
    const e = mk(['city-crossroad#0', 'road-straight#0', 'open-field#0']);
    playTurn(e, 0, -1, 180, 'city'); // P1 muhafızı eksik kalede (start+crossroad; S tarafı açık)
    playTurn(e, -1, -1, 90, 'road'); // P2 yol işçisi — aynı karonun ayrı özelliği, çakışmaz
    playTurn(e, 1, 0); // P1 açık karo; torba boş → GAME_OVER
    expect(e.phase).toBe('GAME_OVER');
    // Eksik kale: 2 karo + 1 arma → P1 +3 ; Eksik yol: 2 karo → P2 +2
    expect(e.players[0]!.score).toBe(3);
    expect(e.players[1]!.score).toBe(2);
    expect(e.winners).toEqual(['p1']);
    expect(e.ranking()[0]!.id).toBe('p1');
  });

  it('son karo yerleştirilince DRAW fazına dönülmez, oyun biter', () => {
    const e = mk(['open-field#0']);
    playTurn(e, 1, 0); // tek karo yerleşti, torba boş
    expect(e.phase).toBe('GAME_OVER');
    expect(e.drawTile().gameOver).toBe(true);
    expect(e.drawTile().drawn).toBeNull(); // GAME_OVER'da çekim boş sonuç
  });

  it('çiftçi: bölgesine komşu kapanmış kale başına 3 puan', () => {
    const e = mk(['city-gate#0', 'city-gate#1', 'open-field#0']);
    playTurn(e, 0, 1); // P1 gate — kale henüz açık
    playTurn(e, 0, -1, 180); // P2 gate → başkent kalesi kapandı (sahipsiz)
    playTurn(e, 1, 1, 0, 'field'); // P1 çiftçisi kapanan kaleye komşu çayırda; torba bitti
    expect(e.phase).toBe('GAME_OVER');
    expect(e.players[0]!.score).toBe(3);
    const farm = e.events.find((x) => x.kind === 'farm')!;
    expect(farm.points).toBe(3);
    expect(farm.message).toContain('kale × 3');
  });
});
