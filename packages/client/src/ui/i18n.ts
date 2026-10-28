/**
 * D1 — i18n. Sözlükler `tr` ve `en`; anahtar kümeleri eşittir (test ile
 * garanti). Çalışmada eksik anahtar önce `tr`'ye düşer ve konsola anahtar
 * başına **bir kez** uyarı yazar.
 */

import { DEFAULT_SETTINGS, type Language, type SettingsStorage, SETTINGS_STORAGE_KEY } from './settings.js';

export type Dictionary = Record<string, string>;

const tr: Dictionary = {
  'app.name': 'Chambler',
  'app.tagline': 'tarayıcıda masa oyunu asistanı',

  'screen.home.title': 'Masaya davetlisin',
  'screen.home.subtitle': 'Takma adını seç, oda kur ya da kodla katıl; istersen çevrimdışı oyna.',
  'home.name.label': 'Takma ad',
  'home.name.placeholder': 'örn. Kaptan Duman',
  'home.code.label': 'Oda kodu',
  'home.code.placeholder': '5 haneli kod',
  'home.create': 'Oda oluştur',
  'home.join': 'Kodla katıl',
  'home.local': 'Yerel oyna (çevrimdışı)',
  'home.openSettings': 'Ayarları aç',

  'err.NAME_REQUIRED': 'Takma ad boş olamaz (en az 2 karakter).',
  'err.NAME_INVALID': 'Takma ad görünmez veya kontrol karakteri içeriyor.',
  'err.NAME_TOO_LONG': 'Takma ad en fazla 20 karakter olabilir.',
  'err.CODE_LENGTH': 'Oda kodu 5 karakter olmalı.',
  'err.CODE_CHARS': 'Kodda geçersiz karakter var (0/O ve 1/I/L kullanılmaz).',
  'err.CHAT_EMPTY': 'Sohbet mesajı boş olamaz.',
  'err.CHAT_TOO_LONG': 'Sohbet en fazla 300 karakter.',
  'err.CHAT_RATE_LIMITED': 'Çok hızlı yazıyorsun, bir saniye bekle.',
  'err.CHAT_INVALID': 'Mesaj gönderilemedi.',
  'err.SEAT_INVALID': 'Geçersiz koltuk.',
  'err.SEAT_TAKEN': 'Koltuk dolduğu için geçilemedi.',
  'err.COLOR_INVALID': 'Bu renk paletten seçilmelidir.',
  'err.COLOR_TAKEN': 'Renk az önce başka oyuncu tarafından alındı.',
  'err.ROOM_NOT_FOUND': 'Oda bulunamadı; kodu kontrol et.',
  'err.ROOM_FULL': 'Oda dolu.',
  'err.OBJECT_INVALID': 'Nesne geçersiz.',
  'err.OBJECT_EXISTS': 'Nesne zaten masada.',
  'err.OBJECT_META_TOO_LARGE': 'Nesne verisi çok büyük.',
  'err.TABLE_FULL': 'Masada boş yer kalmadı.',
  'err.PACK_INVALID': 'Oyun paketi doğrulanamadı.',
  'err.PACK_PARTIAL': 'Bazı paket nesneleri masaya sığmadı.',
  'err.HOST_ONLY': 'Bu işlemi yalnızca oda sahibi yapabilir.',
  'err.OBJECT_NOT_FOUND': 'Nesne bulunamadı.',
  'err.OBJECT_NOT_OWNER': 'Bu işlem için sahiplenmen gerekiyor.',
  'err.OBJECT_CLAIMED': 'Nesne başka oyuncunun elinde.',
  'err.FLIP_FORBIDDEN': 'Bu kartı çevirme iznin yok.',
  'err.SHUFFLE_FORBIDDEN': 'Bu desteyi karıştırma iznin yok.',
  'err.TRANSFORM_FORBIDDEN': 'Bu nesneyi yalnızca sahibi sürükleyebilir.',
  'err.TRANSFORM_MALFORMED': 'Bozuk ağ paketi reddedildi.',
  'err.DECODE_FAILED': 'Ağ paketi çözümlenemedi.',
  'err.UNKNOWN': 'Bir şey ters gitti.',
  'err.JOIN_FAILED': 'Masaya bağlanılamadı.',

  'status.idle': 'Hazır',
  'status.connecting': 'Bağlanıyor…',
  'status.connected': 'Bağlı',
  'status.reconnecting': 'Yeniden bağlanıyor…',
  'status.disconnected': 'Bağlantı yok',
  'status.offline': 'Çevrimdışı (yerel)',
  'region.status': 'Bağlantı durumu',
  'region.errors': 'Hata bildirimleri',

  'lobby.title': 'Lobi',
  'lobby.code.label': 'Oda kodu',
  'lobby.copy': 'Kodu kopyala',
  'lobby.copied': 'Kopyalandı!',
  'lobby.players.label': 'Oyuncular',
  'lobby.host': 'host',
  'lobby.seat.short': 'Koltuk',
  'lobby.you': 'sen',
  'lobby.start': 'Masaya başla',
  'lobby.back': 'Çık',
  'lobby.color.label': 'Renk seç',
  'lobby.enterTable': 'Masaya git',

  'color.red': 'Kırmızı',
  'color.teal': 'Deniz mavisi',
  'color.yellow': 'Sarı',
  'color.blue': 'Mavi',
  'color.purple': 'Mor',
  'color.orange': 'Turuncu',
  'color.green': 'Yeşil',
  'color.pink': 'Pembe',

  'hud.room.label': 'Oda',
  'hud.players.label': 'Oyuncular',
  'hud.chat.open': 'Sohbeti aç',
  'hud.chat.close': 'Sohbeti kapat',
  'hud.chat.label': 'Sohbet',
  'hud.chat.placeholder': 'Mesaj yaz (en fazla 300 karakter)…',
  'hud.chat.send': 'Gönder',
  'hud.settings.open': 'Ayarları aç',
  'hud.leave': 'Masadan çık',
  'hud.hostBadge': 'host',
  'hud.youBadge': 'sen',

  'palette.title': 'Nesne paleti',
  'palette.categories': 'Kategoriler',
  'palette.open': 'Nesne ekle',
  'palette.hint': 'Ok tuşları gezinir, Enter ekler, Esc kapatır.',
  'palette.add': 'Ekle',
  'palette.count.label': 'Adet',
  'palette.count.prefix': 'Adet',
  'palette.count.decrease': 'Adedi azalt',
  'palette.count.increase': 'Adedi artır',
  'palette.color.label': 'Piyon rengi',
  'palette.full': 'Masada boş yer kalmadı.',
  'palette.cat.dice': 'Zar',
  'palette.cat.pawns': 'Piyon',
  'palette.cat.token': 'Token',
  'palette.cat.tile': 'Karo',
  'palette.cat.card': 'Kart',
  'palette.cat.deck': 'Deste',
  'palette.cat.board': 'Tahta',
  'palette.item.d4': 'd4',
  'palette.item.d6': 'd6',
  'palette.item.d8': 'd8',
  'palette.item.d10': 'd10',
  'palette.item.d12': 'd12',
  'palette.item.d20': 'd20',
  'palette.item.pawn': 'Piyon',
  'palette.item.token': 'Jeton',
  'palette.item.tileSquare': 'Kare karo',
  'palette.item.tileHex': 'Altıgen karo',
  'palette.item.card': 'Kart',
  'palette.item.deck': 'Deste',
  'palette.item.board': 'Tahta',

  'tools.label': 'Masa araçları',
  'tools.clear': 'Masayı temizle',
  'tools.clear.confirmTitle': 'Masayı temizlemek istiyor musun?',
  'tools.clear.confirmYes': 'Evet, temizle',
  'tools.clear.confirmNo': 'Vazgeç',
  'tools.hostOnly': 'Yalnızca oda sahibi masayı temizleyebilir.',

  'pack.load': 'Paket yükle',
  'pack.loading': 'Paket yükleniyor…',
  'pack.loadingStep': 'Adım:',
  'pack.loaded': 'Paket yüklendi.',
  'pack.failed': 'Paket yüklenemedi.',
  'pack.step.validate': 'doğrulama',
  'pack.step.board': 'tahta',
  'pack.step.pawns': 'piyonlar',
  'pack.step.decks': 'desteler',
  'pack.step.money': 'para',

  'settings.title': 'Ayarlar',
  'settings.camera.label': 'Kamera hassasiyeti',
  'settings.camera.help': '0,2 (yavaş) – 2 (hızlı).',
  'settings.shadow.label': 'Gölge kalitesi',
  'settings.shadow.low': 'Düşük',
  'settings.shadow.medium': 'Orta',
  'settings.shadow.high': 'Yüksek',
  'settings.language.label': 'Dil',
  'settings.sound.label': 'Ses',
  'settings.reset.label': 'Masayı sıfırla',
  'settings.reset.button': 'Masayı sıfırla',
  'settings.reset.confirm.title': 'Masayı sıfırlamak istiyor musun?',
  'settings.reset.confirm.yes': 'Evet, sıfırla',
  'settings.reset.confirm.no': 'Vazgeç',
  'settings.reset.offlineOnly': 'Bu işlem yalnızca yerel/çevrimdışı masada kullanılabilir.',
  'settings.close': 'Kapat',

  'lang.tr': 'Türkçe',
  'lang.en': 'İngilizce',
  'common.yes': 'Evet',
  'common.no': 'Hayır',
  'common.close': 'Kapat',
  'common.cancel': 'İptal',
};

