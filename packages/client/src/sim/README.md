# sim API (A2)

- `SceneManager.create(canvas, opts)` — sahne + kamera + fizik; `dispose()`.
- `PhysicsWorld.create()` async — `createBody(id, opts)`, `removeBody(id)`, `step(dt?)` (60 Hz sabit, accumulator), `readTransform`.
- `registerBody(id, mesh, rigidBody)` — mesh'i sahneye ekler; her karede mesh-body esitler.
- Transform: `@chambler/shared` `Transform` ile birebir (position/rotation/scale).
- Kamera: sag tus orbit, orta tus pan, tekerlek zoom; sol tus A3'e ayrildi (devre disi).
- Demo: `?demo=0` ile kapatilir. Fizik uyku acik.