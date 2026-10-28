# Interaction (A3)

## Controls
- Left click: select object (raycast). Empty space clears selection.
- Shift+left click: toggle multi-selection.
- Left drag: move selected objects on table plane (y=0), clamped to table bounds.
- Q / E: rotate held/selected objects ±15° around Y.
- R: rotate card/tile 90°.
- F: flip card/tile (faceUp toggles, mesh rotates 180°).
- Right/middle mouse: camera orbit/pan (A2).

## Object events (ObjectEventEmitter)
- objectSpawn: ObjectDef
- objectClaim: { objectId, playerId, claimToken }
- objectRelease: { objectId, playerId }
- transformUpdate: { type, id, transform, velocity? } (throttled 20 Hz)
- flip: { objectId, faceUp }
- dieResult: { id, value }

## Ownership
- Local fake ownership table; claim fails if owned by another player (lock toast).
- Held objects become kinematic; on release dynamic + momentum.

## Dice
- On release, when angular/linear speed drops below threshold, top face
  (largest Y normal) is read and dieResult emitted + toast shown.

## Handed to B2
- Network transport, 20 Hz backbone, claimToken validation, late-join snapshot.
