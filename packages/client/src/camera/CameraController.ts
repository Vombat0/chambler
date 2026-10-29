import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA_TARGET_BOUNDS, clamp } from './bounds.js';

export class CameraController {
  readonly controls: OrbitControls;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.controls = new OrbitControls(camera, domElement);
    // Başlangıç perspektifini koru: sahne, kamerayı (0, 5.0, 5.2) konumunda
    // (0, 0.2, 0)'a baktırarak kurar; hedefi eşitleyip güncelleyerek
    // ~43° tatlı izometrik masa görünümünü sabitleriz.
    this.controls.target.set(0, 0.2, 0);
    this.controls.update();
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 12;
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.35;
    // Left button is reserved for A3 object selection; keep disabled here.
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    } as unknown as OrbitControls['mouseButtons'];

    this.controls.addEventListener('change', () => {
      const t = this.controls.target;
      t.x = clamp(t.x, CAMERA_TARGET_BOUNDS.minX, CAMERA_TARGET_BOUNDS.maxX);
      t.z = clamp(t.z, CAMERA_TARGET_BOUNDS.minZ, CAMERA_TARGET_BOUNDS.maxZ);
    });
  }

  update(): void {
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}