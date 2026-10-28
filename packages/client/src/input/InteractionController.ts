import * as THREE from 'three';
import type { ObjectDef } from "@chambler/shared";
import type { SceneManager } from '../sim/SceneManager.js';
import { ObjectManager } from '../object/ObjectManager.js';
import { ObjectEventEmitter } from '../object/ObjectEvents.js';
import { readDieFace } from '../object/DieReader.js';
import { Selection } from '../object/Selection.js';
import { TABLE_HALF_X, TABLE_HALF_Z } from '../camera/bounds.js';

export interface InteractionControllerOptions {
  localPlayerId?: string;
  onDieResult?: (id: string, value: number) => void;
}

interface DragState {
  primaryId: string;
  ids: string[];
  startPointer: THREE.Vector2;
  startPositions: Map<string, { x: number; z: number }>;
  lastPos: Map<string, { x: number; z: number; t: number }>;
  velocity: Map<string, { x: number; z: number }>;
}

export class InteractionController {
  readonly sceneManager: SceneManager;
  readonly objects: ObjectManager;
  readonly emitter: ObjectEventEmitter;
  readonly localPlayerId: string;

  private readonly canvas: HTMLCanvasElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly onDieResult?: (id: string, value: number) => void;

  private hoveredId: string | null = null;
  private selected = new Selection();
  private drag: DragState | null = null;
  private readonly diePending = new Set<string>();
  private readonly dieStable = new Map<string, number>();
  private readonly dieEmitted = new Set<string>();

  private readonly selectionRing: THREE.Mesh;
  private readonly hoverRing: THREE.Mesh;

  constructor(sceneManager: SceneManager, opts: InteractionControllerOptions = {}) {
    this.sceneManager = sceneManager;
    this.canvas = sceneManager.renderer.domElement;
    this.localPlayerId = opts.localPlayerId ?? 'local';
    this.onDieResult = opts.onDieResult;
    this.emitter = new ObjectEventEmitter();
    this.objects = new ObjectManager({
      localPlayerId: this.localPlayerId,
      sceneManager,
      emitter: this.emitter,
    });

    // selection/hover rings
    const ringGeo = new THREE.RingGeometry(0.35, 0.42, 32);
    const selMat = new THREE.MeshBasicMaterial({ color: '#4ea1ff', side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    const hovMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
    this.selectionRing = new THREE.Mesh(ringGeo, selMat);
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    sceneManager.scene.add(this.selectionRing);
    this.hoverRing = new THREE.Mesh(ringGeo, hovMat);
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    sceneManager.scene.add(this.hoverRing);

    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointerleave', this.handlePointerUp);
    window.addEventListener('keydown', this.handleKeyDown);

    // frame update hook via own RAF
    this.startUpdateLoop();
  }

  spawn(def: ObjectDef): void {
    this.objects.spawn(def);
  }

  private startUpdateLoop(): void {
    const tick = () => {
      if (this.sceneManager['disposed']) return;
      this.update();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private update(): void {
    // update rings
    if (this.hoveredId) {
      const mo = this.objects.get(this.hoveredId);
      if (mo) {
        this.hoverRing.visible = true;
        this.hoverRing.position.set(mo.mesh.position.x, 0.02, mo.mesh.position.z);
      }
    } else {
      this.hoverRing.visible = false;
    }
    // selection ring under first selected
    if (this.selected.size > 0) {
      const first = this.selected.toArray()[0]!;
      const mo = this.objects.get(first);
      if (mo) {
        this.selectionRing.visible = true;
        this.selectionRing.position.set(mo.mesh.position.x, 0.02, mo.mesh.position.z);
      }
    } else {
      this.selectionRing.visible = false;
    }

    // die monitoring
    for (const id of this.diePending) {
      const mo = this.objects.get(id);
      if (!mo || mo.held) continue;
      const body = mo.body.rigidBody;
      const lv = body.linvel();
      const av = body.angvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z) + Math.hypot(av.x, av.y, av.z);
      if (speed < 0.35) {
        const prev = this.dieStable.get(id) ?? 0;
        this.dieStable.set(id, prev + 1);
        if (prev + 1 >= 10 && !this.dieEmitted.has(id)) {
          this.dieEmitted.add(id);
          const t = this.sceneManager.physics.readTransform(mo.body);
          const value = readDieFace(t.rotation);
          mo.def.faceUp = mo.def.faceUp;
          this.emitter.emit('dieResult', { id, value });
          this.onDieResult?.(id, value);
          this.showDieResult(id, value);
        }
      } else {
        this.dieStable.set(id, 0);
      }
    }
  }

  private showDieResult(id: string, value: number): void {
    let el = document.getElementById('die-result-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'die-result-toast';
      el.style.position = 'fixed';
      el.style.top = '12px';
      el.style.right = '12px';
      el.style.padding = '8px 12px';
      el.style.background = 'rgba(0,0,0,0.7)';
      el.style.color = '#fff';
      el.style.borderRadius = '6px';
      el.style.fontFamily = 'sans-serif';
      el.style.zIndex = '9999';
      document.body.appendChild(el);
    }
    el.textContent = `Die ${id}: ${value}`;
    el.style.display = 'block';
    setTimeout(() => { if (el) el.style.display = 'none'; }, 2000);
  }

  private setPointer(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private raycastObjects(): string | null {
    this.raycaster.setFromCamera(this.pointer, this.sceneManager.camera);
    const meshes = this.objects.list().map((m) => m.mesh);
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length === 0) return null;
    // find managed object containing hit
    let obj: THREE.Object3D | null = hits[0]?.object ?? null;
    while (obj && !obj.userData.objectId) obj = obj.parent;
    return obj?.userData.objectId ?? null;
  }

  private planePoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.pointer, this.sceneManager.camera);
    const pt = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.plane, pt);
    return hit ? pt : null;
  }

