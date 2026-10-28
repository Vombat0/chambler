/**
 * D1 — Ayarları sahneye uygulama (saf dönüşüm + hafif CLI benzeri applier).
 *
 * SceneManager ve OrbitControls sözleşmesine dokunmadan, App bağlama
 * noktasından uygulanmak üzere konfigürasyon üretir.
 */

export type ShadowQuality = 'low' | 'medium' | 'high';

export interface ShadowConfig {
  readonly enabled: boolean;
  /** `renderer.shadowMap.type` seçimi (sadece okumak için döner). */
  readonly soft: boolean;
  /** Piksel oranı tavanı: gölge kalitesi arttıkça keskinlik artar. */
  readonly dprCap: number;
}

/** Gölge kalitesi → render parametreleri (saf; test edilebilir). */
export function shadowQualityToConfig(quality: ShadowQuality): ShadowConfig {
  switch (quality) {
    case 'low':
      return { enabled: true, soft: false, dprCap: 1 };
    case 'medium':
      return { enabled: true, soft: true, dprCap: 1.5 };
    case 'high':
    default:
      return { enabled: true, soft: true, dprCap: 2 };
  }
}

/** Kamera hassasiyeti → OrbitControls `rotateSpeed` (saf; test edilebilir). */
export function sensitivityToSpeed(sensitivity: number): number {
  if (!Number.isFinite(sensitivity) || sensitivity <= 0) return 0.08;
  return Math.min(2, Math.max(0.2, sensitivity)) * 0.08;
}

interface OrbitControlsLike {
  rotateSpeed: number;
  zoomSpeed: number;
}

interface SceneLike {
  traverse: (callback: (object: { castShadow?: boolean; receiveShadow?: boolean }) => void) => void;
}

export interface RenderTargetsLike {
  /** OrbitControls benzeri dönüş/zoom hızı ayarlanabilen kontrol kümesi. */
  controls: OrbitControlsLike;
  renderer: {
    shadowMap: { enabled: boolean; type: unknown };
  };
  scene: SceneLike;
}

/**
 * Sahne bağlama noktasına ayarları uygular. Sahne yüklenmemişse yoksayılır.
 * App, SceneManager'ın `cameraController.controls | renderer | scene`
 * üçlüsünü bu yapıya uyarlayarak çağırır.
 */
export function applySettingsToScene(
  manager: RenderTargetsLike,
  settings: {
    cameraSensitivity: number;
    shadowQuality: ShadowQuality;
  },
): void {
  const speed = sensitivityToSpeed(settings.cameraSensitivity);
  manager.controls.rotateSpeed = speed;
  manager.controls.zoomSpeed = speed;

  const shadow = shadowQualityToConfig(settings.shadowQuality);
  manager.renderer.shadowMap.enabled = shadow.enabled;
  manager.renderer.shadowMap.type = (shadow.soft ? 'PCFSoftShadowMap' : 'PCFShadowMap') as unknown;
  manager.scene.traverse((object) => {
    object.castShadow = shadow.enabled;
    object.receiveShadow = shadow.enabled;
  });
}
