import * as THREE from 'three';

const rendererMap = new WeakMap<HTMLCanvasElement, THREE.WebGLRenderer>();

export function createScene(canvas: HTMLCanvasElement): void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  rendererMap.set(canvas, renderer);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1b2430');

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 2.2, 4.5);
  camera.lookAt(0, 0, 0);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#e5533c' }),
  );
  scene.add(cube);

  const table = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.2, 8),
    new THREE.MeshStandardMaterial({ color: '#3d4d63' }),
  );
  table.position.y = -0.9;
  scene.add(table);

  scene.add(new THREE.HemisphereLight('#ffffff', '#4a3521', 1.5));
  const key = new THREE.DirectionalLight('#ffffff', 1.8);
  key.position.set(4, 8, 2);
  scene.add(key);

  const resize = () => {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  const clock = new THREE.Clock();
  const render = () => {
    const dt = clock.getDelta();
    cube.rotation.y += dt * 0.8;
    cube.rotation.x += dt * 0.3;
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  };
  renderer.setAnimationLoop(render);
}

/** `createScene` ile aynı canvas çağrılmalı (unmount'ta). */
export function disposeScene(canvas: HTMLCanvasElement): void {
  const renderer = rendererMap.get(canvas);
  if (!renderer) return;
  renderer.setAnimationLoop(null);
  renderer.dispose();
  rendererMap.delete(canvas);
}
