/**
 * A5 cell-based placement (snap grid): square & hex GridModel, multi-layer
 * occupancy, Carcassonne-style tile edge matching, Monopoly-style board slots,
 * single-InstancedMesh highlight overlay and the interaction binding.
 */
export * from './GridModel.js';
export * from './TileEdges.js';
export * from './Occupancy.js';
export * from './BoardSlots.js';
export * from './GridManager.js';
export * from './HighlightRenderer.js';
export { bindGridToInteraction, type GridBinding, type GridBindingStats, type GridBindingOptions, type GridSnapTarget, type SnapTargetObject } from './bind.js';
