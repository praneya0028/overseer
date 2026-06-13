// ============================================================================
// state.ts — PURE state-derivation from a surface's viewport text + title glyph.
// No I/O. Grounded against live Claude Code renders 2026-06-06.
//
// Ground truth corrections baked in:
//   - `✳` (U+2733) on a title = an IDLE claude agent; a BRAILLE spinner
//     (U+2800–28FF) = WORKING; NO glyph + no claude chrome = not an agent.
//   - viewport is the source of truth; glyph is a cheap pre-filter.
//   - permission/question regexes were not captured on a real agent in recon →
//     they are validated via the fake-agent fixture before live autopilot send.
// ============================================================================

import crypto from 'node:crypto';
import { LifecycleState, AgentOption } from '../shared/contract';
import { RawSurface, RawResources } from './cmux';

const CLAUDE_GLYPH = /^[⠀-⣿✳✻⏺]/; // braille | ✳ | ✻ | ⏺
const BRAILLE = /[⠀-⣿]/;

export const CHROME = {
  AUTO_MODE: /⏵⏵\s*auto mode/i,
  // Footer = a model name (friendly OR raw id — Fable sessions show either
  // "Fable 5 | …" or "claude-fable-5[1m] | …") followed by the ctx meter.
  STATUS_FOOTER: /\b(Opus|Sonnet|Haiku|Fable|claude-[\w.[\]-]+)\b.*\bctx\s+[\d.]+[kKmM]?\s*\/\s*\d+[MKB]/i,
  COMPOSER: /^[─—]{12,}\s*$/m,
};

