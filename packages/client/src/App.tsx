import { useEffect, useRef, useState } from 'react';
import { createScene, disposeScene } from './scene';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState(0);

  // Boş Three.js sahnesi: dönen küp. Fizik/nesneler A2/A3 gelir.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(frames);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    createScene(canvas);
    return () => {
      cancelAnimationFrame(raf);
      disposeScene(canvas);
    };
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <strong>Chambler</strong>
        <span className="muted">masa iskeleti · sahne A2'de gelişecek</span>
        <span className="fps">{fps} fps</span>
      </header>
      <canvas ref={canvasRef} className="table" />
    </div>
  );
}
