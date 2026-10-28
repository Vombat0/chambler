# grid API (A5) — hücre tabanlı yerleştirme (snap grid)

- `GridModel` (saf TS): kare + altıgen (pointy/flat). `cellToWorld` <-> `worldToCell`
  çift yönlü ve roundtrip-güvenli (kare: floor, hex: küp aks-rounded axial).
  Sınır: squares `{cols,rows}`, hex `{radius}`. `cellsNear(p, r, max)` vurgu listesi.
- `OccupancyMap` (saf TS): hücre -> katman (`tile`/`token`) -> objectId.
  `multiLayer` açık: token + karo aynı hücrede; kapalı: çakışma reddi (`CELL_OCCUPIED`).
- `TileEdges` (saf TS): 4 kenar (N/E/S/W), `rotateTileEdges` 0/90/180/270,
  `checkEdges` komşu karoların karşılıklı kenar eşitliğini kontrol eder; hex'te 4
  kenar tanımsız olduğundan kenar kontrolü `HEX_EDGES_UNSUPPORTED` döner.
- `BoardSlots` (saf TS): isimli snapPoints (`{id, position[x,y,z]}`),
  `byName`, `nearestFree`, `occupy`/`release`, doluluk takibi.
- `GridManager`: `createGrid`, `worldToCell`, `cellToWorld`, `snapCheck`
  (eşik = cellSize'ın %45'i, dışı serbest bırakılır), `canPlace`, `place`,
  `remove`, `highlight` (<= 200 hücre, yeşil/geçerli - kırmızı/dolu),
  `clearHighlight`, `placeInSlot`. Kenarlı karo: `place({edges, rotation})` —
  yerleşen kenarlar komşu kontrolünde kullanılır.
- `HighlightRenderer` (THREE): TEK `InstancedMesh` + TEK `PlaneGeometry`; tek
  draw call, sürükleme sırasında yalnız instance matris/renk güncellenir, geometri
  yeniden kurulmaz -> 200 hücrede ucuz. (Merge edilmiş BufferGeometry her pointer
  hareketinde vertex yeniden kuracaktı; gerekçe budur.)
- `bindGridToInteraction(controller, grid)`: `objectClaim` -> highlight temizle;
  `transformUpdate` (tutarken) -> hücre vurgusu; `objectRelease` -> eşik içindeyken
  snap (karo kenarı `def.meta.edges`'ten okunur), dışında serbest; slotlar
  (`useSlots`) önce denenir. Yapısal tip: WebGL/scene gerektirmez.
- Tümyerleşim saf TS; testler WebGL'siz.
