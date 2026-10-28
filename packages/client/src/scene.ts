import { SceneManager } from './sim/SceneManager.js';

export interface CreateSceneOptions {
  demo?: boolean;
  onFps?: (fps: number) => void;
}

export async function createScene(
  canvas: HTMLCanvasElement,
  options: CreateSceneOptions = {},
): Promise<() => void> {
  const manager = await SceneManager.create(canvas, options);
  return () => manager.dispose();
}

/** Backwards-compatible no-op; disposal is handled by the function returned from createScene. */
export function disposeScene(_canvas: HTMLCanvasElement): void {
  // no-op
}