  private clampToBounds(p: THREE.Vector3): void {
    const margin = 0.5;
    p.x = Math.max(-TABLE_HALF_X + margin, Math.min(TABLE_HALF_X - margin, p.x));
    p.z = Math.max(-TABLE_HALF_Z + margin, Math.min(TABLE_HALF_Z - margin, p.z));
    p.y = 0;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    this.setPointer(e);
    const hitId = this.raycastObjects();

    if (hitId === null) {
      if (!e.shiftKey) this.selected.clear();
      return;
    }

    if (e.shiftKey) {
      if (this.selected.has(hitId)) this.selected.delete(hitId);
      else this.selected.add(hitId);
    } else {
      if (!this.selected.has(hitId)) { this.selected.clear(); this.selected.add(hitId); }
    }

    // claim check
    if (this.objects.isLocked(hitId)) {
      // lock icon: simple alert via console; could show UI
      this.showLock();
      return;
    }
    const ok = this.objects.claim(hitId);
    if (!ok) {
      this.showLock();
      return;
    }

    // ensure selected contains hitId
    if (!this.selected.has(hitId)) this.selected.add(hitId);

    // start drag
    const pt = this.planePoint();
    if (!pt) return;
    this.clampToBounds(pt);
    const startPositions = new Map<string, { x: number; z: number }>();
    for (const id of this.selected.toArray()) {
      const mo = this.objects.get(id);
      if (mo) startPositions.set(id, { x: mo.mesh.position.x, z: mo.mesh.position.z });
    }
    // store offset per object? simpler: move group so primary follows pointer
    const primaryPos = this.objects.get(hitId)!.mesh.position;
    const offset = { x: primaryPos.x - pt.x, z: primaryPos.z - pt.z };

    // adjust startPositions to include offset
    const adjusted = new Map<string, { x: number; z: number }>();
    for (const id of this.selected.toArray()) {
      const sp = startPositions.get(id)!;
      adjusted.set(id, { x: sp.x, z: sp.z });
    }
    // We'll compute per-move delta from primary.
    this.drag = {
      primaryId: hitId,
      ids: this.selected.toArray(),
      startPointer: new THREE.Vector2(pt.x, pt.z),
      startPositions: adjusted,
      lastPos: new Map(),
      velocity: new Map(),
    };
    // store offset in primary start? We'll recompute in move using primary offset.
    (this.drag as unknown as { offset: { x: number; z: number } }).offset = offset;

    // set held kinematic
    for (const id of this.selected.toArray()) {
      this.objects.setHeld(id, true);
    }
    this.canvas.setPointerCapture?.(e.pointerId);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    this.setPointer(e);
    if (!this.drag) {
      // hover
      const hitId = this.raycastObjects();
      this.hoveredId = hitId;
      return;
    }
    const pt = this.planePoint();
    if (!pt) return;
    this.clampToBounds(pt);
    const drag = this.drag;
    const offset = (drag as unknown as { offset: { x: number; z: number } }).offset;
    const primaryTarget = { x: pt.x + offset.x, z: pt.z + offset.z };
    // clamp primary target
    const clampedPrimary = new THREE.Vector3(primaryTarget.x, 0, primaryTarget.z);
    this.clampToBounds(clampedPrimary);
    const delta = {
      x: clampedPrimary.x - drag.startPositions.get(drag.primaryId)!.x,
      z: clampedPrimary.z - drag.startPositions.get(drag.primaryId)!.z,
    };

    const now = performance.now();
    for (const id of drag.ids) {
      const mo = this.objects.get(id);
      if (!mo) continue;
      const sp = drag.startPositions.get(id)!;
      const nx = sp.x + delta.x;
      const nz = sp.z + delta.z;
      // clamp each
      const cx = Math.max(-TABLE_HALF_X + 0.5, Math.min(TABLE_HALF_X - 0.5, nx));
      const cz = Math.max(-TABLE_HALF_Z + 0.5, Math.min(TABLE_HALF_Z - 0.5, nz));
      mo.mesh.position.x = cx;
      mo.mesh.position.z = cz;
      mo.mesh.position.y = mo.mesh.position.y; // keep height
      // keep rigid body in sync
      mo.body.rigidBody.setTranslation({ x: cx, y: mo.mesh.position.y, z: cz }, true);
      // rotation unchanged
      mo.body.rigidBody.setRotation(
        { x: mo.mesh.quaternion.x, y: mo.mesh.quaternion.y, z: mo.mesh.quaternion.z, w: mo.mesh.quaternion.w },
        true,
      );
      // velocity estimate
      const prev = drag.lastPos.get(id);
      if (prev) {
        const dt = Math.max(1, now - prev.t) / 1000;
        drag.velocity.set(id, { x: (cx - prev.x) / dt, z: (cz - prev.z) / dt });
      }
      drag.lastPos.set(id, { x: cx, z: cz, t: now });

      // throttled transform emit
      const t = this.sceneManager.physics.readTransform(mo.body);
      this.emitter.emitTransformUpdate(id, t, { x: drag.velocity.get(id)?.x ?? 0, y: 0, z: drag.velocity.get(id)?.z ?? 0 }, now);
    }
  };

