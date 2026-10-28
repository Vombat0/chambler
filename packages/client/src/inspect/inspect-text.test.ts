import { describe, expect, it } from 'vitest';
import { seededHue, wrapText } from './inspect-text';
import { InspectPanelModel } from './InspectPanelModel';

describe('inspect-text — wrapText (deterministik satır kırma)', () => {
  it('kelimeleri satırlara böler, satır uzunluğu maxChars aşılmaz', () => {
    const lines = wrapText('a b c d e f g h i j k l m', 10, 10);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
    expect(lines.join(' ')).toBe('a b c d e f g h i j k l m');
  });

  it('satır limiti aşımında son satıra "…" eklenir', () => {
    const lines = wrapText('bir iki üç dört beş altı yedi', 8, 2);
    expect(lines.length).toBe(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
  });

  it('kisa metin tek satıra sığar, "…" eklenmez', () => {
    expect(wrapText('Kızıl Kule', 20, 3)).toEqual(['Kızıl Kule']);
  });

  it('maxChars tan uzun tekil kelime kırpılır', () => {
    const lines = wrapText('abcdefghij', 5, 3);
    expect(lines).toEqual(['abcde']);
  });

  it('aynı girdi aynı çıktıyı verir (deterministik)', () => {
    const a = wrapText('Chambler panel metni üç kelime', 9, 4);
    const b = wrapText('Chambler panel metni üç kelime', 9, 4);
    expect(a).toEqual(b);
  });
});

describe('inspect-text — seeded renk', () => {
  it('aynı id aynı hueyı verir, 0..359 aralığındadır', () => {
    expect(seededHue('card_demo')).toBe(seededHue('card_demo'));
    expect(seededHue('card_demo')).toBeGreaterThanOrEqual(0);
    expect(seededHue('card_demo')).toBeLessThan(360);
  });
});

describe('InspectPanelModel — panel etkileşim modeli', () => {
  const model = new InspectPanelModel();

  it('Escape -> close; diğer tuşlar none', () => {
    expect(model.keydown({ key: 'Escape' })).toBe('close');
    expect(model.keydown({ key: 'x', shiftKey: false })).toBe('none');
  });

  it('Ok tuşları pan adımı (40 px) verir', () => {
    expect(model.keydown({ key: 'ArrowDown', shiftKey: false })).toEqual({ type: 'pan', dx: 0, dy: 40 });
    expect(model.keydown({ key: 'ArrowLeft', shiftKey: false })).toEqual({ type: 'pan', dx: -40, dy: 0 });
    expect(model.keydown({ key: 'ArrowRight', shiftKey: false })).toEqual({ type: 'pan', dx: 40, dy: 0 });
    expect(model.keydown({ key: 'ArrowUp', shiftKey: false })).toEqual({ type: 'pan', dx: 0, dy: -40 });
  });

  it('Tab -> focus sonraki; Shift+Tab -> focus önce', () => {
    expect(model.keydown({ key: 'Tab' })).toEqual({ type: 'focus', prev: false });
    expect(model.keydown({ key: 'Tab', shiftKey: true })).toEqual({ type: 'focus', prev: true });
  });

  it('dış tıklama kapatır, panel içi tıklama kapatmaz', () => {
    const rect = { left: 100, top: 100, right: 500, bottom: 400 };
    expect(model.outsideClick(10, 200, rect)).toBe(true);
    expect(model.outsideClick(300, 200, rect)).toBe(false);
    expect(model.outsideClick(100, 100, rect)).toBe(false); // köşe sınır dahil
  });

  it('odak tuzağı: Tab ileri, Shift+Tab geri, çevresel döngü', () => {
    expect(model.nextFocusIndex(0, 3, false)).toBe(1);
    expect(model.nextFocusIndex(2, 3, false)).toBe(0); // sarma: sonraki->ilk
    expect(model.nextFocusIndex(0, 3, true)).toBe(2); // sarma: geri->son
    expect(model.nextFocusIndex(1, 3, true)).toBe(0);
  });

  it('odak yoksa (index -1) ilk, Shift+ ile son elemana gider', () => {
    expect(model.nextFocusIndex(-1, 3, false)).toBe(0);
    expect(model.nextFocusIndex(-1, 3, true)).toBe(2);
  });

  it('odak listesi boşsa 0 kalır', () => {
    expect(model.nextFocusIndex(0, 0, false)).toBe(0);
  });
});
