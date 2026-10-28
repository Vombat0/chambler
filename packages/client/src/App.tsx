import { useEffect, useRef, useState } from 'react';
import { createScene } from './scene';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    createScene(canvas, { onFps: (f) => { if (!disposed) setFps(f); } })
      .then((c) => {
        if (disposed) c();
        else cleanup = c;
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
