/**
 * FIX-PLAYABILITY-1 — Paylaşılan zar yüzü (SVG, 3×3 nokta ızgarası).
 * `Board2DView`'ın alt barı ve `DicePanel` aynı bileşeni kullanır.
 */

import type { JSX } from 'react';

/** Zar yüzü noktaları (3×3 ızgara index'i; 4 = orta). */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function DieFace({
  value,
  rolling,
  tone,
}: {
  value: number;
  rolling: boolean;
  tone: 'self' | 'remote';
}): JSX.Element {
  const pips = PIPS[value] ?? PIPS[1]!;
  const cellSize = 100 / 3;
  return (
    <svg
      viewBox="0 0 100 100"
      className={`b2d-die${rolling ? ' rolling' : ''}`}
      data-tone={tone}
      role="img"
      aria-label={`${value}`}
    >
      <rect x="4" y="4" width="92" height="92" rx="20" className="b2d-die-body" />
      <rect x="9" y="9" width="82" height="82" rx="16" className="b2d-die-inner" />
      {pips.map((pip) => (
        <circle
          key={pip}
          cx={(pip % 3) * cellSize + cellSize / 2}
          cy={Math.floor(pip / 3) * cellSize + cellSize / 2}
          r="9.5"
          className="b2d-die-pip"
        />
      ))}
    </svg>
  );
}
