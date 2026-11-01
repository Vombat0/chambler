/**
 * Mülk Tycoon — genel giriş noktası.
 *
 * Oyun seçim ekranı bu modülden yalnızca `MonopolyEntry` ve motoru içe aktarır;
 * başka bir oyunun dosyasına bağımlılık yoktur.
 */

export { MonopolyEntry } from './MonopolyEntry.js';
export type { MonopolyEntryProps } from './MonopolyEntry.js';
export { MonopolyGameView, newMonopolyGame } from './MonopolyGameView.js';
export type { MonopolyGameViewProps } from './MonopolyGameView.js';
export { createRoomSync, MONOPOLY_STATE_MESSAGE } from './monopolySync.js';
export type { MonopolySync, RoomLike } from './monopolySync.js';
export { makeMpT } from './monopolyStrings.js';
export type { MpKey } from './monopolyStrings.js';
export * from './monopolyEngine.js';
