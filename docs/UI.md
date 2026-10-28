# D1 — Uygulama kabuğu: ekranlar, i18n, erişilebilirlik

## Ekran akışı
`home` → (oda oluştur / kodla katıl) → `lobby` → (host "masaya başla") → `table`.
`home` → "yerel oyna" → `table` (offline). Lobby'den çıkış odayı terk eder;
online `table`'dan çıkış lobiye, offline tablodan çıkış home'a döner.

## Durum makinesi
`ui/router.ts`: saf TS makine, kütüphane yok. State: `{ screen, room, online,
settingsOpen }`. Hata katmanı (`ui/ErrorToasts.tsx`) ekran durumundan bağımsızdır.
React `useSyncExternalStore(machine.subscribe, machine.getSnapshot)` ile bağlanır.

## Doğrulama (sunucuyla uyumlu)
- Ad: 2–20 karakter, whitespace birleştir; kontrol/zero-width/bidi reddi
  (`ui/validation.ts`). İstemci, sunucu (`lobby/names.ts`) katılığından daha
  gevşek değildir.
- Kod: 5 karakter, `trim` + büyük harf; alfabe `0/O` ve `1/I/L` hariç
  (`ui/validation.ts`).
- Hata mesajları: sunucu `error` kodları `ui/errors.ts` üzerinden i18n'e;
  bilinmeyen kod `err.UNKNOWN` + özgün sunucu metni.

## i18n
`ui/i18n.ts`: `tr`/`en` sözlükleri; iki sözlükteki anahtar kümeleri eşit
olmalı (vitest kontrolü). Eksik anahtar `err.X` gelmemişse `tr`'ye düşer ve
konsola anahtar başına **bir kez** uyarı yazılır. Dil seçimi hem home hem
HUD/settings içinden yapılabilir; localStorage'da kalıcıdır.

## Ayarlar
`ui/settings.ts`: `chambler.settings.v1` sürüm anahtarı altında
localStorage; alan bazlı dayanıklılık (bozuk JSON/yanlış tip → varsayılan).
Kamera hassasiyeti OrbitControls hızı, gölge kalitesi renderer parametresi
(`ui/settingsApply.ts`); ses için ayar kaydedilir, oynatıcı ileriye dönüktür.
"Masayı sıfırla" yalnızca offline masada, çift adımlı onayla çalışır.

## Erişilebilirlik
- Tüm alanlar `htmlFor` etiketli; inline hatalar `role="alert"`.
- Bağlantı durumu ve hata duyuruları `aria-live` bölgesinde (durum pill,
  rol `status` / `region` + `aria-label`).
- Ayarlar modalı: `role="dialog"` + `aria-modal`, açılışta kapatmaya odak,
  Esc/`Tab` odak tuzağı, kapanışta odak açan butona geri döner.
- Renk adları palet yanında metin olarak da verilir (renk körlüğü).
- Odak halkası `:focus-visible`; tam klavye gezinmesi mümkün.

## Performans
Ağır CSS efekti yok (yalnızca düz renkler/kenarlar, geçişsiz animasyon);
HUD `position:relative` DOM katmanı, canvas render hızı üzerinde etkisi
olmayan React ağacı. Mobil 360 px: tek kolon lobi, tek kolon HUD.

## Dosyalar
`packages/client/src/ui/` — router, i18n, errors, validation, chat, lobby,
settings, settingsApply (saf) + HomeScreen, LobbyScreen, ChatPanel, Hud,
SettingsModal, ErrorToasts (React).
