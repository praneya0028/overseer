// ============================================================================
// OVERSEER — FROZEN CONTRACT (shared by server + client)
// Every interface below is the agreed interface between modules. Do not change
// shapes without updating both sides. Grounded against live cmux 2026-06-06.
// ============================================================================

// ---- Lifecycle (Channel A) ----
export type LifecycleState =
  | 'working'
  | 'idle'
  | 'waiting-permission'
  | 'waiting-question'
  | 'error'
  | 'done'
  | 'unknown';

// ---- Autopilot display state (Channel B) ----
export type AutopilotState = 'off' | 'armed' | 'acting';

export interface Telemetry {
  elapsedWorkingMs?: number; // since the agent last entered `working`
  cpuPercent?: number; // per-surface, from system.top surfaces[].resources
  memBytes?: number;
  ctxPct?: number; // parsed from viewport "ctx 126k/1M (13%)"
  processCount?: number;
}

export interface AgentOption {
  index: number; // 1-based, as shown on screen
  label: string;
}

// Canonical agent (one per controllable Claude surface, excluding self).
export interface Agent {
  id: string; // surface UUID — STABLE key
  surfaceRef: string; // "surface:N" — display/debug only, can shift
  windowId: string;
  workspaceId: string;
  title: string; // raw title incl. leading glyph
  name: string; // cleaned title (glyph stripped)
  glyph: string | null; // leading glyph if present
  agentType: string; // cmux coding-agent id: 'claude' | 'codex' | 'generic' | …
  agentLabel: string; // human label, e.g. 'Claude Code' | 'Codex' (cmux display_name)
  cwd?: string;
  model?: string; // e.g. "Opus 4.8 · 1M" (parsed from the agent's status footer)
  mode?: string; // e.g. "auto-accept" | "plan" | "normal"
  usage?: string; // free rate-limit usage from the footer, e.g. "5h 2% · 7d 15%"
  state: LifecycleState;
  autopilotEnabled: boolean; // per-agent toggle (independent of master)
  autopilot: AutopilotState; // effective display state for the ring/badge
  needsInput: boolean; // waiting-* AND not currently handled by autopilot
  question?: string; // extracted stem when waiting
  options?: AgentOption[]; // extracted numbered menu options
  viewportLines: string[]; // last ~6 lines for the tile body
  telemetry: Telemetry;
  lastUpdated: number; // epoch ms
  isTestAgent?: boolean; // force-registered dummy (verification only)
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface DecisionPayload {
  actionType: 'menu_choice' | 'send_text' | 'interrupt' | 'defer_to_human';
  optionIndex?: number | null;
  payload?: string | null;
  reasoning: string;
  confidence: number; // 0..1
  risk?: RiskLevel; // brain's own blast-radius assessment (gated server-side)
  reversible?: boolean; // can the action be cheaply undone?
}

// Standing orders — the human's written directive(s) the brain must obey when
// answering for them. Global persists across restarts; per-agent is keyed by
// surface id (session-scoped — surfaces are ephemeral).
export interface OrdersState {
  global: string;
  perAgent: Record<string, string>;
}

export type DecisionOutcome =
  | 'sent'
  | 'shadow' // computed but not sent (autopilot off / global shadow mode)
  | 'deferred'
  | 'destructive_defer'
  | 'low_confidence_defer'
  | 'aborted_screen_changed'
  | 'brain_timeout'
  | 'brain_error'
  | 'recalled'
  | 'rate_capped'
  | 'dedup_skip'
  | 'manual_answer'; // the human answered via Needs-You

export interface AutopilotDecision {
  id: string;
  agentId: string;
  agentTitle: string;
  cwd?: string;
  ts: number;
  trigger: 'stable_waiting' | 'notification_hook' | 'manual';
  detectedState: LifecycleState;
  question: string;
  options: AgentOption[];
  decision?: DecisionPayload;
  outcome: DecisionOutcome;
  actionSent?: string; // human-readable, e.g. "key:1 + enter"
  costUsd?: number;
  brainLatencyMs?: number;
  model?: string;
  humanOverride?: { action: string; ts: number } | null;
}

// ============================ WebSocket protocol ============================
// server -> client
export interface BrainModel {
  id: string;
  label: string;
}

export type ServerMessage =
  | { type: 'snapshot'; agents: Agent[]; master: boolean; cmuxOk: boolean; serverTime: number; shadowMode: boolean; brainModel: string; brainModels: BrainModel[]; orders: OrdersState }
  | { type: 'agents'; agents: Agent[] } // full current fleet each heartbeat
  | { type: 'agentScreen'; id: string; fullText: string } // expanded ("hot") surface
  | { type: 'decision'; decision: AutopilotDecision }
  | { type: 'decisionsInit'; decisions: AutopilotDecision[]; costTodayUsd: number }
  | { type: 'master'; master: boolean }
  | { type: 'brainModel'; model: string } // head-agent brain model changed
  | { type: 'orders'; orders: OrdersState } // standing orders changed
  | { type: 'cmux'; ok: boolean; message?: string }
  | { type: 'toast'; level: 'info' | 'error' | 'success'; text: string };

// client -> server
export type ClientMessage =
  | { type: 'subscribe'; visibleIds: string[]; expandedId: string | null }
  | { type: 'send'; surfaceId: string; text: string; confirmed: true } // confirmed = UI two-step guard passed
  | { type: 'answer'; surfaceId: string; text: string } // human answer from Needs-You
  | { type: 'interrupt'; surfaceId: string } // send Ctrl+C to the agent's terminal (stop what it's doing)
  | { type: 'setAutopilot'; surfaceId: string; enabled: boolean }
  | { type: 'setMaster'; enabled: boolean }
  | { type: 'setBrainModel'; model: string } // pick the head-agent brain model
  | { type: 'setOrders'; surfaceId: string | null; text: string } // null = global standing orders
  | { type: 'recallAll' };

// ============================ REST ============================
export interface HealthResponse {
  ok: boolean;
  version: string;
  uptimeS: number;
  agentsTracked: number;
  cmuxOk: boolean; // is the daemon's connection to cmux currently live?
  cmuxReady: boolean; // has ≥1 real poll landed AND the link is up (launcher gates on this)
}

export const OVERSEER_VERSION = '1.0.0';
