/**
 * A5 visual verification demo (headless check, not part of the app).
 * URL: /src/grid/demo.html — shows the snap grid overlay; drag the yellow
 * tile: valid cells render green, the occupied cell is red, release snaps.
 */
import * as THREE from 'three';
import { SceneManager } from '../sim/SceneManager.js';
import { InteractionController } from '../input/InteractionController.js';
import { GridManager } from './GridManager.js';
import { HighlightRenderer } from './HighlightRenderer.js';
import { bindGridToInteraction } from './bind.js';
import type { ObjectDef } from '@chambler/shared';

const hud = document.getElementById('hud')!;

function def(id: string, kind: ObjectDef['kind'], x: number, y: number, z: number, color: string, meta: Record<string, unknown> = {}): ObjectDef {
  return {
    id,
    kind,
    assetRef: '',
    transform: { position: { x, y, z }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: { color, ...meta },
  };
}

const canvas = document.getElementById('cv') as HTMLCanvasElement;
const manager = await SceneManager.create(canvas, { demo: false });
const controller = new InteractionController(manager, { localPlayerId: 'local' });

const grid = new GridManager(
  { shape: 'square', originX: -3.6, originZ: -2.8, cellSize: 0.8, bounds: { cols: 9, rows: 7 } },
  { snapPoints: [{ id: 'go', position: [3.2, 0, 1.6] }] },
);
grid.attachHighlightRenderer(new HighlightRenderer(manager.scene, { maxCells: 256 }));

// one tile is colored to be draggable; a tile-layer blocker turns its cell RED
controller.spawn(def('draggable', 'tile', -2.6, 0.12, -1.8, '#ffd23f'));
controller.spawn(def('blocker', 'tile', 0, 0.12, -0.8, '#8c8cf0')); // cell (4,2) on the tile layer
grid.place({ objectId: 'blocker', cell: { col: 4, row: 2 }, layer: 'tile' });
const binding = bindGridToInteraction(grid, controller as unknown as Parameters<typeof bindGridToInteraction>[1], { useSlots: true });

/** Screen pixel coords of a world point (for scripted drag). */
function project(x: number, y: number, z: number): { x: number; y: number } {
  const v = new THREE.Vector3(x, y, z).project(manager.camera);
  return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * canvas.clientHeight };
}

(window as unknown as Record<string, unknown>).__a5 = {
  controller,
  grid,
  binding,
  project,
  hud: (text: string) => (hud.textContent = text),
};

let frames = 0;
manager.cameraController.controls.target.set(0, 0, 0);
manager.camera.position.set(0, 9.5, 4.2);
manager.camera.lookAt(0, 0, 0);
renderer_loop();

function renderer_loop(): void {
  frames += 1;
  if (frames % 12 === 0) {
    const t = controller.objects.get('draggable');
    const b = binding.stats;
    hud.textContent =
      `A5 snap-grid demo  |  binding: snap=${b.snapped} reject=${b.rejected} free=${b.freed}` +
      (t ? `  |  draggable at (${t.mesh.position.x.toFixed(2)}, ${t.mesh.position.z.toFixed(2)})` : '');
  }
  requestAnimationFrame(renderer_loop);
}
