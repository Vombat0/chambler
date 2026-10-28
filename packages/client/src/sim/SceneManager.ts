import * as THREE from 'three';
import { PhysicsWorld } from './PhysicsWorld.js';
import { CameraController } from '../camera/CameraController.js';
import {
  rapierToTransform,
  applyTransformToMesh,
  cloneTransform,
  lerpTransform,
} from './transforms.js';
import type { Transform } from '@chambler/shared';

interface RegisteredBody {
  id: string;
  mesh: THREE.Object3D;
  rigidBody: import('@dimforge/rapier3d-compat').RigidBody;
  previous: Transform;
  current: Transform;
}

export interface SceneManagerOptions {
  demo?: boolean;
  onFps?: (fps: number) => void;
}

export interface SceneManagerLike {
  scene: {
    add(...objects: THREE.Object3D[]): unknown;
    remove(...objects: THREE.Object3D[]): unknown;
  };
  registerBody(id: string, mesh: THREE.Object3D, rigidBody: unknown): void;
  /** Kaldırılan gövdeyi kare döngüsünden çıkarır (silinen rapier gövdesine erişilmez). */
  unregisterBody?(id: string): void;
  physics: {
    createBody(id: string, opts: unknown): unknown;
    removeBody(id: string): void;
  };
}

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly physics: PhysicsWorld;
  readonly cameraController: CameraController;

  private readonly canvas: HTMLCanvasElement;
  private readonly clock = new THREE.Clock();
  private readonly bodies = new Map<string, RegisteredBody>();
  private readonly resizeHandler: () => void;
  private disposed = false;
  private frameCount = 0;
  private lastFpsTime = performance.now();
  private readonly onFps?: (fps: number) => void;
  private readonly demoEnabled: boolean;

  private constructor(
    canvas: HTMLCanvasElement,
    physics: PhysicsWorld,
    options: SceneManagerOptions,
  ) {
    this.canvas = canvas;
    this.physics = physics;
    this.onFps = options.onFps;
    this.demoEnabled = options.demo ?? true;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#1b2430');
    this.scene.fog = new THREE.Fog('#1b2430', 12, 30);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 4.5, 6);
    this.camera.lookAt(0, 0, 0);

    this.setupLights();
    this.setupTable();
    this.setupFloor();

    this.cameraController = new CameraController(this.camera, canvas);

    this.resizeHandler = () => this.resize();
    window.addEventListener('resize', this.resizeHandler);
    this.resize();

    if (this.demoEnabled) this.spawnDemo();

    this.startLoop();
  }

  static async create(
    canvas: HTMLCanvasElement,
    options: SceneManagerOptions = {},
  ): Promise<SceneManager> {
    const physics = await PhysicsWorld.create();
    return new SceneManager(canvas, physics, options);
  }

  registerBody(id: string, mesh: THREE.Object3D, rigidBody: import('@dimforge/rapier3d-compat').RigidBody): void {
    const t = rapierToTransform(rigidBody.translation(), rigidBody.rotation());
    const entry: RegisteredBody = {
      id,
      mesh,
      rigidBody,
      previous: cloneTransform(t),
      current: cloneTransform(t),
    };
    this.bodies.set(id, entry);
    this.scene.add(mesh);
  }

  private setupLights(): void {
    const ambient = new THREE.AmbientLight('#ffffff', 0.45);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight('#fff2dc', 1.1);
    key.position.set(5, 8, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
  }

  private setupTable(): void {
    const tableW = 8;
    const tableD = 6;
    const thickness = 0.12;

    const felt = this.createFeltTexture();
    const tableGeo = new THREE.BoxGeometry(tableW, thickness, tableD);
    const tableMat = new THREE.MeshStandardMaterial({
      map: felt,
      roughness: 0.9,
      metalness: 0.0,
    });
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.y = -thickness / 2;
    table.receiveShadow = true;
    table.castShadow = false;
    this.scene.add(table);

    // rim
    const rimMat = new THREE.MeshStandardMaterial({ color: '#3a2a1a', roughness: 0.8 });
    const rimH = 0.08;
    const rimT = 0.12;
    const rimGeoX = new THREE.BoxGeometry(tableW + rimT * 2, rimH, rimT);
    const rimGeoZ = new THREE.BoxGeometry(rimT, rimH, tableD);
    const rimPositions: Array<[number, number, number, 'x' | 'z']> = [
      [0, rimH / 2, -(tableD / 2 + rimT / 2), 'x'],
      [0, rimH / 2, tableD / 2 + rimT / 2, 'x'],
      [-(tableW / 2 + rimT / 2), rimH / 2, 0, 'z'],
      [tableW / 2 + rimT / 2, rimH / 2, 0, 'z'],
    ];
    for (const [x, y, z, kind] of rimPositions) {
      const geo = kind === 'x' ? rimGeoX : rimGeoZ;
      const mesh = new THREE.Mesh(geo, rimMat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // collider: fixed body whose top surface is y=0
    this.physics.createBody('table', {
      type: 'fixed',
      shape: { kind: 'box', halfExtents: { x: tableW / 2, y: thickness / 2, z: tableD / 2 } },
      transform: {
        position: { x: 0, y: -thickness / 2, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
      canSleep: false,
    });
  }

  private setupFloor(): void {
    const floorGeo = new THREE.PlaneGeometry(40, 40);
    const floorMat = new THREE.MeshStandardMaterial({ color: '#2a2f38', roughness: 1.0 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private createFeltTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#1f6b3a';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < size * size * 0.35; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.fillStyle =
          Math.random() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.07)';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 3);
    return tex;
  }

  private spawnDemo(): void {
    const count = 8;
    const colors = ['#e5533c', '#f2c94c', '#56ccf2', '#6fcf97', '#bb6bd9', '#f2994a'];
    for (let i = 0; i < count; i++) {
      const size = 0.5;
      const geo = new THREE.BoxGeometry(size, size, size);
      const mat = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length],
        roughness: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const x = (Math.random() - 0.5) * 3;
      const z = (Math.random() - 0.5) * 2;
      const y = 2 + i * 0.3;
      mesh.position.set(x, y, z);

      const id = `demo_${i}`;
      const body = this.physics.createBody(id, {
        type: 'dynamic',
        shape: { kind: 'box', halfExtents: { x: size / 2, y: size / 2, z: size / 2 } },
        transform: {
          position: { x, y, z },
          rotation: { w: 1, x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
        linearDamping: 0.05,
        angularDamping: 0.1,
      });
      this.registerBody(id, mesh, body.rigidBody);
    }
  }

  /**
   * Kaldırılan nesneyi kare döngüsünden çıkarır. `physics.removeBody` rapier
   * gövdesini serbest bırakır; kayıt silinmezse döngü serbest bırakılmış
   * gövdeyi okumaya çalışır (wasm borrow panic → "recursive use of an object").
   */
  unregisterBody(id: string): void {
    this.bodies.delete(id);
  }

  private startLoop(): void {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame(): void {
    if (this.disposed) return;
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const alpha = this.physics.step(delta);
    const stepped = this.physics.lastSteps > 0;

    for (const entry of this.bodies.values()) {
      if (stepped) {
        entry.previous = cloneTransform(entry.current);
        entry.current = rapierToTransform(
          entry.rigidBody.translation(),
          entry.rigidBody.rotation(),
        );
      }
      const t = stepped
        ? lerpTransform(entry.previous, entry.current, alpha)
        : entry.current;
      applyTransformToMesh(entry.mesh, t);
    }

    this.cameraController.update();
    this.renderer.render(this.scene, this.camera);

    this.frameCount += 1;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.onFps?.(this.frameCount);
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resizeHandler);
    this.cameraController.dispose();
    this.physics.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this.renderer.dispose();
  }
}