  private handlePointerUp = (_e: PointerEvent): void => {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;

    for (const id of drag.ids) {
      const mo = this.objects.get(id);
      if (!mo) continue;
      this.objects.setHeld(id, false);
      const v = drag.velocity.get(id) ?? { x: 0, z: 0 };
      // apply momentum
      try {
        mo.body.rigidBody.setLinvel({ x: v.x * 0.5, y: 0, z: v.z * 0.5 }, true);
      } catch {}
      this.objects.release(id);
      // die pending
      if (mo.def.kind === 'die') {
        this.diePending.add(id);
        this.dieStable.set(id, 0);
        this.dieEmitted.delete(id);
      }
      // transform emit final
      const t = this.sceneManager.physics.readTransform(mo.body);
      this.emitter.emitTransformUpdate(id, t, { x: v.x * 0.5, y: 0, z: v.z * 0.5 }, performance.now());
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const targets = this.drag ? this.drag.ids : this.selected.toArray();
    if (targets.length === 0) return;

    if (e.key === 'q' || e.key === 'Q') {
      for (const id of targets) this.rotateY(id, -15);
      e.preventDefault();
    } else if (e.key === 'e' || e.key === 'E') {
      for (const id of targets) this.rotateY(id, 15);
      e.preventDefault();
    } else if (e.key === 'r' || e.key === 'R') {
      for (const id of targets) {
        const mo = this.objects.get(id);
        if (mo && (mo.def.kind === 'card' || mo.def.kind === 'tile')) this.rotateY(id, 90);
      }
      e.preventDefault();
    } else if (e.key === 'f' || e.key === 'F') {
      for (const id of targets) {
        const mo = this.objects.get(id);
        if (mo && (mo.def.kind === 'card' || mo.def.kind === 'tile')) {
          this.objects.flip(id);
          // animate mesh rotation 180 around X
          mo.mesh.rotateX(Math.PI);
        }
      }
      e.preventDefault();
    }
  };

  private rotateY(id: string, degrees: number): void {
    const mo = this.objects.get(id);
    if (!mo) return;
    const rad = (degrees * Math.PI) / 180;
    mo.mesh.rotateY(rad);
    mo.body.rigidBody.setRotation(
      { x: mo.mesh.quaternion.x, y: mo.mesh.quaternion.y, z: mo.mesh.quaternion.z, w: mo.mesh.quaternion.w },
      true,
    );
  }

  private showLock(): void {
    let el = document.getElementById('lock-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lock-toast';
      el.style.position = 'fixed';
      el.style.top = '12px';
      el.style.left = '12px';
      el.style.padding = '6px 10px';
      el.style.background = 'rgba(180,0,0,0.7)';
      el.style.color = '#fff';
      el.style.borderRadius = '6px';
      el.style.fontFamily = 'sans-serif';
      el.style.zIndex = '9999';
      document.body.appendChild(el);
    }
    el.textContent = 'Locked';
    el.style.display = 'block';
    setTimeout(() => { if (el) el.style.display = 'none'; }, 1000);
  }

  // public helpers for tests
  getSelected(): string[] {
    return this.selected.toArray();
  }

  toggleSelection(id: string, multi: boolean): void {
    this.selected.click(id, multi);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerUp);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.sceneManager.scene.remove(this.selectionRing);
    this.sceneManager.scene.remove(this.hoverRing);
  }
}