const en: Dictionary = {
  'app.name': 'Chambler',
  'app.tagline': 'tabletop in your browser',

  'screen.home.title': 'Welcome to the table',
  'screen.home.subtitle': 'Pick a nickname, create a table or join with a code — or play offline.',
  'home.name.label': 'Nickname',
  'home.name.placeholder': 'e.g. Captain Smoke',
  'home.code.label': 'Room code',
  'home.code.placeholder': '5-character code',
  'home.create': 'Create room',
  'home.join': 'Join with code',
  'home.local': 'Play locally (offline)',
  'home.openSettings': 'Open settings',

  'err.NAME_REQUIRED': 'Nickname must be at least 2 characters.',
  'err.NAME_INVALID': 'Nickname contains invisible or control characters.',
  'err.NAME_TOO_LONG': 'Nickname may be at most 20 characters.',
  'err.CODE_LENGTH': 'Room code must be 5 characters.',
  'err.CODE_CHARS': 'Invalid character in code (0/O and 1/I/L are not used).',
  'err.CHAT_EMPTY': 'Chat message must not be empty.',
  'err.CHAT_TOO_LONG': 'Chat is limited to 300 characters.',
  'err.CHAT_RATE_LIMITED': 'You are writing too fast, wait a second.',
  'err.CHAT_INVALID': 'Message could not be sent.',
  'err.SEAT_INVALID': 'Invalid seat.',
  'err.SEAT_TAKEN': 'Seat was taken while changing it.',
  'err.COLOR_INVALID': 'Pick a colour from the table palette.',
  'err.COLOR_TAKEN': 'That colour was just taken by another player.',
  'err.ROOM_NOT_FOUND': 'Room not found; check the code.',
  'err.ROOM_FULL': 'Room is full.',
  'err.OBJECT_INVALID': 'Object is invalid.',
  'err.OBJECT_EXISTS': 'Object already on the table.',
  'err.OBJECT_META_TOO_LARGE': 'Object data exceeds the limit.',
  'err.TABLE_FULL': 'No room left on the table.',
  'err.PACK_INVALID': 'The game pack could not be validated.',
  'err.PACK_PARTIAL': 'Some pack objects did not fit on the table.',
  'err.HOST_ONLY': 'Only the room host can do that.',
  'err.OBJECT_NOT_FOUND': 'Object not found.',
  'err.OBJECT_NOT_OWNER': 'Claim the object to perform this action.',
  'err.OBJECT_CLAIMED': 'Object is already claimed by another player.',
  'err.FLIP_FORBIDDEN': 'You cannot flip this card.',
  'err.SHUFFLE_FORBIDDEN': 'You cannot shuffle this deck.',
  'err.TRANSFORM_FORBIDDEN': 'Only the owner can move this object.',
  'err.TRANSFORM_MALFORMED': 'Malformed network packet rejected.',
  'err.DECODE_FAILED': 'Network packet could not be decoded.',
  'err.UNKNOWN': 'Something went wrong.',
  'err.JOIN_FAILED': 'Could not join the table.',

  'status.idle': 'Ready',
  'status.connecting': 'Connecting…',
  'status.connected': 'Connected',
  'status.reconnecting': 'Reconnecting…',
  'status.disconnected': 'Disconnected',
  'status.offline': 'Offline (local)',
  'region.status': 'Connection status',
  'region.errors': 'Error notifications',

  'lobby.title': 'Lobby',
  'lobby.code.label': 'Room code',
  'lobby.copy': 'Copy code',
  'lobby.copied': 'Copied!',
  'lobby.players.label': 'Players',
  'lobby.host': 'host',
  'lobby.seat.short': 'Seat',
  'lobby.you': 'you',
  'lobby.start': 'Start table',
  'lobby.back': 'Leave',
  'lobby.color.label': 'Pick colour',
  'lobby.enterTable': 'Go to table',

  'color.red': 'Red',
  'color.teal': 'Teal',
  'color.yellow': 'Yellow',
  'color.blue': 'Blue',
  'color.purple': 'Purple',
  'color.orange': 'Orange',
  'color.green': 'Green',
  'color.pink': 'Pink',

  'hud.room.label': 'Room',
  'hud.players.label': 'Players',
  'hud.chat.open': 'Open chat',
  'hud.chat.close': 'Collapse chat',
  'hud.chat.label': 'Chat',
  'hud.chat.placeholder': 'Type a message (up to 300 characters)…',
  'hud.chat.send': 'Send',
  'hud.settings.open': 'Open settings',
  'hud.leave': 'Leave table',
  'hud.hostBadge': 'host',
  'hud.youBadge': 'you',

  'palette.title': 'Object palette',
  'palette.categories': 'Categories',
  'palette.open': 'Add object',
  'palette.hint': 'Arrow keys navigate, Enter adds, Esc closes.',
  'palette.add': 'Add',
  'palette.count.label': 'Count',
  'palette.count.prefix': 'Count',
  'palette.count.decrease': 'Decrease count',
  'palette.count.increase': 'Increase count',
  'palette.color.label': 'Pawn colour',
  'palette.full': 'No room left on the table.',
  'palette.cat.dice': 'Dice',
  'palette.cat.pawns': 'Pawn',
  'palette.cat.token': 'Token',
  'palette.cat.tile': 'Tile',
  'palette.cat.card': 'Card',
  'palette.cat.deck': 'Deck',
  'palette.cat.board': 'Board',
  'palette.item.d4': 'd4',
  'palette.item.d6': 'd6',
  'palette.item.d8': 'd8',
  'palette.item.d10': 'd10',
  'palette.item.d12': 'd12',
  'palette.item.d20': 'd20',
  'palette.item.pawn': 'Pawn',
  'palette.item.token': 'Token',
  'palette.item.tileSquare': 'Square tile',
  'palette.item.tileHex': 'Hex tile',
  'palette.item.card': 'Card',
  'palette.item.deck': 'Deck',
  'palette.item.board': 'Board',

  'tools.label': 'Table tools',
  'tools.clear': 'Clear table',
  'tools.clear.confirmTitle': 'Clear the table?',
  'tools.clear.confirmYes': 'Yes, clear',
  'tools.clear.confirmNo': 'Cancel',
  'tools.hostOnly': 'Only the room host can clear the table.',

  'pack.load': 'Load pack',
  'pack.loading': 'Loading pack…',
  'pack.loadingStep': 'Step:',
  'pack.loaded': 'Pack loaded.',
  'pack.failed': 'Pack could not be loaded.',
  'pack.step.validate': 'validation',
  'pack.step.board': 'board',
  'pack.step.pawns': 'pawns',
  'pack.step.decks': 'decks',
  'pack.step.money': 'money',

  'settings.title': 'Settings',
  'settings.camera.label': 'Camera sensitivity',
  'settings.camera.help': '0.2 (slow) – 2 (fast).',
  'settings.shadow.label': 'Shadow quality',
  'settings.shadow.low': 'Low',
  'settings.shadow.medium': 'Medium',
  'settings.shadow.high': 'High',
  'settings.language.label': 'Language',
  'settings.sound.label': 'Sound',
  'settings.reset.label': 'Reset table',
  'settings.reset.button': 'Reset table',
  'settings.reset.confirm.title': 'Reset this table?',
  'settings.reset.confirm.yes': 'Yes, reset',
  'settings.reset.confirm.no': 'Cancel',
  'settings.reset.offlineOnly': 'Only available on a local/offline table.',
  'settings.close': 'Close',

  'lang.tr': 'Turkish',
  'lang.en': 'English',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
};

