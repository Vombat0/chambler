/**
 * D1 — Lobi yardımcıları: koltuk ve renk seçim mantığı (saf).
 *
 * Palet `packages/server/src/lobby/seats.ts` ile aynı sırada.
 */

export const PLAYER_COLORS = [
  '#e63946',
  '#2a9d8f',
  '#e9c46a',
  '#457b9d',
  '#9b5de5',
  '#f4a261',
  '#8ac926',
  '#ff70a6',
] as const;

export type PlayerColor = (typeof PLAYER_COLORS)[number];

/** i18n `color.*` anahtarı için renk ipucu (renk ismi metin olarak gösterilir). */
export const COLOR_KEYS: Record<PlayerColor, string> = {
  '#e63946': 'color.red',
  '#2a9d8f': 'color.teal',
  '#e9c46a': 'color.yellow',
  '#457b9d': 'color.blue',
  '#9b5de5': 'color.purple',
  '#f4a261': 'color.orange',
  '#8ac926': 'color.green',
  '#ff70a6': 'color.pink',
};

export interface LobbyPlayerLike {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly seat: number;
  readonly isHost: boolean;
  /** Sunucu state'i bağlantıyı taşımıyor olabilir; UI'da opsiyonel. */
  readonly connected?: boolean;
}

/** Renk i18n anahtarı; palet dışıysa null. */
export function colorKeyOf(color: string): string | null {
  return COLOR_KEYS[color.toLowerCase() as PlayerColor] ?? null;
}

/** Bir rengin diğer oyuncularda kullanılıp kullanılmadığı. */
export function isColorTaken(color: string, players: readonly LobbyPlayerLike[], selfId: string): boolean {
  return players.some((player) => player.id !== selfId && player.color.toLowerCase() === color.toLowerCase());
}

/** Seçilebilir renk adayları (başka oyuncunun aldıkları devre dışı). */
export function availableColors(
  players: readonly LobbyPlayerLike[],
  selfId: string,
): readonly PlayerColor[] {
  return PLAYER_COLORS.filter((color) => !isColorTaken(color, players, selfId));
}

/** Boş koltuklar (0..players.length aralığıyla; salon maxı dışarıdan gelir). */
export function availableSeats(
  players: readonly LobbyPlayerLike[],
  selfId: string,
  maxSeats: number,
): number[] {
  const occupied = new Set(players.filter((p) => p.id !== selfId).map((player) => player.seat));
  const seats: number[] = [];
  for (let seat = 0; seat < maxSeats; seat += 1) {
    if (!occupied.has(seat)) seats.push(seat);
  }
  return seats;
}

/** Oyuncular katıldığı sıraya göre (joinedAt); liste kararlı. */
export function sortPlayers(
  players: readonly LobbyPlayerLike[],
): readonly LobbyPlayerLike[] {
  return [...players].sort((a, b) => a.id.localeCompare(b.id));
}
