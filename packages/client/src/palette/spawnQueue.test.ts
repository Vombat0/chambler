import { describe, expect, it } from 'vitest';
import { SPAWN_MAX_PER_FRAME, createSpawnQueue } from './spawnQueue.js';

describe('spawn queue (D2)', () => {
  it('kare başına en fazla bütçe kadar uygular', () => {
    const applied: number[] = [];
    const queue = createSpawnQueue<number>((value) => applied.push(value), 3);
    queue.push([1, 2, 3, 4, 5]);
    expect(queue.drainFrame()).toBe(3);
    expect(applied).toEqual([1, 2, 3]);
    expect(queue.pending()).toBe(2);
  });

  it('FIFO sırasını korur', () => {
    const applied: string[] = [];
    const queue = createSpawnQueue<string>((value) => applied.push(value), 10);
    queue.push(['a', 'b']);
    queue.push(['c']);
    queue.drainAll();
    expect(applied).toEqual(['a', 'b', 'c']);
  });

  it('pending bekleyen sayısını verir', () => {
    const queue = createSpawnQueue<number>(() => undefined, 2);
    expect(queue.pending()).toBe(0);
    queue.push([1, 2, 3]);
    expect(queue.pending()).toBe(3);
    queue.drainFrame();
    expect(queue.pending()).toBe(1);
  });

  it('drainAll tümünü uygular ve toplam sayıyı döndürür', () => {
    const applied: number[] = [];
    const queue = createSpawnQueue<number>((value) => applied.push(value), 4);
    queue.push([1, 2, 3, 4, 5, 6, 7]);
    expect(queue.drainAll()).toBe(7);
    expect(applied).toHaveLength(7);
    expect(queue.pending()).toBe(0);
  });

  it('clear uygulamadan boşaltır', () => {
    const applied: number[] = [];
    const queue = createSpawnQueue<number>((value) => applied.push(value), 4);
    queue.push([1, 2, 3]);
    queue.clear();
    expect(queue.pending()).toBe(0);
    expect(queue.drainAll()).toBe(0);
    expect(applied).toHaveLength(0);
  });

  it('bütçe en az 1 kare/spawn olacak şekilde düzeltilir', () => {
    expect(createSpawnQueue<number>(() => undefined, 0).drainFrame()).toBe(0);
    const applied: number[] = [];
    const queue = createSpawnQueue<number>((value) => applied.push(value), 0);
    queue.push([1, 2]);
    expect(queue.drainFrame()).toBe(1);
    expect(applied).toEqual([1]);
  });

  it('varsayılan bütçe 10’dur', () => {
    expect(SPAWN_MAX_PER_FRAME).toBe(10);
    let count = 0;
    const queue = createSpawnQueue<number>(() => { count++; });
    queue.push(Array.from({ length: 25 }, (_, index) => index));
    expect(queue.drainFrame()).toBe(10);
    expect(count).toBe(10);
  });
});