export const DICTIONARIES: Record<Language, Dictionary> = { tr, en: en };
/** Yedek dil: eksik anahtar önce buraya düşer. */
const FALLBACK_LANGUAGE: Language = 'tr';

const warned = new Set<string>();

function warnOnce(key: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[i18n] missing translation key: ${key}`);
}

/** `lang.en` gibi sabit düz anahtarlar; fallback istemez. */
function resolve(
  dictionary: Dictionary,
  fallback: Dictionary,
  key: string,
): string | null {
  return dictionary[key] ?? fallback[key] ?? null;
}

/**
 * Bir dile çevirmen üretir. Anahtar iki sözlükte de yoksa `null` döner;
 * `t()` çağıran katman bunu yedek dile düşürmek zorundadır.
 */
export function makeLookup(language: Language) {
  const dictionary = DICTIONARIES[language] ?? DICTIONARIES[FALLBACK_LANGUAGE];
  const fallback = DICTIONARIES[FALLBACK_LANGUAGE];
  return (key: string): string => {
    const value = resolve(dictionary, fallback, key);
    if (value !== null) return value;
    warnOnce(key);
    return key;
  };
}

/** Test amaçlı: iki sözlüğün anahtar kümeleri eşit mi? */
export function dictionaryKeysEqual(): boolean {
  const a = Object.keys(DICTIONARIES.tr).sort();
  const b = Object.keys(DICTIONARIES.en).sort();
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/** Tarayıcısak kayıtlı dili döner; ayarlar anahtarı yoksa varsayılan. */
export function storedLanguage(storage: SettingsStorage): Language {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS.language;
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && 'language' in value) {
      const language = asLanguageOrNull((value as Record<string, unknown>).language);
      if (language) return language;
    }
  } catch {
    // bozuk kayıt: varsayılan
  }
  return DEFAULT_SETTINGS.language;
}

function asLanguageOrNull(value: unknown): Language | null {
  return value === 'tr' || value === 'en' ? value : null;
}