const SPINNER_ACTIVE =
  /(esc to interrupt|Running \d+ (shell|tool|command)|\(\s*\d+m?\s?\d*s?\s*·\s*[↑↓⇡⇣]\s*[\d.]+k?\s*tokens?)/i;
const SPINNER_WORD = /[✻✶✳✷✺⏺✽✢❋∗·]\s+[A-Z][a-z]+(?:ing|ed|…)/;
const IDLE_PROMPT = /(^|\n)\s*❯\s*[ \s]*(\n|$)/;
const DONE_PAT = /\b(done|complete[d]?|finished|all set|✅)\b/i;
const ERROR_PAT =
  /(Traceback \(most recent call last\)|^Error:|\bException\b|FAILED|fatal:|npm ERR!|command not found|panic:|✗)/m;

// Permission / question prompts (validated against the fake-agent fixture).
const PERMISSION_BOX =
  /(Do you want to (proceed|make|create|run|allow|continue)|Yes, and don'?t ask again|Yes, allow|No, and tell)/i;
// Border-tolerant: options may be wrapped in a box ("│ ❯ 1. Yes │").
const NUMBERED_OPTION = /^\s*[│┃|]?\s*(❯\s*)?(\d+)\.\s+(.+?)\s*[│┃|]?\s*$/;
const CTX_PCT = /\bctx\s+[\d.]+[kKmM]?\s*\/\s*[\d.]+[kKmMB]+\s*\((\d+)%\)/i;
const ELAPSED_TOKENS = /\(\s*\d+m?\s?\d*s?\s*·.*tokens?.*?\)/gi;
const WORKING_FOR = /[✻✶✳✷✺✽✢❋∗]\s+[A-Za-z]+\s+for\s+\d+s/gi;

const RULE_LINE = (l: string): boolean => {
  const t = l.trim();
  if (t.length < 8) return false;
  const ruleChars = (t.match(/[─—=_~·•+|╭╮╰╯│┃-]/g) || []).length;
  return ruleChars / t.length >= 0.6;
};

/** Strip the LIVE input composer (a "❯ <draft>" box bracketed by ──── rules just
 *  above the status footer) plus the trailing chrome. The composer is what you're
 *  typing RIGHT NOW — not a sent message — so rendering it as a "You →" bubble is
 *  wrong (a half-typed draft or ghost suggestion "leaks" as a message). We anchor
 *  on the Claude status footer; if it's absent (e.g. a codex agent), we leave the
 *  text untouched rather than guess. Sent messages have already scrolled into
 *  history above the composer box, so they survive. */
export function stripComposerBox(text: string): string {
  const lines = text.split('\n');
  // Find the BOTTOM-MOST status footer. Don't cap the search near the bottom:
  // cmux renders chrome BELOW the footer (the "⏵⏵ auto mode" line, blank spacers,
  // and feed/notification items), so the footer can sit several lines up. Scanning
  // bottom-up returns the live footer first; the caret guard below prevents any
  // over-strip if an OLD footer is all that's present.
  let footer = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (CHROME.STATUS_FOOTER.test(lines[i])) {
      footer = i;
      break;
    }
  }
  if (footer < 0) return text;
  let bottom = -1;
  for (let i = footer - 1; i >= 0 && i >= footer - 3; i--) if (RULE_LINE(lines[i])) { bottom = i; break; }
  if (bottom < 0) return text;
  let top = -1;
  for (let i = bottom - 1; i >= 0 && i >= bottom - 40; i--) if (RULE_LINE(lines[i])) { top = i; break; }
  if (top < 0) return text;
  // Only treat the bracketed region as a composer if it actually holds an input caret.
  if (!lines.slice(top + 1, bottom).some((l) => /❯/.test(l))) return text;
  return lines.slice(0, top).join('\n');
}

export function splitGlyph(title: string): { glyph: string | null; name: string } {
  const t = title || '';
  const m = t.match(/^([⠀-⣿✳✻⏺])\s*/);
  if (m) return { glyph: m[1], name: t.slice(m[0].length).trim() };
  return { glyph: null, name: t.trim() };
}

export interface AgentKind {
  id: string; // cmux coding-agent id: 'claude' | 'codex' | 'generic' | …
  label: string; // human label (cmux display_name), e.g. 'Claude Code'
}

/** PID-based detection ONLY (the strong signal). Foreground first: a terminal
 *  can hold processes of SEVERAL agent kinds (e.g. a suspended codex behind a
 *  running Claude session), and the tty process group is what the human is
 *  actually talking to — so it decides the kind. Background/root pids are the
 *  fallback for the tick where the tty set lags. Returns null on no match. */
export function detectAgentByPid(
  surface: RawSurface,
  agentByPid: Map<number, AgentKind>,
): AgentKind | null {
  if (surface.type !== 'terminal') return null;
  for (const p of surface.tty_process_pids || []) {
    const kind = agentByPid.get(p);
    if (kind) return kind;
  }
  for (const p of [...(surface.resources?.pids || []), ...(surface.root_pids || [])]) {
    const kind = agentByPid.get(p);
    if (kind) return kind;
  }
  return null;
}

/** Detect whether this surface is a controllable coding agent, and of WHAT kind.
 *  Agent-agnostic: cmux's `coding_agents` registry tags running agents by type
 *  (claude / codex / generic / …), so a PID intersection both detects the agent
 *  AND names its kind. The Claude glyph/chrome checks remain as a fallback for
 *  the (rare) tick where cmux's pid set lags. Returns null if not an agent. */
export function detectAgent(
  surface: RawSurface,
  viewport: string | undefined,
  agentByPid: Map<number, AgentKind>,
): AgentKind | null {
  if (surface.type !== 'terminal') return null;
  const byPid = detectAgentByPid(surface, agentByPid);
  if (byPid) return byPid;
  // Claude-only fallbacks (glyph / chrome) — keep Claude robust even if its pid
  // set momentarily lags. Other agents are detected via the pid map only.
  if (CLAUDE_GLYPH.test(surface.title || '')) return { id: 'claude', label: 'Claude Code' };
  if (viewport && (CHROME.AUTO_MODE.test(viewport) || CHROME.STATUS_FOOTER.test(viewport)))
    return { id: 'claude', label: 'Claude Code' };
  return null;
}

/** Normalize a viewport for stable hashing: drop ticking timers / footer / rules. */
export function normalizeForHash(text: string): string {
  return (text || '')
    .replace(ELAPSED_TOKENS, '')
    .replace(WORKING_FOR, '')
    .split('\n')
    .filter((l) => !CHROME.STATUS_FOOTER.test(l))
    .map((l) => l.replace(/[─—=]{3,}/g, '─').replace(/\s+$/g, ''))
    .join('\n')
    .trim();
}

export function screenHash(text: string): string {
  return crypto.createHash('sha1').update(normalizeForHash(text)).digest('hex');
}

export function parseCtxPct(text: string): number | undefined {
  const m = text.match(CTX_PCT);
  return m ? Number(m[1]) : undefined;
}

export interface ExtractedQuestion {
  question: string;
  options: AgentOption[];
}

/** Extract the question stem + numbered options from a waiting viewport. */
export function extractQuestion(text: string): ExtractedQuestion {
  const lines = text.split('\n');
  // Find the longest consecutive run of numbered option lines.
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (NUMBERED_OPTION.test(lines[i])) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  const options: AgentOption[] = [];
  if (bestStart >= 0) {
    for (let i = bestStart; i < bestStart + bestLen; i++) {
      const m = lines[i].match(NUMBERED_OPTION);
      if (m) options.push({ index: Number(m[2]), label: m[3].replace(/[│╮╰╯─]+$/g, '').trim().slice(0, 120) });
    }
  }
  // Question stem: nearest meaningful non-rule, non-option line above the block.
  let stem = '';
  const top = bestStart >= 0 ? bestStart : lines.length;
  for (let i = top - 1; i >= 0 && i >= top - 8; i--) {
    const l = lines[i].replace(/[│╭╮╰╯─=]+/g, '').trim();
    if (l && !NUMBERED_OPTION.test(lines[i])) {
      stem = l;
      break;
    }
  }
  return { question: stem.slice(0, 500), options: options.slice(0, 12) };
}

export interface Derived {
  state: LifecycleState;
  question?: string;
  options?: AgentOption[];
  ctxPct?: number;
  model?: string;
  mode?: string;
  usage?: string;
}

// Parse the model + mode from the agent's status footer, e.g.
//   "Opus 4.8 (1M context) | 5h 68% | … | ctx 127k/1M (13%)"
//   "⏵⏵ auto mode on (shift+tab to cycle)"  /  "⏸ plan mode on"  / "⏵ accept edits on"
export function parseModelMode(text: string): { model?: string; mode?: string; usage?: string } {
  let model: string | undefined;
  const m = text.match(/\b(Opus|Sonnet|Haiku|Fable)\s+([\d.]+)\b(?:\s*\(([^)]*?)\bcontext\)?)?/i);
  if (m) {
    const ctx = m[3] ? ` · ${m[3].trim()}` : '';
    model = `${m[1]} ${m[2]}${ctx}`.replace(/\s+/g, ' ').trim();
  } else {
    // Raw model-id footer (e.g. "claude-fable-5[1m] | 5h …") — show the id as-is.
    const raw = text.match(/\bclaude-[\w.-]+(?:\[[\w]+\])?/i);
    if (raw) model = raw[0];
  }
  let mode: string | undefined;
  if (/plan mode/i.test(text)) mode = 'plan';
  else if (/accept edits|auto-?accept/i.test(text)) mode = 'accept-edits';
  else if (/⏵⏵\s*auto mode|auto mode on/i.test(text)) mode = 'auto';
  // Free rate-limit usage straight from the footer ("5h 2% … | 7d 15% …").
  const h5 = text.match(/\b5h\s+(\d+)%/i);
  const d7 = text.match(/\b7d\s+(\d+)%/i);
  const usage =
    [h5 ? `5h ${h5[1]}%` : null, d7 ? `7d ${d7[1]}%` : null].filter(Boolean).join(' · ') || undefined;
  return { model, mode, usage };
}

