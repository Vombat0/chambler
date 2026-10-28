# assets/ — bilinçli olarak boş
Bu klasörde ikili görsel/ses dosyası yoktur: harici asset indirme stratejisi terk edildi
(`manifest.json` → `status: "abandoned"`). Eski boş alt klasörler (`ui/`, `textures/`,
`board/`, `cards/`, `dice/`, `tiles/`, `audio/`, `pawns/`, `tokens/`) silindi.

Oyun görselleri kodla üretilir ve paketlerin içinde durur:

- `packs/*/assets/` — üretilmiş PNG/SVG çıktıları
- `packs/property-tycoon/scripts/generate-art.ts` — üretici script

Burada yalnızca üç dosya kalır: `manifest.json` (indirilememiş kaynakların kaydı),
`README.md` (bu not) ve `LICENSES.md` (kaynak lisansları).

İleride gerçek 3D model (`.glb`) veya elle hazırlanmış ikili asset eklenirse buraya konur
ve `manifest.json` yeniden `status: "active"` yapılır.
