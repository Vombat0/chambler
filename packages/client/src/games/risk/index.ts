/**
 * R2 — Territory Wars (Risk) oyun paketi.
 * Dış dünyaya tek giriş noktası: <RiskGameView /> ve saf motor API'si.
 */

export { RiskGameView, type RiskGameViewProps } from './RiskGameView';
export {
  createInitialState,
  computeDeployPool,
  continentBonus,
  continentOwner,
  ownedTerritories,
  armyCount,
  areConnected,
  canDeploy,
  deploy,
  goToAttack,
  canAttack,
  attack,
  rollDice,
  confirmCapture,
  canFortify,
  fortify,
  goToFortify,
  endTurn,
  trade,
  canTrade,
  findTradeSet,
  isValidSet,
  tradeValue,
  currentPlayer,
  alivePlayers,
  STARTER_BONUS,
} from './riskEngine';
export type {
  Phase,
  RiskState,
  RiskPlayer,
  RiskCard,
  Territory,
  CapturePending,
  AttackOutcome,
  PlayerSetup,
} from './riskEngine';
export { CANVAS, CONTINENTS, REGION_IDS, REGION_COUNT, buildShapes } from './boardData';
export { aiStep } from './ai';
