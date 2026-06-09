// Shared lifecycle-state → UI mapping (color, glyph, label, sort priority).
import { LifecycleState } from '../../shared/contract';

// `color` references a theme CSS var so all state-colored text/borders read
// correctly in BOTH light + dark (inline `style` accepts `var(--x)`). `glow` is
// an RGB triplet for soft glows/shadows only (rgba(${glow},a)) — never text —
// tuned to sit pleasantly over either palette.
export const STATE_META: Record<
  LifecycleState,
  { color: string; glow: string; glyph: string; label: string; prio: number }
> = {
  'waiting-permission': { color: 'var(--waiting)', glow: '217,133,31', glyph: '◆', label: 'awaiting permission', prio: 1 },
  'waiting-question': { color: 'var(--waiting)', glow: '217,133,31', glyph: '◆', label: 'awaiting answer', prio: 1 },
  error: { color: 'var(--error)', glow: '208,69,57', glyph: '✕', label: 'error', prio: 2 },
  working: { color: 'var(--working)', glow: '47,158,110', glyph: '✻', label: 'working', prio: 3 },
  done: { color: 'var(--done)', glow: '47,127,209', glyph: '✓', label: 'done', prio: 4 },
  idle: { color: 'var(--idle)', glow: '156,138,106', glyph: '❯', label: 'idle', prio: 5 },
  unknown: { color: 'var(--ink-mute)', glow: '156,138,106', glyph: '·', label: 'standby', prio: 6 },
};

export function fmtElapsed(ms?: number): string | null {
  if (!ms || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtMem(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1e9) return `${Math.round(bytes / 1e6)}MB`;
  return `${(bytes / 1e9).toFixed(1)}GB`;
}

// "never blank/0" — only render cpu/ctx when meaningfully present.
export function fmtPct(v?: number): string | null {
  if (v == null || Math.round(v) < 1) return null; // never render a literal 0%
  return `${Math.round(v)}%`;
}

// A line that is purely box-drawing rules / whitespace / repeated rule chars.
const BOX_CHARS = /^[\s─-╿▀-▟=_~·•\-+|]+$/;
function isBoxRule(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  return BOX_CHARS.test(t);
}

// Terminal CHROME (not the agent's real status/output) — hidden from the small
// tile readout so the tile shows what the agent is actually doing/saying.
function isChrome(line: string): boolean {
  const t = line.trim();
  if (
    isBoxRule(line) ||
    /^((Opus|Sonnet|Haiku|Fable)\s+[\d.]|claude-[\w.[\]-]+\s*\|)/i.test(t) || // model/usage status footer (friendly name or raw id)
    /⏵⏵\s*auto mode/i.test(t) || // Claude's own auto-accept footer
    /^❯\s*$/.test(t) || // empty composer caret
    /shift\+tab to cycle|← for agents/i.test(t)
  )
    return true;
  // "mostly rule" lines (e.g. cmux pane-title separators "──── folders ────"):
  // if box/rule chars dominate the line, it's decoration, not status.
  const ruleChars = (t.match(/[\s─-╿▀-▟=_~·•+|-]/g) || []).length;
  return t.length >= 8 && ruleChars / t.length >= 0.6;
}

// A decorative separator line (pure rules, or a cmux pane-title bar like
// "──── agent name ────") — stripped from the full terminal view as noise,
// while real content + the model status footer are kept.
export function isSeparator(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (isBoxRule(line)) return true;
  const ruleChars = (t.match(/[─-╿▀-▟=_~·•+|-]/g) || []).length;
  return t.length >= 8 && ruleChars / t.length >= 0.6;
}

// Clean the viewport for the tile body: drop chrome + blank lines, trim a
// uniform left indent, then return the last `n` meaningful lines.
export function cleanViewport(lines: string[], n = 6): string[] {
  if (!lines || lines.length === 0) return [];
  // Only real content — if the visible screen is nothing but chrome/rules (a
  // typical idle agent), return [] so the tile shows a clean status caption
  // instead of dumping the model footer / prompt box.
  const base = lines.filter((l) => l.trim() && !isChrome(l));
  if (!base.length) return [];
  const tail = base.slice(-n);

  // strip a common leading-whitespace indent so text hugs the left edge
  const indents = tail
    .filter((l) => l.trim().length > 0)
    .map((l) => l.length - l.trimStart().length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return tail.map((l) => l.slice(cut)).map((l) => l.replace(/\s+$/, ''));
}
