import { SceneManager } from './sim/SceneManager.js';
import { InteractionController } from './input/InteractionController.js';
import type { ObjectDef } from '@chambler/shared';

export interface CreateSceneOptions {
  demo?: boolean;
  onFps?: (fps: number) => void;
}

export async function createScene(
  canvas: HTMLCanvasElement,
  options: CreateSceneOptions = {},
): Promise<() => void> {
  const manager = await SceneManager.create(canvas, { ...options, demo: options.demo ?? false });
  const controller = new InteractionController(manager, { localPlayerId: 'local' });

  if (options.demo !== false) {
    // Spawn a few tabletop objects for interaction testing.
    const defs: ObjectDef[] = [
      {
        id: 'die_demo',
        kind: 'die',
        assetRef: '',
        transform: { position: { x: 0, y: 0.6, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        ownerId: null,
        locked: false,
        faceUp: true,
        meta: {},
      },
      {
        id: 'card_demo',
        kind: 'card',
        assetRef: '',
        transform: { position: { x: 1.2, y: 0.1, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        ownerId: null,
        locked: false,
        faceUp: true,
        meta: {},
      },
      {
        id: 'tile_demo',
        kind: 'tile',
        assetRef: '',
        transform: { position: { x: -1.2, y: 0.1, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        ownerId: null,
        locked: false,
        faceUp: true,
        meta: {},
      },
    ];
    for (const d of defs) controller.spawn(d);
  }

  return () => {
    controller.dispose();
    manager.dispose();
  };
}

/** Backwards-compatible no-op; disposal is handled by the function returned from createScene. */
export function disposeScene(_canvas: HTMLCanvasElement): void {
  // no-op
}