/** Ordered classification — first match wins. */
// A bare, EMPTY composer prompt ("❯" with nothing typed after it) means the
// agent is idle/ready — NOT waiting on a menu. A real menu cursor is "❯ 1. Yes"
// (text after the caret), so this reliably separates idle from waiting and
// prevents stale numbered lists in scrollback from faking a question.
const EMPTY_COMPOSER = /(^|\n)[ \t│┃|]*❯[ \t ]*(\n|$)/;

// The most recent substantive line the agent left on screen that ends in a
// question mark — i.e. it asked you something and is now idle awaiting a reply.
// Skips chrome (footer / separators / spinner / recap / composer).
function trailingQuestion(lines: string[]): string | undefined {
  let found: string | undefined;
  for (const raw of lines.slice(-22)) {
    const t = raw.trim();
    if (!t) continue;
    if (
      /^[─—=_~·•+|\s-]+$/.test(t) ||
      /^((Opus|Sonnet|Haiku|Fable)\s+[\d.]|claude-[\w.[\]-]+\s*\|)/i.test(t) ||
      /⏵⏵\s*auto mode|shift\+tab to cycle|← for agents|esc to interrupt/i.test(t) ||
      /^❯\s*$/.test(t) ||
      /^[※*✻✶✳✷✺⏺✽✢❋∗]\s/.test(t) ||
      /\bfor\s+\d+s\b|\(\s*\d+m?\s?\d*s/.test(t)
    )
      continue;
    const clean = t.replace(/^[●⏺>\-\s]+/, '').trim();
    if (clean.endsWith('?')) found = clean; // keep the LAST one
  }
  return found ? found.slice(0, 240) : undefined;
}

// ---- Gemini CLI ----------------------------------------------------------
// Working:  "⠼ Thinking... (esc to cancel, 1s)"
// Question: a boxed menu — "Answer Questions / Which season? / ● 1. Spring …
//           / Enter to select · ↑/↓ to navigate". Answered by NUMBER HOTKEY
//           (typing "2" selects + submits — verified live).
// Idle:     the "> Type your message or @path/to/file" composer.
const GEMINI_WORKING = /\besc to cancel\b|Thinking\.\.\./i;
const GEMINI_MENU = /Enter to select|↑\s*\/\s*↓\s*to navigate|Answer Questions/i;
const GEMINI_IDLE = /Type your message|@path\/to\/file/i;
function extractGeminiMenu(lines: string[]): { question: string; options: AgentOption[] } {
  // Scope strictly to the menu BOX: from the ╭ that opens it down to the
  // "Enter to select" footer. Without this, numbered welcome tips elsewhere on
  // screen ("3. Be specific…") get scooped up as bogus options.
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/Enter to select|↑\s*\/\s*↓\s*to navigate/i.test(lines[i])) { end = i; break; }
  }
  if (end < 0) return { question: 'The agent is asking you to choose.', options: [] };
  let start = end;
  for (let i = end; i >= 0 && i >= end - 40; i--) { if (/[╭┌]/.test(lines[i])) { start = i; break; } }
  const options: AgentOption[] = [];
  const seen = new Set<number>();
  let question = '';
  for (const raw of lines.slice(start, end)) {
    const t = raw.replace(/^[│┃|╭╮╰╯─\s]+/, '').replace(/[│┃|\s]+$/, '');
    const m = t.match(/^●?\s*(\d+)\.\s+(.+)$/); // "● 1.  Spring" / "2.  Summer"
    if (m) {
      const idx = Number(m[1]);
      if (!seen.has(idx)) { seen.add(idx); options.push({ index: idx, label: m[2].trim().slice(0, 100) }); }
    } else if (!question && t.endsWith('?') && t.length < 200 && !/navigate|select/i.test(t)) {
      question = t;
    }
  }
  return { question: question || 'The agent is asking you to choose.', options };
}
function deriveGemini(text: string): Derived {
  const lines = text.split('\n');
  const bottom = lines.slice(-22).join('\n');
  const model = (text.match(/\bgemini-\d[\w.-]*/i) || [])[0]; // require a version digit (skip gemini-cli-*)
  const mode = /accept edits/i.test(bottom) ? 'accept-edits' : undefined;
  if (GEMINI_MENU.test(bottom)) {
    const menu = extractGeminiMenu(lines);
    // Only a menu with ≥1 parsed option is a real, answerable question. A bare
    // "Answer Questions" match with no options is mid-render — treat as working so
    // autopilot never fires a free-text answer into a hotkey menu.
    if (menu.options.length >= 1) return { state: 'waiting-question', ...menu, model, mode };
    return { state: 'working', model, mode };
  }
  if (GEMINI_WORKING.test(bottom)) return { state: 'working', model, mode };
  if (GEMINI_IDLE.test(bottom)) return { state: 'idle', model, mode };
  return { state: 'unknown', model, mode };
}

