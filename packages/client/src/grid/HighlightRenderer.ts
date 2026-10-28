/**
 * Grid highlight renderer (A5). ONE InstancedMesh + ONE PlaneGeometry for the
 * whole overlay: a single draw call, per-instance color via instanceColor and
 * no geometry rebuild while dragging — comfortably fast for 200 cells.
 * (Alternative — merging one BufferGeometry per highlight change — would force
 * a full vertex rebuild on every pointer move; InstancedMesh only rewrites
 * instance matrices/colors, so it is cheaper and simpler here.)
 */

import * as THREE from 'three';
import type { HighlightCell } from './GridManager.js';

export interface HighlightRendererOptions {
  maxCells?: number;
  height?: number;
  opacity?: number;
  validColor?: number;
  invalidColor?: number;
}

const GREEN = 0x35d07f;
const RED = 0xe0533c;

export class HighlightRenderer {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private readonly validColor: THREE.Color;
  private readonly invalidColor: THREE.Color;
  private disposed = false;

  constructor(scene: THREE.Scene, opts: HighlightRendererOptions = {}) {
    this.scene = scene;
    const max = opts.maxCells ?? 256;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: opts.opacity ?? 0.4,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(max * 3).fill(1),
      3,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.visible = false;
    this.validColor = new THREE.Color(opts.validColor ?? GREEN);
    this.invalidColor = new THREE.Color(opts.invalidColor ?? RED);
    scene.add(this.mesh);
  }

  /** Re-draws the overlay from scratch each update (call on drag move / release). */
  render(cells: HighlightCell[], cellSize: number): void {
    if (this.disposed) return;
    const scale = cellSize * 0.96;
    const n = Math.min(cells.length, this.mesh.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const h = cells[i]!;
      this.dummy.position.set(h.center.x, 0.02, h.center.z);
      this.dummy.quaternion.copy(this.tilt);
      this.dummy.scale.set(scale, scale, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, h.valid ? this.validColor : this.invalidColor);
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    if (this.disposed) return;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
