# BOARD2D — Saf 2D Tahta Modu (Board Game Arena / Roll20 tarzı)

> Görev: **2D-1** · Faz: **2D (Board Game Arena Style 2D Engine)**
> Kullanıcının stratejik kararı: tarayıcıda 3D masa görünümü hantal ve
> okunaksız; **birincil görünüm kristal netliğinde, tam tepeden 2D tahtadır.**
> Varsayılan açılış artık `2D Tahta`'dır; `[ 2D Tahta | 3D Masa ]` düğmesi
> HUD'dadır ve tercih `localStorage`'da (`chambler.viewMode`) saklanır.

## 1. Mimari

```
packages/client/src/board2d/
├── boardGeometry.ts    Saf geometri: 40 hücre → 11×11 ızgara, snap, yelpaze
│                       yığılma, board↔world eşleme (1000 birim = 10 m)
├── boardData.ts        Paket verisi (?raw, çevrimdışı): board.json, grup
│                       renkleri, Fırsat/Topluluk desteleri, TR/EN i18n
├── board2dBridge.ts    Ağ köprüsü: ObjectEvents 20 Hz + NetBridge uyumlu tel
│                       formatı + TransformInterpolator (akıcı uzak piyon)
├── tokenStore.ts       Piyon durumu (useSyncExternalStore'a hazır saf depo)
├── diceModel.ts        Zar durum makinesi: idle → rolling → settled, 2d6
├── decks.ts            Deste karma/sıra mantığı (rng enjekte edilebilir)
├── viewMode.ts         2D/3D tercih kalıcılığı (varsayılan: 2d)
├── strings.ts          2D görünüme özel TR/EN metin tablosu
├── Board2DView.tsx     Ana bileşen: SVG tahta + HTML piyon katmanı + zar barı
└── ViewToggle.tsx      [ 2D Tahta | 3D Masa ] segmentli geçiş düğmesi
```

Bağlantı noktaları: `App.tsx` (varsayılan 2D, canvas 2D modda `display:none`
ancak **mount'ta kalır** → 3D araçlar hiç ölmez), `ui/Hud.tsx`
(`viewToggle?: ReactNode` slotu), `styles.css` (`/* 2D-1 */` bölümü).

## 2. Neden veriyle çizilmiş SVG?

`board.png` 1440px raster'dır; 4K ekranda büyüyünce sokak isimleri bulanıklaşır.
Board2DView tahtayı **paketin veri dosyalarından** (board.json + groups.json +
i18n) vektör olarak yeniden çizer:

- Kenar/slot → dikdörtgen formülü `scripts/generate-art.ts::cellRect` ile
  birebir aynıdır; yuvalar sanatla hiç kaymaz.
- Sokak adı, fiyat ve grup bandı her DPI'da jilet gibidir (tarayıcı metin
  işleme, `paint-order` kontur).
- Sahne `ResizeObserver` ile **kareye sığdırılır** (fit-to-screen); SVG
  viewBox sabit olduğundan çarpılma fiziksel olarak imkânsızdır.

## 3. Piyonlar ve snap

- Her oyuncunun renginde, kabartma gölgeli, baş harfli HTML piyonu tahta
  üzerinde `%` koordinatla durur (HTML katmanı = en net metin).
- Sürükleme sırasında piyon serbest yüzer; bırakınca `snapToCell()`:
  önce içinde bulunulan hücre, yoksa merkezi en yakın hücre ("tık" diye oturur).
- Aynı hücrede birden çok piyon varsa yelpaze ofsetiyle (yarıçap ≈ ⅓ hücre)
  ayrışır, hiçbiri kaybolmaz.
- Orta alana (geçersiz bölge) bırakmak bile en yakın çevre hücresine snap
  verir — piyon asla tahtada kaybolmaz.

## 4. Ağ entegrasyonu (ObjectEvents + NetBridge sözleşmesi)

Piyon ve zar odada gerçek `ObjectDef`'lerdir:

| Nesne | id | kind | meta |
|---|---|---|---|
| Piyon | `b2d-tok-<playerId>` | `token` | `board2d, role:'token', playerId` |
| Zar | `b2d-die-<playerId>` | `die` | `board2d, role:'die', faces:12` (2d6 toplamı) |

- **Giden hareket:** `ObjectEventEmitter.emitTransformUpdate` (20 Hz,
  `TRANSFORM_RATE_HZ`) → NetBridge/sunucu ile birebir uyumlu JSON
  `transformUpdate` {id, transform, velocity, seq, t} karesi.
- **Gelen hareket:** kareler `TransformInterpolator`'a girer (B3'teki 100 ms
  gecikmeli enterpolasyon) → diğer oyuncunun ekranında piyon **akıcı kayar**,
  bırakınca snap karesiyle hedefe tam oturur.
- **Zar:** "Zar At" → ~0.9 s animasyon → sonuç `objectRelease + objectClaim +
  dieResult` olarak odaya gider (yeni claim epoch'u sayesinde arka arkaya
  atışlar sunucunun çakışma penceresine takılmaz). Sunucu `1..12` doğrulaması
  yapar ve `dieResult`'ı yayar; uzak istemcide zarlar aynı toplamla döner ve
  "Ayşe: 3 + 5 = 8" gösterilir.
- **Geç katılan:** `tableResync` uzak piyonları kurar; kadro büyüdükçe mevcut
  konum tek karelik `announceSelf()` ile yeniden duyurulur.

## 5. Desteler ve zarlar

- Fırsat (pembe `?`) ve Topluluk (turkuaz `≡`) desteleri tahtanın ortasında
  tıklanabilir kart desteleri olarak çizilir; tıklanınca kart üstten flip
  animasyonuyla açılır, başlık + metin jilet netliğinde okunur (16+16 kart,
  TR/EN).
- Alt barda iki adet 2D zar (çukur noktalı, klasik fildişi) + **Zar At**
  butonu; sonuç hem alt barda hem tahtanın ortasında büyük gösterilir.

## 6. Mevcut araçların korunması

2D modda 3D canvas `display:none` ile arka planda mount'ta kalır; bu sayede
`B` paleti, "Mülk Tycoon" paket yükleme, masayı temizleme, canlı sohbet ve
oyuncu listesi birebir çalışmaya devam eder. Toggle ile 3D'ye geçiş anlıktır
(sahte yeniden kurma yoktur), tercih kalıcıdır.

## 7. Testler (49 yeni, toplam 470 yeşil)

`boardGeometry.test.ts` (12) · `board2dBridge.test.ts` (12) ·
`diceModel.test.ts` (9) · `decks.test.ts` (6) · `tokenStore.test.ts` (5) ·
`boardData.test.ts` (5). Kapsam: koordinat eşleme, snap mantığı, zar durumu,
2D/3D toggle kalıcılığı, çoklu oyuncu piyon/spawn/dieResult senkronu.
