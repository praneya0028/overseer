// RightRail — mission-ops sidebar, retro SNES-menu skin. "▲ NEEDS YOU"
// (urgent, top) above the "◇ AUTOPILOT LOG" (audit feed). Chunky pixel-panels,
// theme-token colors only (light + dark), little pilot characters that bob.
import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Agent, AutopilotDecision } from '../../shared/contract';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import { identityFor, callsignColor } from '../lib/identity';
import { STATE_META } from '../lib/state-ui';

// ----------------------------------------------------------------------------
// NEEDS YOU
// ----------------------------------------------------------------------------
function NeedsYouCard({ agent }: { agent: Agent }) {
  const answer = useStore((s) => s.answer);
  const setAutopilot = useStore((s) => s.setAutopilot);
  const expand = useStore((s) => s.expand);
  const reduce = useReducedMotion();
  const theme = useStore((s) => s.theme);
  const [txt, setTxt] = useState('');
  const ident = identityFor(agent.id, agent.name);
  const meta = STATE_META[agent.state];

  const send = (text: string) => {
    if (!text.trim()) return;
    answer(agent.id, text + '\n');
    setTxt('');
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className={`pixel-panel relative overflow-hidden ${reduce ? '' : 'anim-tick'}`}
      style={{ borderColor: 'var(--needs)' }}
    >
      {/* alert spine — pulses to draw the eye */}
      <div
        aria-hidden
        className={reduce ? '' : 'anim-pulse-rose'}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: 'var(--needs)' }}
      />

      <div className="flex flex-col gap-2.5 p-3 pl-4">
        {/* header — click to open this agent's full terminal */}
        <button
          onClick={() => expand(agent.id)}
          className="group -m-1 flex items-center gap-2 rounded p-1 text-left transition-colors hover:bg-[color:var(--panel-2)]"
          title="Open this agent's terminal"
        >
          <div className={`shrink-0 ${reduce ? '' : 'anim-bob'}`}>
            <Avatar id={agent.id} name={agent.name} state={agent.state} size={30} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mono flex items-center gap-1.5 text-base text-ink">
              <span className="truncate" title={agent.name}>
                {agent.name}
              </span>
              <span className="ui shrink-0 text-[11px] text-ink-mute opacity-0 transition-opacity group-hover:opacity-100">
                open ↗
              </span>
            </div>
            <div className="mono flex items-center gap-1.5 text-xs uppercase tracking-wider">
              <span style={{ color: callsignColor(ident.hue, theme) }} title={ident.callsign}>
                {ident.callsign}
              </span>
              <span className="text-ink-mute">·</span>
              <span style={{ color: 'var(--needs)' }}>{meta.glyph} awaiting you</span>
            </div>
          </div>
        </button>

        {/* the question — fully visible, wraps */}
        <div className="pixel-inset mono whitespace-pre-wrap break-words px-2.5 py-2 text-sm leading-snug text-ink">
          {agent.question || 'Waiting for your input…'}
        </div>

        {/* game-style choice buttons */}
        {agent.options && agent.options.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {agent.options.map((o) => (
              <motion.button
                key={o.index}
                onClick={() => answer(agent.id, String(o.index) + '\n')}
                whileHover={reduce ? undefined : { x: 2 }}
                className="pixel-btn mono group flex w-full items-start gap-2 px-2 py-1.5 text-left text-sm text-ink"
              >
                <span
                  className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-sm font-bold"
                  style={{ background: 'var(--needs)', color: 'var(--panel)', border: '2px solid var(--outline)' }}
                >
                  {o.index}
                </span>
                <span className="whitespace-pre-wrap break-words leading-snug">{o.label}</span>
              </motion.button>
            ))}
          </div>
        )}

        {/* free-form answer + arm autopilot */}
        <div className="flex items-center gap-1.5">
          <input
            value={txt}
            onChange={(e) => setTxt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send(txt);
            }}
            placeholder="type a reply…"
            className="pixel-inset mono min-w-0 flex-1 px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-mute focus:border-needs"
          />
          <button
            onClick={() => setAutopilot(agent.id, true)}
            className="pixel-btn mono shrink-0 px-2 py-1.5 text-sm"
            style={{ color: 'var(--ap)' }}
            title="Let Overseer answer this for you (turns on autopilot for this agent)"
          >
            ◈ Let Overseer answer
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// AUTOPILOT LOG
// ----------------------------------------------------------------------------
// Outcome → theme var (light + dark safe). Families per spec:
//   sent=working · manual=done · defers=waiting · errors=needs · neutral=ink-mute
const OUTCOME_COLOR: Record<string, string> = {
  sent: 'var(--working)',
  manual_answer: 'var(--done)',
  shadow: 'var(--ink-mute)',
  deferred: 'var(--waiting)',
  destructive_defer: 'var(--waiting)',
  low_confidence_defer: 'var(--waiting)',
  brain_error: 'var(--needs)',
  brain_timeout: 'var(--needs)',
  aborted_screen_changed: 'var(--needs)',
  recalled: 'var(--needs)',
  rate_capped: 'var(--ink-mute)',
  dedup_skip: 'var(--ink-mute)',
};

