import { describe, expect, it } from 'vitest';
import { validatePackManifest, type LogicalPackError } from './packValidation.js';

/** Minimal geçerli manifest (strict şema). */
function fixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    packId: 'test-pack',
    name: 'Test Pack',
    description: 'A minimal pack used by client tests.',
    version: '1.0.0',
    author: 'Tests',
    license: 'MIT',
    minEngineVersion: '0.1.0',
    players: { min: 1, max: 4 },
    assets: { plate: 'assets/plate.png', back: 'assets/back.png' },
    components: [
      { id: 'board', kind: 'board', assetRef: 'plate', count: 1 },
      { id: 'card-a', kind: 'card', assetRef: 'plate', count: 1 },
    ],
    board: { snapPoints: [{ id: 'cell-a', position: [0, 0, 0] }] },
    decks: [{ id: 'deck-a', faces: ['plate'], backAssetRef: 'back' }],
  };
}

function codes(errors: LogicalPackError[]): string[] {
  return errors.map((error) => error.code);
}

describe('pack manifest validation (D2)', () => {
  it('geçerli manifest kabul edilir', () => {
    const result = validatePackManifest(fixture());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.packId).toBe('test-pack');
  });

  it('gerçek property-tycoon manifesti geçerlidir', async () => {
    const { propertyTycoonManifest } = await import('./packSource.js');
    const manifest = propertyTycoonManifest();
    expect(manifest.packId).toBe('property-tycoon');
    expect(manifest.board?.snapPoints).toHaveLength(40);
    expect(manifest.decks).toHaveLength(2);
  });

  it('bilinmeyen üst düzey alan reddedilir', () => {
    const data = { ...fixture(), extra: true };
    const result = validatePackManifest(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codes(result.errors)).toContain('UNKNOWN_FIELD');
  });

  it('desteklenmeyen schemaVersion reddedilir', () => {
    const data = { ...fixture(), schemaVersion: 2 };
    const result = validatePackManifest(data);
    expect(result.ok).toBe(false);
  });

  it('tanımsız assetRef mantıksal olarak yakalanır', () => {
    const data = fixture();
    (data.components as Array<Record<string, unknown>>)[0]!.assetRef = 'missing';
    const result = validatePackManifest(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors.find((entry) => entry.code === 'ASSET_REF_UNKNOWN');
      expect(error?.field).toBe('components.0.assetRef');
    }
  });

  it('deste yüzü tanımsız varlığa işaret edemez', () => {
    const data = fixture();
    (data.decks as Array<Record<string, unknown>>)[0]!.faces = ['nope'];
    const result = validatePackManifest(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codes(result.errors)).toContain('ASSET_REF_UNKNOWN');
  });

  it('deste arka yüzü tanımsız varlığa işaret edemez', () => {
    const data = fixture();
    (data.decks as Array<Record<string, unknown>>)[0]!.backAssetRef = 'nope';
    const result = validatePackManifest(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.field === 'decks.backAssetRef')).toBe(true);
    }
  });

  it('yinelenen component id yakalanır', () => {
    const data = fixture();
    (data.components as Array<Record<string, unknown>>).push({ id: 'board', kind: 'board', assetRef: 'plate' });
    const result = validatePackManifest(data);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codes(result.errors)).toContain('ID_DUPLICATE');
  });

  it('yinelenen snap noktası id yakalanır', () => {
    const data = fixture();
    (data.board as { snapPoints: Array<Record<string, unknown>> }).snapPoints.push({
      id: 'cell-a',
      position: [1, 0, 0],
    });
    const result = validatePackManifest(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.field === 'board.snapPoints.1.id')).toBe(true);
    }
  });

  it('geçersiz varlık uzantısı şema tarafından reddedilir', () => {
    const data = fixture();
    (data.assets as Record<string, string>).plate = 'assets/plate.exe';
    const result = validatePackManifest(data);
    expect(result.ok).toBe(false);
  });

  it('mutlak varlık yolu reddedilir', () => {
    const data = fixture();
    (data.assets as Record<string, string>).plate = '/etc/passwd.png';
    const result = validatePackManifest(data);
    expect(result.ok).toBe(false);
  });

  it('bozuk JSON nesnesi hata listesi döndürür', () => {
    const result = validatePackManifest({ schemaVersion: 'one' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });
});
