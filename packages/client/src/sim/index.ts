export { PhysicsWorld, PHYSICS_HZ, FIXED_DT } from './PhysicsWorld.js';
export type {
  BodyType,
  ShapeDesc,
  BoxShape,
  SphereShape,
  CreateBodyOptions,
  PhysicsBody,
} from './PhysicsWorld.js';
export { SceneManager } from './SceneManager.js';
export type { SceneManagerOptions } from './SceneManager.js';
export {
  rapierToTransform,
  applyTransformToMesh,
  cloneTransform,
  lerpTransform,
  clamp,
} from './transforms.js';
export { CameraController } from '../camera/CameraController.js';
export { CAMERA_TARGET_BOUNDS, clamp as clampToBounds } from '../camera/bounds.js';