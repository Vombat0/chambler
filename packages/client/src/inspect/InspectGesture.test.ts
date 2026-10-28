import { describe, expect, it, vi } from 'vitest';
import { InspectGesture } from './InspectGesture';

/** Senkron sahte zamanlayıcı: schedule kayıtları manuel yürütülür. */
function makeEnv() {
  let time = 0;
  const pending: Array<{ fn: () => void; at: number; cancelled: boolean }> = [];
  const schedule = (fn: () => void, ms: number) => {
    const task = { fn, at: time + ms, cancelled: false };
    pending.push(task);
    return () => {
      task.cancelled = true;
    };
  };
  const now = () => time;
  const advance = (ms: number) => {
    time += ms;
    for (const t of [...pending]) {
      if (!t.cancelled && t.at <= time) {
        t.cancelled = true; // setTimeout gibi bir kez çalışır
        t.fn();
      }
    }
  };
  return { schedule, now, advance };
}

type Session = ReturnType<typeof makeEnv>;

function gesture(session: Session, onInspect: (t: { source: string; x: number; y: number }) => void): InspectGesture {
  return new InspectGesture({
    onInspect,
    maxMovePx: 4,
    maxHoldMs: 350,
    longPressMs: 500,
    longPressMaxMovePx: 10,
    now: session.now,
    schedule: session.schedule,
  });
}

const downRight = { pointerId: 1, pointerType: 'mouse', button: 2, x: 100, y: 100 };
const upRight = { pointerId: 1, x: 100, y: 100 };
const downTouch = { pointerId: 7, pointerType: 'touch', button: 0, x: 200, y: 200 };
const upTouch = { pointerId: 7, x: 200, y: 200 };

describe('InspectGesture — sağ tık vs sürükleme ayrımı', () => {
  it('hareketsiz, kısa sağ tık -> inspect (right-click)', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downRight);
    s.advance(120);
    g.pointerUp(upRight);
    expect(fired).toEqual(['right-click']);
  });

  it('349 ms sınırı içinde tetikler (koşul: sürenin <= maxHoldMs)', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downRight);
    s.advance(349);
    g.pointerUp(upRight);
    expect(fired).toEqual(['right-click']);
  });

  it('351 ms basılı tutulmuş sağ tık -> tetiklenmez (drag/orbit)', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downRight);
    s.advance(351);
    g.pointerUp(upRight);
    expect(fired).toEqual([]);
  });

  it('tam 350 ms sınır eşitliği tetikler (kural: süre <= 350)', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downRight);
    s.advance(350);
    g.pointerUp(upRight);
    expect(fired).toEqual(['right-click']);
  });

  it('tam 4 px hareket hâlâ inspect sayılır (<= eşiği)', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downRight);
    s.advance(100);
    g.pointerMove({ pointerId: 1, x: 100, y: 104 });
    g.pointerUp({ pointerId: 1, x: 100, y: 104 });
    expect(fired).toEqual(['right-click']);
  });

  it('5 px hareket orbit aittir, inspect tetiklenmez', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downRight);
    s.advance(80);
    g.pointerMove({ pointerId: 1, x: 104, y: 104 }); // ~5.66 px
    g.pointerUp({ pointerId: 1, x: 104, y: 104 });
    expect(fired).toEqual([]);
  });

  it('sol tuş (button 0, mouse) inspect tetiklemez', () => {
    const s = makeEnv();
    const cb = vi.fn();
    const g = gesture(s, cb);
    g.pointerDown({ pointerId: 1, pointerType: 'mouse', button: 0, x: 10, y: 10 });
    s.advance(50);
    g.pointerUp({ pointerId: 1, x: 10, y: 10 });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('InspectGesture — dokunmatik uzun basma (long press)', () => {
  it('500 ms hareketsiz dokunuş -> inspect (long-press)', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downTouch);
    s.advance(500);
    expect(fired).toEqual(['long-press']);
  });

  it('497 ms sonrası bırakma -> tetiklenmez (eşik henüz dolmadı)', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downTouch);
    s.advance(499); // zamanlayıcı 500'de; 499'da Yok tetik
    g.pointerUp(upTouch);
    expect(fired).toEqual([]);
  });

  it('basar ve uzun süre panyolu sürükler (>10 px) -> long-press iptal', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downTouch);
    s.advance(200);
    g.pointerMove({ pointerId: 7, x: 200, y: 240 }); // 40 px
    s.advance(400);
    expect(fired).toEqual([]);
  });

  it('hareket sonra eski konuma dönüp bırakma -> yine tetiklenmez', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downTouch);
    s.advance(100);
    g.pointerMove({ pointerId: 7, x: 200, y: 230 });
    g.pointerUp(upTouch);
    expect(fired).toEqual([]);
  });

  it('long-press sonrası pointerup ikinci tetikleme yapmaz (tek ateş)', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downTouch);
    s.advance(500);
    g.pointerUp(upTouch);
    s.advance(500);
    expect(fired).toEqual(['long-press']);
  });
});

describe('InspectGesture — oturum ve sıralama', () => {
  it('pointercancel ardışık iki sağ tık tetiklemez', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downRight);
    g.pointerCancel();
    g.pointerUp(upRight);
    s.advance(1000);
    expect(fired).toEqual([]);
  });

  it('ikinci parmak/press sırasında iç durum resetlenir (İkinci basış dizisi tamam)', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downRight);
    g.pointerDown({ pointerId: 2, pointerType: 'touch', button: 0, x: 5, y: 5 }); // bozma
    s.advance(320);
    g.pointerUp({ pointerId: 2, x: 5, y: 5 });
    expect(fired).toEqual([]);
    // temiz yeni oturum çalışır
    g.pointerDown(downRight);
    s.advance(100);
    g.pointerUp(upRight);
    expect(fired).toEqual(['right-click']);
  });

  it('touch oturumu tetiklemeden bırakıılırsa state temize döner', () => {
    const s = makeEnv();
    const fired: string[] = [];
    const g = gesture(s, (t) => fired.push(t.source));
    g.pointerDown(downTouch);
    s.advance(100);
    g.pointerUp(upTouch);
    expect(g.currentState).toBe('idle');
    s.advance(5000); // geç kalan long-press zamanlayıcısı ateş etmemeli
    expect(fired).toEqual([]);
  });
});
