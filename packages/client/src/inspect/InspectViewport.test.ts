import { describe, expect, it } from 'vitest';
import { InspectViewport, ZOOM_LIMITS } from './InspectViewport';

describe('InspectViewport — zoom sınırları (0.5x–4x)', () => {
  it('default limitler 0.5 ve 4', () => {
    expect(ZOOM_LIMITS.minZoom).toBe(0.5);
    expect(ZOOM_LIMITS.maxZoom).toBe(4);
  });

  it('tekerlek aşağı (deltaY>0) zoom azaltır, 0.5 altına inmez', () => {
    const vp = new InspectViewport();
    vp.setZoom(0.55);
    for (let i = 0; i < 20; i++) vp.wheel(100);
    expect(vp.zoom).toBe(0.5);
  });

  it('tekerlek yukarı (deltaY<0) zoom artırır, 4 üstüne çıkmaz', () => {
    const vp = new InspectViewport();
    for (let i = 0; i < 40; i++) vp.wheel(-100);
    expect(vp.zoom).toBe(4);
  });

  it('setZoom sınır aşımı yakın değer kestirisine sabitlenir', () => {
    const vp = new InspectViewport();
    vp.setZoom(99);
    expect(vp.zoom).toBe(4);
    vp.setZoom(0.01);
    expect(vp.zoom).toBe(0.5);
  });

  it('sınırda ekstra wheel zoom değiştirmez', () => {
    const vp = new InspectViewport();
    vp.setZoom(4);
    const before = vp.zoom;
    vp.wheel(-100);
    expect(vp.zoom).toBe(before);
  });

  it('reset() zoom ve pan sıfırlar', () => {
    const vp = new InspectViewport();
    vp.wheel(-100);
    vp.panBy(30, 30, 1000, 1000, 400, 400);
    vp.reset();
    expect(vp.zoom).toBe(1);
    expect(vp.offsetX).toBe(0);
    expect(vp.offsetY).toBe(0);
  });
});

describe('InspectViewport — pan sınırları', () => {
  it('içerik viewporttan büyükse pan merkezi yarı fazla kırpi sınırlanır', () => {
    const vp = new InspectViewport();
    // içerik 1200x900, view 400x400: maxPan = (1200-400)/2 = 400 px
    vp.panBy(5000, 0, 1200, 900, 400, 400);
    expect(vp.offsetX).toBe(400);
    expect(vp.offsetY).toBe(0);
  });

  it('pan negatif yöne de sınırlanır', () => {
    const vp = new InspectViewport();
    vp.panBy(-5000, -9999, 1200, 900, 400, 400);
    expect(vp.offsetX).toBe(-400);
    expect(vp.offsetY).toBe(-250);
  });

  it('zoom edilmiş içerik viewdan küçükse pan yalnız merkez olur', () => {
    const vp = new InspectViewport();
    vp.panBy(500, 500, 300, 200, 400, 400); // içerik < view: pan olmamalı
    expect(vp.offsetX).toBe(0);
    expect(vp.offsetY).toBe(0);
  });

  it('maxPan değeri (content - view)/2 formülüyle hizalıdır', () => {
    const vp = new InspectViewport();
    expect(vp.maxPan(1200, 400)).toBe(400);
    expect(vp.maxPan(200, 400)).toBe(0);
  });

  it('panBy kümülatiftir', () => {
    const vp = new InspectViewport();
    vp.panBy(10, 20, 1200, 900, 400, 400);
    vp.panBy(10, 20, 1200, 900, 400, 400);
    expect(vp.offsetX).toBe(20);
    expect(vp.offsetY).toBe(40);
  });
});
