import { describe, expect, it } from 'vitest';
import { packAssetNames, packAssetUrl, getPackTexture, texturesAvailable } from './textureLoader.js';

describe('textureLoader (V2)', () => {
  it('paket PNG\'lerini Vite URL\'si olarak indeksler', () => {
    const names = packAssetNames();
    expect(names).toContain('board');
    expect(names).toContain('card-back-chance');
    expect(names).toContain('token-crimson');
  });

  it('mantıksal varlık adını URL\'ye çözer (board-plate → board.png)', () => {
    expect(packAssetUrl('board-plate', 'property-tycoon')).toMatch(/board.*\.png$/);
    expect(packAssetUrl('board-plate')).toBeTruthy();
    expect(packAssetUrl('yok-boyle-bir-sey')).toBeNull();
  });

  it('DOM olmayan test ortamında dokular null döner (güvenli yedek)', () => {
    expect(texturesAvailable()).toBe(false);
    expect(getPackTexture('board-plate', { packId: 'property-tycoon' })).toBeNull();
  });
});
