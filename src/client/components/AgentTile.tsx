// ============================================================================
// AgentTile — a chunky "crew station" card for one pilot, in the 90s SNES-menu
// look. A .pixel-panel shell with a state-colored top strip + corner flag, a
// bobbing game-character Avatar, name + callsign, a state badge, the LIVE
// terminal viewport in a .pixel-inset well (VT323 / .mono, theme-aware), and a
// telemetry row with ONLY ⏱ elapsed + ctx% (no memory, no cpu). Autopilot is a
// chunky pixel-btn that glows when armed/acting.
//
// All looping motion is GPU-only (transform/opacity/box-shadow/filter), gated
// on prefers-reduced-motion AND on-screen visibility (paused offscreen).
// Keeps layoutId={agent.id} for the expand morph + IntersectionObserver pause.
// ============================================================================
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Agent } from '../../shared/contract';
import { useStore, reportVisible } from '../store';
import { STATE_META, fmtElapsed, fmtPct, cleanViewport } from '../lib/state-ui';
import { Avatar } from './Avatar';
import { identityFor } from '../lib/identity';

const AP = 'var(--ap)'; // autopilot accent (theme-aware purple)

export function AgentTile({ agent }: { agent: Agent }) {
  const ref = useRef<HTMLDivElement>(null);
  const expand = useStore((s) => s.expand);
  const setAutopilot = useStore((s) => s.setAutopilot);
  const master = useStore((s) => s.master);
  // Tag the agent's kind only when the fleet mixes types (Claude + Codex + …).
  const mixedFleet = useStore((s) => new Set(s.agents.map((a) => a.agentType)).size > 1);
  const reduce = useReducedMotion();

  const meta = STATE_META[agent.state];
  const ident = identityFor(agent.id, agent.name);
  const working = agent.state === 'working';
  const needs = agent.needsInput;
  const isError = agent.state === 'error';
  const apOn = agent.autopilot !== 'off';
  const apActing = agent.autopilot === 'acting';

  // ---- on-screen visibility: drives polling pause AND animation pause ----
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setInView(e.isIntersecting);
        reportVisible(agent.id, e.isIntersecting);
      },
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      reportVisible(agent.id, false);
    };
  }, [agent.id]);

  const animate = inView && !reduce; // master gate for all looping/transition motion

  // ---- one-shot flourishes on state transitions (done sweep / acting sparkle) ----
  const prevState = useRef(agent.state);
  const prevAct = useRef(apActing);
  const [sweep, setSweep] = useState(false);
  const [sparkle, setSparkle] = useState(false);
  useEffect(() => {
    const becameDone = prevState.current !== 'done' && agent.state === 'done';
    const startedActing = !prevAct.current && apActing;
    if (!animate) return;
    let tSweep: ReturnType<typeof setTimeout> | undefined;
    let tSparkle: ReturnType<typeof setTimeout> | undefined;
    if (becameDone) {
      setSweep(true);
      tSweep = setTimeout(() => setSweep(false), 900);
    }
    if (becameDone || startedActing) {
      setSparkle(true);
      tSparkle = setTimeout(() => setSparkle(false), 720);
    }
    return () => {
      if (tSweep) clearTimeout(tSweep);
      if (tSparkle) clearTimeout(tSparkle);
    };
  }, [agent.state, apActing, animate]);
  useEffect(() => {
    prevState.current = agent.state;
    prevAct.current = apActing;
  });

  const viewport = cleanViewport(agent.viewportLines, 6);
  // When the visible screen is only chrome (idle/done agents), show a clean
  // one-line status caption instead of dumping the model footer / prompt box.
  const caption =
    agent.state === 'idle'
      ? '❯ Idle — waiting for a task'
      : agent.state === 'done'
        ? '✓ Done — standing by'
        : agent.state === 'working'
          ? '✻ Working…'
          : agent.needsInput
            ? '◆ ' + (agent.question || 'Needs your input')
            : '· Standby';
  const elapsed = fmtElapsed(agent.telemetry.elapsedWorkingMs);
  const ctx = fmtPct(agent.telemetry.ctxPct);

  return (
    <motion.div
      ref={ref}
      onClick={() => expand(agent.id)}
      whileHover={reduce ? undefined : { y: -3, transition: { type: 'spring', stiffness: 380, damping: 26 } }}
      whileTap={reduce ? undefined : { scale: 0.985 }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={`pixel-panel group relative cursor-pointer overflow-hidden ${needs && animate ? 'anim-shake' : ''}`}
      style={{
        // armed autopilot lifts the whole station with a soft purple glow
        boxShadow: apActing
          ? `4px 4px 0 0 var(--shadow), 0 0 18px 0 ${AP}`
          : apOn
            ? `4px 4px 0 0 var(--shadow), 0 0 10px 0 ${AP}`
            : '4px 4px 0 0 var(--shadow)',
        height: 210,
      }}
    >
      {/* state-colored top strip (the SNES menu header band) */}
      <div
        aria-hidden
        className={
          'absolute left-0 right-0 top-0 h-2 ' +
          (animate
            ? working
              ? 'anim-breathe'
              : needs
                ? 'anim-pulse-rose'
                : agent.state === 'waiting-permission' || agent.state === 'waiting-question'
                  ? 'anim-pulse-amber'
                  : ''
            : '')
        }
        style={{
          background: meta.color,
          borderBottom: '2px solid var(--outline)',
        }}
      />
      {/* error: flickering scanline tint over the strip */}
      {isError && animate && (
        <motion.div
          aria-hidden
          className="absolute left-0 right-0 top-0 h-2"
          style={{ background: meta.color }}
          animate={{ opacity: [0.35, 1, 0.55, 0.9, 0.4, 1] }}
          transition={{ repeat: Infinity, duration: 0.45, ease: 'linear' }}
        />
      )}

      {/* armed reactor ring — soft animated purple sweep just inside the border */}
      {apOn && animate && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-tile"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, transparent 200deg, ${AP} 320deg, transparent 360deg)`,
            WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            padding: 2,
            opacity: apActing ? 0.55 : 0.32,
          }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, ease: 'linear', duration: apActing ? 3.2 : 6 }}
        />
      )}

      <div className="relative flex h-full flex-col pt-2">
        {/* header: bobbing pilot + name/callsign + autopilot toggle */}
        <div className="flex items-center gap-2.5 px-3 pt-2">
          <div className={`relative shrink-0 ${animate ? 'anim-bob' : ''}`}>
            <Avatar id={agent.id} name={agent.name} state={agent.state} size={40} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="ui truncate text-[13px] font-bold text-ink" title={agent.name}>
              {agent.name}
            </div>
            <div className="mono flex items-center gap-1.5 text-[13px] leading-none">
              <span className="font-bold" style={{ color: meta.color }} title={ident.callsign}>
                {ident.callsign}
              </span>
              {mixedFleet && (
                <span
                  className="ui smallcaps shrink-0 rounded-badge border border-[color:var(--hairline)] px-1 text-[10px] text-ink-mute"
                  title={`Agent type: ${agent.agentLabel}`}
                >
                  {agent.agentType}
                </span>
              )}
            </div>
            {/* model + mode (fall back to the agent's own label, never a hardcoded
                "Claude" — that mislabels Codex/Gemini whose model we don't parse) */}
            {(agent.model || agent.mode) && (
              <div className="mono mt-1 truncate text-[12px] text-ink-mute" title={`${agent.model || agent.agentLabel}${agent.mode ? ' · ' + agent.mode + ' mode' : ''}`}>
                {agent.model || agent.agentLabel}
                {agent.mode && <span style={{ color: 'var(--ap)' }}> · {agent.mode}</span>}
              </div>
            )}
          </div>
          {/* autopilot toggle — works for every agent (the head-agent oversees the
              whole fleet); global ON forces all on (per-tile locked). */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (master) return; // global forces all on — can't bypass per-agent
              setAutopilot(agent.id, !agent.autopilotEnabled);
            }}
            className={`pixel-btn ui shrink-0 px-2 py-1 text-[12px] uppercase tracking-wide ${
              apOn && animate ? 'anim-shimmer-ap' : ''
            }`}
            style={{
              color: apOn ? AP : 'var(--ink-mute)',
              borderColor: apOn ? AP : 'var(--outline)',
              boxShadow: apActing ? `2px 2px 0 0 var(--shadow), 0 0 10px 0 ${AP}` : undefined,
              cursor: master ? 'not-allowed' : 'pointer',
              opacity: master ? 0.85 : 1,
            }}
            title={
              apActing
                ? 'Overseer is answering this agent right now'
                : master
                  ? 'Global Autopilot is ON for the whole fleet — turn it off in the top bar to control agents individually.'
                  : agent.autopilotEnabled
                    ? 'Autopilot ON for this agent — Overseer auto-answers it when stuck. Click to turn off.'
                    : 'Autopilot OFF. Click to let Overseer auto-answer this agent when it stalls.'
            }
          >
            {apActing ? '◇ Acting…' : master ? '◈ ON · all' : agent.autopilotEnabled ? '◈ Autopilot ON' : '○ Autopilot OFF'}
          </button>
        </div>

        {/* state badge + telemetry on one tidy row */}
        <div className="flex items-center gap-2 px-3 pt-2">
          <span
            className="ui inline-flex items-center gap-1 rounded-badge border-2 px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-wide"
            style={{ color: meta.color, borderColor: meta.color, background: 'var(--panel-2)' }}
            title={meta.label}
          >
            <span>{meta.glyph}</span>
            <span>{meta.label}</span>
          </span>
          <span className="flex-1" />
          <div className="mono flex items-center gap-2 text-[12px] text-ink-mute">
            {elapsed && <Chip label="⏱" value={elapsed} color={meta.color} />}
            {ctx && <Chip label="ctx" value={ctx} color={meta.color} />}
          </div>
        </div>

        {/* live viewport — pixel-inset terminal well, theme-aware */}
        <div className="relative mx-3 mb-3 mt-2 min-h-0 flex-1 overflow-hidden">
          <div className="pixel-inset relative h-full overflow-hidden">
            {animate && <div className="scanline" />}
            {/* bottom-anchored tail: newest line always visible; oldest dissolves */}
            <div className="relative flex h-full flex-col justify-end overflow-hidden">
              <pre
                className="mono whitespace-pre-wrap break-words px-2 py-1.5 text-[14px] leading-[1.2]"
                style={{ color: 'var(--term-ink)' }}
              >
                {viewport.length ? viewport.join('\n') : caption}
              </pre>
            </div>
            {/* top fade so the overflowing oldest line dissolves, not hard-cuts */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-4"
              style={{ background: 'linear-gradient(180deg, var(--term-bg), transparent)' }}
            />
          </div>
        </div>

      </div>

      {/* done completion sweep — single GPU pass of light across the station */}
      {sweep && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(105deg, transparent 30%, ${meta.color} 50%, transparent 70%)`,
            opacity: 0.28,
            mixBlendMode: 'screen',
          }}
          initial={{ x: '-120%' }}
          animate={{ x: '120%' }}
          transition={{ duration: 0.85, ease: 'easeOut' }}
        />
      )}

      {/* sparkle burst on done / acting */}
      {sparkle && <SparkleBurst color={agent.state === 'done' ? meta.color : AP} />}
    </motion.div>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-badge border-2 px-2 py-1 leading-none"
      style={{ borderColor: 'var(--hairline)', background: 'var(--panel-2)', color: 'var(--ink-dim)' }}
    >
      <span style={{ color }}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

// A short-lived burst of sparks radiating from center. Pure transform/opacity.
function SparkleBurst({ color }: { color: string }) {
  const sparks = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {sparks.map((deg, i) => {
        const rad = (deg * Math.PI) / 180;
        return (
          <motion.span
            key={i}
            className="absolute h-1.5 w-1.5"
            style={{ background: color }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(rad) * 46, y: Math.sin(rad) * 46, opacity: 0, scale: 0.4 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
}
