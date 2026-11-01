/**
 * R2 — Arayüz duman testi (SSR): bileşenler istisna fırlatmadan derlenir mi,
 * lobi ve harita geometrisi üretiliyor mu? Etkileşim testleri motor tarafında
 * (riskEngine.test.ts) zaten kapsanıyor.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CANVAS, REGION_IDS, buildShapes, toSvgPoints } from './boardData';
import { RiskGameView } from './RiskGameView';

describe('RiskGameView — SSR duman', () => {
  it('lobi hatasız render olur ve savaş düğmesini içerir', () => {
    const html = renderToStaticMarkup(<RiskGameView />);
    expect(html).toContain('TERRITORY WARS');
    expect(html).toContain('SAVAŞI BAŞLAT');
  });

  it('harita geometrisi: 28 bölgenin her biri geçerli çokgen (≥3 köşe, sınırlar içinde)', () => {
    const shapes = buildShapes();
    expect(Object.keys(shapes)).toHaveLength(REGION_IDS.length);
    for (const id of REGION_IDS) {
      const s = shapes[id]!;
      expect(s.points.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of s.points) {
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(CANVAS.width + 1);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(CANVAS.height + 1);
      }
      expect(toSvgPoints(s.points)).toContain(',');
    }
  });

  it('geometri deterministiktir: aynı tohum → aynı harita', () => {
    expect(JSON.stringify(buildShapes(5))).toBe(JSON.stringify(buildShapes(5)));
    expect(JSON.stringify(buildShapes(5))).not.toBe(JSON.stringify(buildShapes(6)));
  });
});
