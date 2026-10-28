# Inspect (A6) — 2D yakın görünüm

## Tetikleme ve çakışma çözümü
- Sağ tık havuzu A2 (kamera orbiti) ile paylaşılır. Ayrım `InspectGesture` durum makinesinde:
  - Sağ tık **sürüklenirse** (>4 px veya >350 ms) orbit devam eder, inspect açılmaz.
  - Sağ tık **hareketsiz bırakılırsa** (≤4 px hareket, ≤350 ms) inspect açılır.
- A3 `InteractionController`'ın sağ-tuş pointerdown zinciri, `InspectController`
  `stopImmediatePropagation` ile kesilir: sağ tuş nesne sürüklemez, claim üretmez.
- Dokunmatik/pen: **long press ≥500 ms** (hareket ≤10 px) inspect açar; süre dolmadan
  sürükleme başlarsa iptal olur, normal sürükleme akar.

## Kapsam
| Tür | Inspect | İçerik |
|---|---|---|
| card | ✅ | prosedürel yüz görseli: ad, tür, açıklama, çerçeve; kapalıysa arka yüz mührü |
| board | ✅ | üstten kesit + 8×5 hücre ızgarası + slot noktaları ve adları |
| tile | ✅ | 4 kenar değeri (N/E/S/W), döndürme kadranı ve ok ucu, pusula harfleri |
| token | ✅ | gold rozet, etiket, basit meta künyesi |
| die / deck / custom | ❌ | inspect devre dışı (sessizce yoksayılır) |

assets/ paketleri manifest üzerinden ayrılmış ama içleri boş olduğu için tüm içerik
prosedürel çizilir (`inspect-draw.ts`, deterministik seed = `def.id` hash). assetRef
içi boş dokulu panel yok: desteklenen her türde arka plan + metin + biçim çizilir.

## Panel
- HTML (DOM) + canvas: dar arka plan, `role="dialog"`, `aria-modal`, `aria-label`.
- Başlık kartında ad/tür/sahiplik/meta; gövdede yüksek çözünürlüklü 2D çizim (720–1280 px).
- Zoom: tekerlek, `0.5x–4x` sınırında (`InspectViewport`); harici pan içerik dışına akmaz.
- Gezinme: sürükleme + ok tuşları (40 px adım). Kapatma: Esc, dış tıklama, ✕ butonu.

## Erişilebilirlik
- Panel açılınca odak kapat butonuna gider; Tab/Shift+Tab odak tuzağı çevresel döngü.
- Esc paneli kapatır, odak önceki elemana geri döner; kapat butonu `aria-label`'lı.
- `InspectPanelModel` saf TS olduğundan Escape/pan/odak kuralları test edilebilir.

## Performans
- İçerik canvas'ı `InspectCache`'te (LRU, 8) saklanır: aynı nesne + aynı meta
  tekrar açılışta yeniden çizilmez.
- Panel açıkken 3D render döngüsü duraklatılır (`renderer.setAnimationLoop(null)`);
  kapanınca eski `frame()` döngüsü geri kurulur → panel açıkken 3D render/FPS sıfır.
- Döngü: saf TS (gesture/viewport/model/cache/metin) + DOM (overlay) + canvas (draw) ayrı.

## Bilinen sınırlar
- Panel açıkken fizik de durur (frame döngüsü tek); kapanınca devam eder.
- Kart arka yüzü prosedüreldir; gerçek doku paketleri (assets) geldiğinde doku yolu eklenmeli.
- Uzun basma mobilde sistem context menu'süyle yarışabilir; `contextmenu` preventDefault yapılır.
- Dual-touch zoom (pinch) desteklenmez; pinch uzaklaşırsa pan/zoom değil normal orbit/sürük.
- Sağ-tuş tetikleme raycast ile nesnye vurulursa çalışır; boş masaya sağ tık panel açmaz.
