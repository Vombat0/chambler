import { useEffect, useRef, useState } from 'react';
import type { ObjectDef } from '@chambler/shared';
import { SceneManager } from './sim/SceneManager';
import { InteractionController } from './input/InteractionController';
import { InspectController } from './inspect/InspectController';

// A6: inspect panelinin çalışabilir örnek verisi (2D yakın görünümün içeriği
// bu meta'dan üretilir). assets/ paketleri manifest'e göre henüz indirilmediği
// için görünüm prosedürel çizer; assetRef geldiğinde doku yolu buradan geçer.
const DEMO_DEFS: ObjectDef[] = [
  {
    id: 'die_demo',
    kind: 'die',
    assetRef: '',
    transform: { position: { x: 0.0, y: 0.6, z: -0.2 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {},
  },
  {
    id: 'card_demo',
    kind: 'card',
    assetRef: 'risk/i-build-kizil-kule',
    transform: { position: { x: 3.2, y: 0.05, z: 0.5 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: { name: 'Kızıl Kule', type: 'Bina Kartı', description: 'Üç tur boyunca saldırı zarını iki katına çıkarır; yıkılırsa bölge düşer.' },
  },
  {
    id: 'tile_demo',
    kind: 'tile',
    assetRef: 'carcassonne/yol-kavsagi',
    transform: { position: { x: -1.2, y: 0.05, z: 1.8 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: { name: 'Yol Kavşağı', edges: { north: 'yol', east: 'tarla', south: 'tarla', west: 'yol' }, rotation: 90 },
  },
  {
    id: 'board_demo',
    kind: 'board',
    assetRef: 'risk/orta-dunya',
    transform: { position: { x: -1.0, y: 0.06, z: -1.6 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: {
      name: 'Orta Dünya',
      slots: [
        { id: 'A1', position: { x: -2.5, y: -1.0, z: 0 } },
        { id: 'B1', position: { x: -1.0, y: -1.0, z: 0 } },
        { id: 'C1', position: { x: 0.5, y: -1.0, z: 0 } },
      ],
    },
  },
  {
    id: 'token_demo',
    kind: 'token',
    assetRef: 'generic/kervan-tokeni',
    transform: { position: { x: 2.4, y: 0.12, z: 1.6 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ownerId: null,
    locked: false,
    faceUp: true,
    meta: { name: 'Kervan', label: 'Kervan', count: 3 },
  },
];

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    SceneManager.create(canvas, { onFps: (f) => { if (!disposed) setFps(f); } })
      .then((manager) => {
        if (disposed) {
          manager.dispose();
          return;
        }
        // A6 bağlama: inspect controller InteractionController'dan ÖNCE bağlanır.
        // Çünkü sağ tuşa A3'ün pointerdown'ı (claim + drag) yerine inspect gesture'ı
        // öncelik kazanmalı, A3 zinciri sağ tuşta kesilir (stopImmediatePropagation).
        const managerPriv = manager as unknown as { renderer: typeof manager.renderer; frame: () => void };
        const inspect = new InspectController({
          camera: manager.camera,
          domElement: canvas,
          getObjects: () => controller.objects,
          pauseRender: () => manager.renderer.setAnimationLoop(null),
          resumeRender: () => manager.renderer.setAnimationLoop(() => managerPriv.frame()),
        });
        const controller = new InteractionController(manager, { localPlayerId: 'local' });
        for (const def of DEMO_DEFS) controller.spawn(def);

        // Headless doğrulama / hata ayıklama window'u (yalnızca tarayıcı).
        (window as unknown as Record<string, unknown>).__chambler = {
          inspect,
          objects: controller.objects,
          camera: manager.camera,
        };

        cleanup = () => {
          inspect.dispose();
          controller.dispose();
          manager.dispose();
        };
      })
      .catch((err) => {
        console.error(err);
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <strong>Chambler</strong>
        <span className="muted">masa · kamera · rapier fizik</span>
        <span className="fps">{fps} fps</span>
      </header>
      <canvas ref={canvasRef} className="table" />
    </div>
  );
}
