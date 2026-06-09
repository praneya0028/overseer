// ============================================================================
// brain.ts — Overseer's head: a headless `claude -p` call that decides how to
// answer a stalled agent. Verified live 2026-06-06:
//   claude -p "<prompt>" --output-format json --model <opus|sonnet|haiku> --max-turns 2
//   → {result: "```json\n{...}\n```", total_cost_usd, ...}
//   (NOTE: --json-schema + --max-turns 1 yields result:null — DO NOT use it.
//    Plain prompt, parse JSON out of `result`, strip ``` fences.)
// ============================================================================

import { execFile } from 'node:child_process';
import { DecisionPayload, AgentOption } from '../shared/contract';

export const CLAUDE_BIN = process.env.CLAUDE_BIN || `${process.env.HOME}/.local/bin/claude`;

// The head-agent's brain model — selectable at runtime from the UI. Opus by
// default (the strongest model for decisions made on your behalf); Sonnet/Haiku
// are faster + cheaper. These three are the UI presets, but the model is just a
// `claude -p --model <id>` argument, so power users can point it at ANY model id
// via OVERSEER_BRAIN_MODEL (e.g. a snapshot/dated id) — it's used verbatim and,
// if not already a preset, is added to the picker so they can switch back to it.
export const BRAIN_MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];
let currentBrainModel = 'claude-opus-4-8';
if (process.env.OVERSEER_BRAIN_MODEL) {
  currentBrainModel = process.env.OVERSEER_BRAIN_MODEL;
  if (!BRAIN_MODELS.some((m) => m.id === currentBrainModel)) {
    BRAIN_MODELS.push({ id: currentBrainModel, label: currentBrainModel }); // custom → show in picker
  }
}
export function getBrainModel(): string {
  return currentBrainModel;
}
/** Set the brain model. Accepts any non-empty id so custom models work. */
export function setBrainModel(model: string): boolean {
  if (!model || typeof model !== 'string') return false;
  currentBrainModel = model;
  return true;
}
const BRAIN_TIMEOUT_MS = 60_000;

export interface BrainInput {
  cwd?: string;
  agentLabel?: string; // e.g. 'Claude Code' / 'Gemini CLI'
  question: string;
  options: AgentOption[];
  viewportTail: string; // last ~25 lines for context
  transcriptTail?: string; // deeper session history — what the agent has been DOING
  orders?: string; // the human's standing orders (global + per-agent)
  precedents?: { question: string; answer: string; byHuman: boolean }[]; // how similar questions got answered
}

export interface BrainResult {
  decision?: DecisionPayload;
  costUsd?: number;
  latencyMs: number;
  error?: string; // set when the call failed → caller defers to human
  timedOut?: boolean; // distinguish a timeout from a generic exec failure
}

function buildPrompt(input: BrainInput): string {
  const optionsBlock = input.options.length
    ? input.options.map((o) => `  ${o.index}. ${o.label}`).join('\n')
    : '(free-form text answer expected; no menu)';
  const ordersBlock = input.orders?.trim()
    ? `\nSTANDING ORDERS from the human — these override every default below. Follow them exactly:\n"""\n${input.orders.trim()}\n"""\n`
    : '';
  const precedentBlock = input.precedents?.length
    ? `\nPRECEDENT — how questions like this were answered before (match the human's style and choices):\n${input.precedents
        .map((p) => `- Q: ${p.question}\n  A (${p.byHuman ? 'by the HUMAN' : 'sent by you, accepted'}): ${p.answer}`)
        .join('\n')}\n`
    : '';
  const historyBlock = input.transcriptTail?.trim()
    ? `\nSession history (what the agent has been doing — infer the task and the human's intent from this):\n"""\n${input.transcriptTail.trim()}\n"""\n`
    : '';
  return `You are Overseer, the human's trusted delegate supervising an autonomous coding agent (${input.agentLabel || 'a coding agent'}). The agent has PAUSED waiting for a human answer. Your job is to keep the fleet MOVING: answer exactly as the human would, so they are interrupted only when truly necessary. You CANNOT run tools — you only choose a response.
${ordersBlock}${precedentBlock}
Decision policy — judge the ACTION, not the topic:
1. Infer what the agent is trying to accomplish from the session history, then pick the answer that best advances that goal.
2. Assess the blast radius of saying yes:
   - risk "low": reversible, sandboxed, routine (read files, run tests, install deps, edit working-tree code, create local branches). ANSWER these — deferring routine questions is a failure.
   - risk "medium": reversible but with side effects beyond the working tree (overwrite generated files, stop running processes, amend local commits). Answer only when the session history makes the right choice unambiguous.
   - risk "high": irreversible or shared-state (delete data, force-push, deploy, production, secrets/credentials/payments, anything you could not undo). NEVER answer — defer_to_human, always.
3. Defer ONLY for: high risk, a choice that hinges on the human's taste/intent you cannot infer from orders/history/precedent, or a question you genuinely cannot parse. Everything else, decide.
4. Prefer the plainly-correct option. For "Yes" vs "Yes, and don't ask again", choose plain "Yes". Never guess names of files/branches/resources you cannot see.
5. For numbered menus return menu_choice with the exact on-screen optionIndex. For free-form questions return send_text with a short, concrete answer.
6. "reversible" = could the human cheaply undo the result if you chose wrong.
7. confidence = probability the human would have given this same answer. Be honest — it is enforced.

Agent working directory: ${input.cwd || '(unknown)'}
${historyBlock}
Agent's detected question:
"""
${input.question}
"""
Options presented (index: label):
${optionsBlock}

Current screen (last lines — the question and any prompt box are here):
"""
${input.viewportTail}
"""

Respond with ONLY a JSON object (no prose, no markdown fences) of the form:
{"actionType":"menu_choice"|"send_text"|"interrupt"|"defer_to_human","optionIndex":<int or null>,"payload":<string or null>,"reasoning":"<short>","confidence":<0..1>,"risk":"low"|"medium"|"high","reversible":true|false}`;
}

