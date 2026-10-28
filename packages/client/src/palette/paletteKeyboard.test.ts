import { describe, expect, it } from 'vitest';
import { cycleCategory, moveGridIndex, paletteKeyAction } from './paletteKeyboard.js';

describe('palette keyboard navigation (D2)', () => {
  it('Esc her bağlamda kapatır', () => {
    expect(paletteKeyAction('Escape', 'panel')).toBe('close');
    expect(paletteKeyAction('Escape', 'tabs')).toBe('close');
    expect(paletteKeyAction('Escape', 'items')).toBe('close');
  });

  it('Enter ve Boşluk yalnızca öğe ızgarasında ekler', () => {
    expect(paletteKeyAction('Enter', 'items')).toBe('add');
    expect(paletteKeyAction(' ', 'items')).toBe('add');
    expect(paletteKeyAction('Enter', 'tabs')).toBe('none');
    expect(paletteKeyAction('Enter', 'panel')).toBe('none');
  });

  it('sekmelerde oklar kategori değiştirir', () => {
    expect(paletteKeyAction('ArrowLeft', 'tabs')).toBe('previousCategory');
    expect(paletteKeyAction('ArrowRight', 'tabs')).toBe('nextCategory');
    expect(paletteKeyAction('ArrowUp', 'tabs')).toBe('none');
  });

  it('ızgarada oklar öğe değiştirir', () => {
    expect(paletteKeyAction('ArrowLeft', 'items')).toBe('previousItem');
    expect(paletteKeyAction('ArrowRight', 'items')).toBe('nextItem');
    expect(paletteKeyAction('ArrowUp', 'items')).toBe('previousItem');
    expect(paletteKeyAction('ArrowDown', 'items')).toBe('nextItem');
  });

  it('Home/End uçlara gider', () => {
    expect(paletteKeyAction('Home', 'items')).toBe('firstItem');
    expect(paletteKeyAction('End', 'items')).toBe('lastItem');
    expect(paletteKeyAction('Home', 'tabs')).toBe('none');
  });

  it('bilinmeyen tuş yok sayılır', () => {
    expect(paletteKeyAction('z', 'items')).toBe('none');
    expect(paletteKeyAction('Tab', 'items')).toBe('none');
  });

  it('ızgara sağa/sola sarar', () => {
    expect(moveGridIndex(0, 6, 'left', 3)).toBe(5);
    expect(moveGridIndex(5, 6, 'right', 3)).toBe(0);
    expect(moveGridIndex(1, 6, 'right', 3)).toBe(2);
  });

  it('ızgara yukarı/aşağı sütun sayısı kadar kayar', () => {
    expect(moveGridIndex(0, 6, 'down', 3)).toBe(3);
    expect(moveGridIndex(4, 6, 'down', 3)).toBe(1);
    expect(moveGridIndex(4, 6, 'up', 3)).toBe(1);
    expect(moveGridIndex(1, 6, 'up', 3)).toBe(4);
  });

  it('sütun sayısı en az 1 kabul edilir', () => {
    expect(moveGridIndex(2, 5, 'down', 0)).toBe(3);
    expect(moveGridIndex(2, 5, 'up', -4)).toBe(1);
  });

  it('boş ızgarada indeks 0 döner', () => {
    expect(moveGridIndex(3, 0, 'right', 3)).toBe(0);
  });

  it('kategori döngüseldir ve bilinmeyen kategori ilkine düşer', () => {
    const categories = ['a', 'b', 'c'] as const;
    expect(cycleCategory(categories, 'a', -1)).toBe('c');
    expect(cycleCategory(categories, 'c', 1)).toBe('a');
    expect(cycleCategory(categories, 'z' as 'a', 1)).toBe('a');
  });
});