// instantly-legible glyph per outcome family
const OUTCOME_ICON: Record<string, string> = {
  sent: '➤',
  manual_answer: '✦',
  shadow: '◌',
  deferred: '⏸',
  destructive_defer: '⚠',
  low_confidence_defer: '⏸',
  brain_error: '✕',
  brain_timeout: '⌛',
  aborted_screen_changed: '⟲',
  recalled: '⟲',
  rate_capped: '⊘',
  dedup_skip: '≈',
};

// friendly outcome label overrides (none needed today — outcomes read naturally)
const OUTCOME_LABEL: Record<string, string> = {};

function DecisionCard({ d, animateIn }: { d: AutopilotDecision; animateIn: boolean }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const color = OUTCOME_COLOR[d.outcome] || 'var(--ink-mute)';
  const icon = OUTCOME_ICON[d.outcome] || '·';
  const time = new Date(d.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const outcomeLabel =
    d.outcome === 'sent' && d.actionSent
      ? d.actionSent
      : OUTCOME_LABEL[d.outcome] || d.outcome.replace(/_/g, ' ');

  return (
    <motion.div
      layout
      initial={animateIn && !reduce ? { opacity: 0, x: 14 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      className="pixel-panel relative overflow-hidden"
    >
      {/* outcome spine */}
      <div aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: color }} />

      <div className="flex flex-col gap-1 p-2 pl-3.5">
        {/* meta row: agent · time · cost · latency (NO memory) */}
        <div className="mono flex items-center gap-2 text-xs text-ink-mute">
          <span className="min-w-0 flex-1 truncate text-ink-dim" title={d.agentTitle}>
            {d.agentTitle}
          </span>
          <span className="shrink-0">{time}</span>
          {typeof d.costUsd === 'number' && d.costUsd > 0 && (
            <span className="shrink-0 text-ink-dim">${d.costUsd.toFixed(4)}</span>
          )}
          {typeof d.brainLatencyMs === 'number' && (
            <span className="shrink-0">⏱ {(d.brainLatencyMs / 1000).toFixed(1)}s</span>
          )}
        </div>

        {/* question — fully visible */}
        <div className="mono whitespace-pre-wrap break-words text-sm leading-snug text-ink-dim">
          <span className="text-ink-mute">Q </span>
          {d.question}
        </div>

        {/* outcome — icon + color-coded, fully visible (+ the brain's risk read) */}
        <div className="mono flex items-start gap-1.5 text-sm leading-snug" style={{ color }}>
          <span className="shrink-0">{icon}</span>
          <span className="whitespace-pre-wrap break-words">{outcomeLabel}</span>
          {d.decision?.risk && (
            <span
              className="ui ml-auto shrink-0 rounded-badge border-2 border-[color:var(--hairline)] px-1 py-px text-[10px] uppercase"
              style={{ color: d.decision.risk === 'high' ? 'var(--needs)' : d.decision.risk === 'medium' ? 'var(--waiting)' : 'var(--ink-mute)' }}
              title={`Brain risk assessment: ${d.decision.risk}${d.decision.reversible === false ? ' · irreversible' : ''}`}
            >
              {d.decision.risk}
            </span>
          )}
        </div>

        {/* expandable reasoning */}
        {d.decision?.reasoning && (
          <>
            <button
              onClick={() => setOpen((v) => !v)}
              className="mono mt-0.5 flex items-center gap-1 self-start text-xs text-ink-mute transition-colors hover:text-ink-dim"
            >
              <span>{open ? '⌄' : '›'}</span> reasoning
              {typeof d.decision.confidence === 'number' && (
                <span className="text-ink-mute">· {Math.round(d.decision.confidence * 100)}%</span>
              )}
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={reduce ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="pixel-inset mono whitespace-pre-wrap break-words px-2 py-1.5 text-sm leading-snug text-ink-dim">
                    {d.decision.reasoning}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// RAIL
// ----------------------------------------------------------------------------
export function RightRail() {
  const needs = useStore((s) => s.agents.filter((a) => a.needsInput));
  const decisions = useStore((s) => s.decisions);
  const costToday = useStore((s) => s.costToday);
  const reduce = useReducedMotion();
  // ids present at mount don't animate in (avoids a load-time cascade from the
  // decisionsInit backlog); only decisions that stream in afterward slide in.
  const [mountedIds] = useState(() => new Set(decisions.map((d) => d.id)));

  return (
    <aside
      className="relative flex w-[380px] shrink-0 flex-col gap-4 overflow-y-auto bg-void p-3 max-[1100px]:hidden"
      style={{ borderLeft: '2px solid var(--outline)' }}
    >
      {/* NEEDS YOU --------------------------------------------------------- */}
      <section>
        <div
          className="font-pixel mb-3 flex items-center gap-2 text-[12px] uppercase tracking-wide"
          style={{ color: 'var(--needs)' }}
        >
          <span className={needs.length && !reduce ? 'anim-pulse-amber' : ''}>▲</span>
          NEEDS YOU
          {needs.length > 0 && (
            <span
              className="mono ml-auto px-1.5 py-0.5 text-xs"
              style={{ background: 'var(--needs)', color: 'var(--panel)', border: '2px solid var(--outline)', borderRadius: 4 }}
            >
              {needs.length}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {needs.length ? (
              needs.map((a) => <NeedsYouCard key={a.id} agent={a} />)
            ) : (
              <motion.div
                key="needs-empty"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                className="pixel-panel flex items-center gap-2 px-2.5 py-2"
              >
                <span className="mono text-lg" style={{ color: 'var(--working)' }}>
                  ✓
                </span>
                <span className="mono text-sm text-ink-dim">All good — no agent is waiting on you</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* AUTOPILOT LOG ----------------------------------------------------- */}
      <section className="flex min-h-0 flex-1 flex-col">
        <div
          className="font-pixel mb-3 flex items-center gap-2 text-[12px] uppercase tracking-wide"
          style={{ color: 'var(--ap)' }}
        >
          <span>◇</span> AUTOPILOT LOG
          {costToday > 0 && (
            <span
              className="mono ml-auto px-1.5 py-0.5 text-xs normal-case"
              style={{ background: 'var(--panel-2)', color: 'var(--ap)', border: '2px solid var(--outline)', borderRadius: 4 }}
              title="What Overseer's autopilot AI has cost today"
            >
              ${costToday.toFixed(2)} today
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {decisions.length ? (
              decisions.slice(0, 60).map((d) => <DecisionCard key={d.id} d={d} animateIn={!mountedIds.has(d.id)} />)
            ) : (
              <motion.div
                key="log-empty"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                className="pixel-panel mono px-2.5 py-2 text-sm leading-snug text-ink-mute"
              >
                No decisions yet — turn on autopilot and every answer Overseer gives shows up here.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </aside>
  );
}
