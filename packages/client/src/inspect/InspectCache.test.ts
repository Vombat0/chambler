import { describe, expect, it } from 'vitest';
import { InspectCache } from './InspectCache';

describe('InspectCache — yeniden üretmeme', () => {
  it('aynı anahtar ikinci kez istendiğinde factory tekrar çağrılmaz', () => {
    const cache = new InspectCache<HTMLCanvasElement>(8);
    let created = 0;
    const canvas1 = cache.obtain('card:a:1', () => {
      created++;
      return {} as HTMLCanvasElement;
    });
    const canvas2 = cache.obtain('card:a:1', () => {
      created++;
      return {} as HTMLCanvasElement;
    });
    expect(created).toBe(1);
    expect(canvas2).toBe(canvas1);
  });

  it('farklı anahtar farklı içerik üretir', () => {
    const cache = new InspectCache<{ id: string }>(8);
    let created = 0;
    const a = cache.obtain('card:a:1', () => { created++; return { id: 'a' }; });
    const b = cache.obtain('card:a:2', () => { created++; return { id: 'b' }; });
    expect(created).toBe(2);
    expect(a).not.toBe(b);
  });

  it('faceUp değişimi yeni anahtar üretir (kılıf değişimi)', () => {
    const cache = new InspectCache<{ face: string }>(8);
    const key = (id: string, faceUp: boolean) => `${id}:${faceUp ? 1 : 0}:`;
    let created = 0;
    cache.obtain(key('k1', true), () => { created++; return { face: 'up' }; });
    const flipped = cache.obtain(key('k1', false), () => { created++; return { face: 'down' }; });
    expect(created).toBe(2);
    expect(flipped.face).toBe('down');
  });

  it('invalidate sonrası içerik yeniden üretilir', () => {
    const cache = new InspectCache<{ n: number }>(8);
    let created = 0;
    cache.obtain('x', () => { created++; return { n: 1 }; });
    cache.invalidate('x');
    cache.obtain('x', () => { created++; return { n: 2 }; });
    expect(created).toBe(2);
  });

  it('limiti aşınca en eski kayıt düşer (LRU)', () => {
    const cache = new InspectCache<number>(3);
    cache.obtain('a', () => 1);
    cache.obtain('b', () => 2);
    cache.obtain('c', () => 3);
    cache.obtain('d', () => 4);
    expect(cache.size).toBe(3);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('d')).toBe(true);
  });
});

describe('InspectCache — LRU dokunuş', () => {
  it('get en son kullanılanı ömrünü uzatır', () => {
    const cache = new InspectCache<number>(3);
    cache.obtain('a', () => 1);
    cache.obtain('b', () => 2);
    cache.obtain('c', () => 3);
    cache.get('a'); // 'a' güncel
    cache.obtain('d', () => 4); // 'b' düşmelidir
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });
});
