# D2 — Nesne paleti, oyun paketi yükleme ve masa araçları

Masa ekranında üç araç: **nesne paleti** (buton + `B`), **paket yükle**
(`packs/property-tycoon`) ve **masayı temizle** (host). Tüm mantık saf TS
modüllerinde, React yalnızca görünüm ve olay bağlar.

## Dosyalar

| Dosya | Görev |
|---|---|
| `palette/paletteItems.ts` | Kategori/öğe kataloğu, adet kırpma (1–10), ikon yolları |
| `palette/paletteSpawn.ts` | Palet öğesi + adet → çakışmasız `ObjectDef[]` |
| `palette/spawnPlacer.ts` | Spiral boş yer bulma, AABB çakışma, masa sınırı |
| `palette/spawnQueue.ts` | Kare başına 10 spawn (UI donmaz) |
| `palette/optimistic.ts` | Çevrimiçi spawn: bekleme/onay/ret/zaman aşımı |
| `palette/paletteKeyboard.ts` | Klavye eylem haritası, ızgara ve kategori gezinmesi |
| `palette/packValidation.ts` | Manifest doğrulama (zod şeması + mantıksal kontroller) |
| `palette/packSource.ts` | `manifest.json` derleme zamanı `?raw` importu + doğrulama |
| `palette/packLoader.ts` | Manifest → tahta/piyon/deste/para yerleşimi, adım ilerlemesi |
| `palette/PalettePanel.tsx` | Panel (masaüstü sağ-alt, mobilde bottom sheet) |
| `palette/TableTools.tsx` | Alt araç çubuğu, paket ilerlemesi, temizleme onayı |

## Palet

- Kategoriler: **Zar** (d4–d20), **Piyon**, **Token**, **Karo**, **Kart**,
  **Deste**, **Tahta**. Sekmeler `role="tablist"`, öğeler `aria-pressed`.
- Adet 1–10 (`− / +`), piyonda 8 renkli oyuncu paleti.
- `Ekle` seçili öğeden `count` kopya üretir; her kopya **boş** bir noktaya
  konur, masa dolarsa kalanlar atlanır ve panel "Masada boş yer kalmadı."
  uyarısı verir (`err.TABLE_FULL`).
- Yerleşim: merkezden dışa spiral (`DEFAULT_PLACER_STEP = 0.5 m`, halka başına
  `ring*8` aday), AABB çakışması `OVERLAP_GAP = 6 cm` boşlukla, masa sınırı
  `camera/bounds.ts` (`4 × 3 m`, 35 cm kenar payı).

### Klavye

| Tuş | Sekmelerde | Öğe ızgarasında |
|---|---|---|
| `←` `→` | önceki/sonraki kategori | önceki/sonraki öğe |
| `↑` `↓` | — | ±3 (ızgara sütunu) |
| `Home` `End` | — | ilk/son öğe |
| `Enter` / `Space` | — | **ekle** |
| `Esc` | kapat | kapat |

`B` kısayolu paleti açar/kapatır; **yazı alanlarında, `select`te ve ayarlar
modalı açıkken çalışmaz**. Panel açılışında odağı "Kapat"a alır, mobilde
alttan 78vh'lik sayfa olarak açılır.

## Paket yükleme

`packs/property-tycoon/manifest.json` **derleme zamanında** `?raw` ile paketlenir
(ağ isteği yok, çevrimdışı çalışır), `@chambler/modkit/browser` şemasıyla
doğrulanır: strict alan kontrolü, `assetRef` → `assets` çözümlemesi, yinelenen
kimlikler, `..`/mutlak yol ve uzantı kuralları.

Adımlar (`PACK_STEPS`, UI'da `aria-live` ile duyurulur):

1. `validate` — manifest indirilir/doğrulanır.
2. `board` — 6 × 4,5 m tahta, merkez `(-0.9, 0)`; 40 snap noktası tahta
   yüzeyine ölçeklenip `meta.slots` olarak saklanır (A5 BoardSlots uyumlu).
3. `pawns` — manifestteki 6 piyon, başlangıç hücresinde 3 × 2 ızgara
   (`meta.packPlace = 'fixed'`).
4. `decks` — 2 deste (chance, community) sağdaki boş şeride.
5. `money` — 6 para birimi `helpers.money.denominations`'tan.

Sonuç: **15 nesne** (1 tahta + 6 piyon + 2 deste + 6 para). Tahtada yer
kalmayan nesne sessizce atlanmaz; adım yine `ok` olur ve
`err.PACK_PARTIAL` toast'ı atlanan sayıyı bildirir. Aynı paket ikinci kez
yüklenirse eski paket nesneleri (`meta.sourcePack`) önce kaldırılır — üst üste
tahta oluşmaz.

## Masayı temizle

İki adımlı onay (5 saniye sonra kendiliğinden iptal). Yalnızca **host**
(yerel masada herkes) kullanabilir; değilse buton pasif ve
`err.HOST_ONLY` anlatımı görünür. Temizleme bekleyen spawn kuyruğunu ve
optimistik defteri de boşaltır.

## Çevrimiçi davranış

Yerel spawn her zaman sahnede olur; çevrimiçi masada ayrıca
`objectSpawn` gönderilir ve nesne `OptimisticSpawns`'a "beklemede" yazılır:

- sunucu aynı `id` ile yayınlarsa → onaylandı (takip biter),
- `OBJECT_INVALID` / `OBJECT_EXISTS` / `OBJECT_META_TOO_LARGE` → en eski
  bekleyen nesne yerel masadan **geri alınır** + hata toast'ı,
- 5 s `OBJECT_SPAWN_TIMEOUT` → aynı geri alma.

## Bilinen sınırlar (D2 kapsamı dışı)

- `assetRef` mantıksal addır; PNG/SVG dokular henüz yüklenmiyor (B/A
  paketlerinin işi), bu yüzden nesneler renkli geometri olarak görünür.
- Deste karıştırma, kart dağıtma, piyon hareket kuralları paket
  yardımcılarının (ileri faz) işidir.
- `packs/` dışındaki paketler için dosya seçici yok; yükleme sabit pakete bağlı.

## Testler

`packages/client/src/palette/*.test.ts` — 89 test: katalog/adet, klavye
haritası ve gezinme, spiral yerleştirme (dolu masa, sınır, büyük nesne),
palet spawn planı, kare bütçesi, optimistik onay/ret/zaman aşımı, manifest
doğrulama (şema + mantıksal), paket yerleşimi (adım dağılımı, çakışma, dar
masa) ve ilerleme yardımcıları.

```bash
pnpm --filter @chambler/client test
pnpm --filter @chambler/client build
```