function extractJson(result: string): any {
  // strip ```json ... ``` fences if present, then grab the first {...} block
  const fenced = result.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : result;
  const m = body.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON object in brain result');
  return JSON.parse(m[0]);
}

function coerceDecision(raw: any): DecisionPayload {
  const actionType = ['menu_choice', 'send_text', 'interrupt', 'defer_to_human'].includes(raw?.actionType)
    ? raw.actionType
    : 'defer_to_human';
  let d: DecisionPayload = {
    actionType,
    optionIndex: typeof raw?.optionIndex === 'number' ? raw.optionIndex : null,
    payload: typeof raw?.payload === 'string' ? raw.payload : null,
    reasoning: typeof raw?.reasoning === 'string' ? raw.reasoning.slice(0, 400) : '',
    confidence: typeof raw?.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0,
    // Missing risk fields default CONSERVATIVE (medium / irreversible) — an
    // older or sloppy model output must fall toward deferral, never toward action.
    risk: raw?.risk === 'low' || raw?.risk === 'medium' || raw?.risk === 'high' ? raw.risk : 'medium',
    reversible: typeof raw?.reversible === 'boolean' ? raw.reversible : false,
  };
  // belt-and-suspenders validation
  if (d.actionType === 'menu_choice' && (d.optionIndex === null || d.optionIndex === undefined)) {
    d = { ...d, actionType: 'defer_to_human' };
  }
  if (d.actionType === 'send_text' && !d.payload) {
    d = { ...d, actionType: 'defer_to_human' };
  }
  return d;
}

/** Run the brain. Never throws — failures come back as { error } so callers defer. */
export function runBrain(input: BrainInput, signal?: AbortSignal): Promise<BrainResult> {
  const started = Date.now();
  const prompt = buildPrompt(input);
  return new Promise((resolve) => {
    execFile(
      CLAUDE_BIN,
      ['-p', prompt, '--output-format', 'json', '--model', currentBrainModel, '--max-turns', '2'],
      { timeout: BRAIN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', signal },
      (err, stdout) => {
        const latencyMs = Date.now() - started;
        if (err && !stdout) {
          // execFile terminates the child on timeout (killed flag + SIGTERM) — surface that
          // as a distinct timeout so the log/UI can show it as such, not a generic error.
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          const timedOut = !!e.killed || e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT';
          resolve({ latencyMs, error: `brain exec failed: ${err.message}`, timedOut });
          return;
        }
        try {
          const outer = JSON.parse(stdout);
          const costUsd = typeof outer.total_cost_usd === 'number' ? outer.total_cost_usd : undefined;
          if (outer.is_error || typeof outer.result !== 'string') {
            resolve({ latencyMs, costUsd, error: `brain returned error/no result` });
            return;
          }
          const decision = coerceDecision(extractJson(outer.result));
          resolve({ decision, costUsd, latencyMs });
        } catch (e: any) {
          resolve({ latencyMs, error: `brain parse failed: ${e.message}` });
        }
      },
    );
  });
}