// ---- Unverified agents (generic / aider / goose / any other cmux kind) -----
// We have NOT reverse-engineered their TUIs, so we must NEVER classify them as
// waiting (autopilot would answer a state it only GUESSED at, using rules that
// don't apply). Watch-only: best-effort working/idle, never waiting-*.
function deriveGeneric(text: string): Derived {
  const bottom = text.split('\n').slice(-10).join('\n');
  if (/esc to interrupt|esc to cancel|\bThinking\b|•\s*Working/i.test(bottom)) return { state: 'working' };
  return { state: 'idle' };
}

// ---- OpenAI Codex --------------------------------------------------------
// Working: "• Working (2s • esc to interrupt)".
// Idle:    the "›" composer + "gpt-5.5 default · <cwd>" footer.
// Codex auto-approves and prints clarifying questions as plain text that then
// returns to an idle composer — indistinguishable from done — so we DELIBERATELY
// never classify Codex as waiting (no false-firing autopilot into an idle agent).
const CODEX_WORKING = /•\s*Working\b|\besc to interrupt\b/i;
const CODEX_IDLE = /(^|\n)[ \t]*›|default\s*·/i;
function deriveCodex(text: string): Derived {
  const bottom = text.split('\n').slice(-12).join('\n');
  const model = (text.match(/\bgpt-[\w.-]+/i) || [])[0];
  if (CODEX_WORKING.test(bottom)) return { state: 'working', model };
  if (CODEX_IDLE.test(bottom)) return { state: 'idle', model };
  return { state: 'unknown', model };
}

