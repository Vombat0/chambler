/**
 * A6 — inspect-text: panel içi çizimler için saf metin/renk yardımcıları.
 * DOM yok, deterministik (seed = def.id hash'i).
 */

/** FNV-1a 32-bit. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 0..359, aynı metin aynı ton. */
export function seededHue(seedText: string): number {
  return hashSeed(seedText) % 360;
}

/**
 * Kelime bazında greedy satır kırma, deterministik:
 * - Her satır <= maxChars.
 * - Sonuç en fazla maxLines satır; satır sığmazsa son satıra '…' eklenir.
 * - maxChars'tan uzun tekil kelimeler önce maxChars'a kırpılır.
 */
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  if (maxChars < 2 || maxLines < 1) return [];
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const all: string[] = [];
  let current = '';
  for (const raw of words) {
    const word = raw.length > maxChars ? raw.slice(0, maxChars) : raw;
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) current = candidate;
    else {
      all.push(current);
      current = word;
    }
  }
  all.push(current);
  if (all.length <= maxLines) return all;
  return all.slice(0, maxLines).map((line, i) => {
    if (i !== maxLines - 1) return line;
    const withMark = `${line}…`;
    return withMark.length <= maxChars ? withMark : `${line.slice(0, maxChars - 1)}…`;
  });
}
