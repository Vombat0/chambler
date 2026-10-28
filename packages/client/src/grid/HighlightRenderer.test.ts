import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HighlightRenderer } from './HighlightRenderer.js';
import type { HighlightCell } from './GridManager.js';

function cells(): HighlightCell[] {
  return [
    { cell: { col: 0, row: 0 }, center: { x: 0.5, z: 0.5 }, valid: true },
    { cell: { col: 1, row: 0 }, center: { x: 1.5, z: 0.5 }, valid: false },
  ];
}

describe('HighlightRenderer', () => {
  it('renders N instances with valid/invalid colors on a single InstancedMesh', () => {
    const scene = new THREE.Scene();
    const r = new HighlightRenderer(scene, { maxCells: 4 });
    const mesh = scene.children[0]! as THREE.InstancedMesh;
    r.render(cells(), 1);
    expect(mesh.count).toBe(2);
    const m0 = mesh.instanceMatrix.count;
    expect(m0).toBe(4);
    const color = mesh.instanceColor!;
    const green = [color.array[0], color.array[1], color.array[2]] as const;
    const red = [color.array[3], color.array[4], color.array[5]] as const;
    // linear-sRGB values (three converts hex -> working color space)
    expect(green[1]).toBeGreaterThan(0.6); // g of #35d07f
    expect(green[0]).toBeLessThan(0.1);
    expect(red[0]).toBeGreaterThan(0.6); // r of #e0533c
    expect(red[1]).toBeLessThan(0.2);
  });

  it('clear hides the mesh without disposing it', () => {
    const scene = new THREE.Scene();
    const r = new HighlightRenderer(scene);
    const mesh = scene.children[0]! as THREE.InstancedMesh;
    r.render(cells(), 1);
    expect(mesh.visible).toBe(true);
    r.clear();
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
    r.render(cells(), 1);
    expect(mesh.visible).toBe(true);
  });

  it('dispose removes the mesh from the scene', () => {
    const scene = new THREE.Scene();
    const r = new HighlightRenderer(scene);
    r.dispose();
    expect(scene.children.length).toBe(0);
  });
});