export function deriveState(text: string, title: string, agentType?: string): Derived {
  if (agentType === 'gemini') return deriveGemini(text);
  if (agentType === 'codex') return deriveCodex(text);
  // Only the Claude parser (below) may emit waiting-* states — it's the one TUI
  // these heuristics were built for. Any OTHER kind (incl. a missing/blank one)
  // is watch-only, so autopilot can never fire into a TUI we haven't reverse-
  // engineered. NOTE: no 'claude' default — an undefined kind must NOT be parsed
  // as Claude.
  if (agentType !== 'claude') return deriveGeneric(text);
  const ctxPct = parseCtxPct(text);
  const { model, mode, usage } = parseModelMode(text);
  const braille = BRAILLE.test(title || '');
  const lines = text.split('\n');
  // Spinner is always the last content; menus/prompts live near the cursor.
  const tail = lines.slice(-6).join('\n');
  const bottom = lines.slice(-16).join('\n');
  const emptyComposer = EMPTY_COMPOSER.test(bottom);

  // R1 WORKING (publishes instantly upstream; never debounced)
  if (braille || SPINNER_ACTIVE.test(tail) || SPINNER_WORD.test(tail)) {
    return { state: 'working', ctxPct, model, mode, usage };
  }
  // R2 ERROR (recent error block near the bottom, not stale scrollback)
  if (ERROR_PAT.test(bottom)) {
    return { state: 'error', ctxPct, model, mode, usage };
  }
  // R3/R4 WAITING — only when a prompt is actually pending at the bottom AND the
  // empty composer is NOT showing (Claude hides the composer while asking).
  if (!emptyComposer && PERMISSION_BOX.test(bottom)) {
    return { state: 'waiting-permission', ...extractQuestion(bottom), ctxPct, model, mode, usage };
  }
  const numbered = (bottom.match(/^\s*[│┃|]?\s*(?:❯\s*)?\d+\.\s+\S/gm) || []).length;
  // A real interactive menu renders a selection cursor (❯) and/or a box border
  // around the options; a plain prose numbered list (an agent summarizing "1. did
  // X / 2. did Y") has neither. Require that corroborating chrome so a finished
  // agent's numbered recap isn't misread as an answerable menu (which could
  // mis-fire autopilot). Permission boxes are already handled above (R3/R4).
  const menuChrome = /❯/.test(bottom) || /[│┃╭╮╰╯]/.test(bottom);
  if (!emptyComposer && numbered >= 2 && menuChrome) {
    return { state: 'waiting-question', ...extractQuestion(bottom), ctxPct, model, mode, usage };
  }
  // R5 IDLE-BUT-ASKED: the agent finished its turn with a question and is now
  // sitting at its (empty) prompt awaiting a free-text reply. This is the most
  // common "needs you / autopilot should answer" case — NOT a boxed menu.
  if (emptyComposer) {
    const q = trailingQuestion(lines);
    if (q) return { state: 'waiting-question', question: q, options: [], ctxPct, model, mode, usage };
  }
  // R6 DONE (a finished marker with the agent now idle at its prompt)
  if (DONE_PAT.test(bottom) && emptyComposer) {
    return { state: 'done', ctxPct, model, mode, usage };
  }
  // R7 IDLE
  if (emptyComposer || CHROME.STATUS_FOOTER.test(bottom)) {
    return { state: 'idle', ctxPct, model, mode, usage };
  }
  // R7 UNKNOWN (render as idle upstream; never autopilot)
  return { state: 'unknown', ctxPct, model, mode, usage };
}
