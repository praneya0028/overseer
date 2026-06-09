// ============================================================================
// Internal server module contracts. index.ts wires Fleet + Autopilot together
// and to the WebSocket. Implementers fill the class bodies in poller.ts /
// state.ts (Fleet) and autopilot.ts (Autopilot) WITHOUT changing these shapes.
// ============================================================================

import { EventEmitter } from 'node:events';
import { Agent, AutopilotDecision } from '../shared/contract';

// Fleet events (EventEmitter):
//   'agents'  (agents: Agent[])               — emitted each heartbeat with the full fleet
//   'screen'  ({ id, fullText }: ScreenPush)  — emitted for the expanded ("hot") surface
//   'cmux'    (ok: boolean, message?: string) — cmux reachability changed
//   'waiting' (agent: Agent)                  — an agent reached a STABLE waiting-input state
export interface ScreenPush {
  id: string;
  fullText: string;
}

export interface IFleet extends EventEmitter {
  start(): void;
  stop(): void;
  getAgents(): Agent[];
  getAgent(id: string): Agent | undefined;
  /** Last full viewport text for a surface (for the expanded view). */
  getFullScreen(id: string): string | undefined;
  /** Client viewport subscription — drives adaptive poll cadence / pausing. */
  setView(visibleIds: string[], expandedId: string | null): void;
  /** Force-classify a surface id as a controllable agent (verification only). */
  registerTestAgent(surfaceId: string): void;
}

// Autopilot events (EventEmitter):
//   'decision' (d: AutopilotDecision)  — a decision was made/logged (sent, deferred, shadow, …)
//   'agentchange' ()                   — per-agent enabled flag or master changed (UI refresh)
export interface IAutopilot extends EventEmitter {
  /** Called by index.ts whenever the Fleet reports a stable waiting agent. */
  onWaiting(agent: Agent): void;
  setMaster(enabled: boolean): void;
  getMaster(): boolean;
  setAgentEnabled(surfaceId: string, enabled: boolean): void;
  isAgentEnabled(surfaceId: string): boolean;
  /** Effective autopilot display-state for a given agent (off/armed/acting). */
  displayState(surfaceId: string): 'off' | 'armed' | 'acting';
  recallAll(): void;
  /** Human answered a waiting agent via Needs-You — record + send. */
  humanAnswer(surfaceId: string, text: string): Promise<void>;
  getDecisions(): AutopilotDecision[];
  getCostToday(): number;
  /** True when running in shadow mode (decide + log but never auto-send). */
  isShadowMode(): boolean;
}
