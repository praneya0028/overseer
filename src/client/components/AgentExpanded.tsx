// AgentExpanded — full-terminal view of one agent in a chunky SNES-menu panel.
// Morphs from its tile via shared layoutId; Esc / backdrop-click minimizes.
// Dimmed backdrop, retro terminal well with a drifting scanline, docked
// CommandBar. If the pilot signs off while expanded, a friendly panel takes over.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useStore } from '../store';
import { STATE_META, fmtElapsed, fmtPct, isSeparator } from '../lib/state-ui';
import { stateVar } from '../lib/state-color';
import { Avatar } from './Avatar';
import { CommandBar } from './CommandBar';
import { OrdersEditor } from './OrdersEditor';
import { identityFor } from '../lib/identity';

export function AgentExpanded() {
  const expandedId = useStore((s) => s.expandedId);
  const agent = useStore((s) => s.agents.find((a) => a.id === s.expandedId));
  const fullText = useStore((s) => (s.expandedId ? s.fullScreens[s.expandedId] : undefined));
  const minimize = useStore((s) => s.minimize);
  const interrupt = useStore((s) => s.interrupt);
  // Only show the agent-type tag when the fleet actually mixes types (Claude +
  // Codex + …). If everyone's the same kind, the tag is noise — hide it.
  const mixedFleet = useStore((s) => new Set(s.agents.map((a) => a.agentType)).size > 1);
  const reduce = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && minimize();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [minimize]);

  const meta = agent ? STATE_META[agent.state] : null;
  const ident = agent ? identityFor(agent.id, agent.name) : null;
  const raw = agent ? (fullText ?? agent.viewportLines.join('\n')) : '';
  // Drop decorative separator rules (the "──── name ────" noise) but keep the
  // real conversation + the model/usage status footer.
  const screen = raw
    .split('\n')
    .filter((l) => !isSeparator(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  // Terminal tail: jump to the newest output when a tile is opened, then keep
  // following it on updates — but only if the user is already near the bottom
  // (so scrolling up to read history isn't yanked away).
  // "Stick to bottom" — stay glued to the newest output (terminal-tail). `pinned`
  // only changes when the USER scrolls, so a big new agent reply (or the message
  // you just sent) never makes the view jump up; it just follows the bottom.
  // Scrolling up unpins (to read history); scrolling back down re-pins.
  const openedFor = useRef<string | null>(null);
  const pinned = useRef(true);
  const [unpinned, setUnpinned] = useState(false); // mirrors !pinned for the "↓ latest" button
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const p = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pinned.current = p;
    setUnpinned(!p);
  };
  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = true;
    setUnpinned(false);
    el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (openedFor.current !== expandedId) {
      openedFor.current = expandedId;
      pinned.current = true; // always open at the newest message
      setUnpinned(false);
    }
    if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [screen, expandedId]);
  const t = agent?.telemetry;
  const stColor = agent ? stateVar(agent.state, agent.needsInput) : 'var(--idle)';

  const elapsed = fmtElapsed(t?.elapsedWorkingMs);
  const ctx = fmtPct(t?.ctxPct);

  return (
    <AnimatePresence>
      {expandedId && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-6"
          style={{ background: 'var(--shadow)', backdropFilter: 'blur(6px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={minimize}
        >
          {agent && meta && ident ? (
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: reduce ? 1 : 0.97, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: reduce ? 1 : 0.98 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="pixel-panel relative flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden"
              style={{
                borderColor: agent.autopilot !== 'off' ? 'var(--ap)' : 'var(--outline)',
              }}
            >
              {/* ---- header ---- */}
              <div className="flex shrink-0 items-center gap-3 border-b-2 border-[color:var(--outline)] bg-panel-2 px-4 py-3">
                <div className={reduce ? '' : 'anim-bob'}>
                  <Avatar id={agent.id} name={agent.name} state={agent.state} size={40} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-base text-ink">
                    <span className="ui truncate font-bold">{agent.name}</span>
                    {mixedFleet && (
                      <span
                        className="ui smallcaps shrink-0 rounded-badge border-2 border-[color:var(--hairline)] px-1.5 py-0.5 text-[12px] text-ink-dim"
                        title={`Agent type: ${agent.agentLabel}`}
                      >
                        {agent.agentLabel}
                      </span>
                    )}
                    <span
                      className="ui smallcaps shrink-0 rounded-badge border-2 px-1.5 py-0.5 text-[12px]"
                      style={{ borderColor: stColor, color: stColor }}
                    >
                      {meta.glyph} {meta.label}
                    </span>
                  </div>
                  <div className="mono mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-sm">
                    <span style={{ color: stColor }}>{ident.callsign}</span>
                    {agent.model && <span className="text-ink-dim">· {agent.model}</span>}
                    {agent.mode && <span style={{ color: 'var(--ap)' }}>· {agent.mode} mode</span>}
                    {agent.cwd && (
                      <span className="truncate text-ink-mute" title={agent.cwd}>
                        · {agent.cwd}
                      </span>
                    )}
                  </div>
                </div>
                {/* live telemetry chips — ONLY elapsed + ctx% (no memory, no cpu) */}
                <div className="mono hidden items-center gap-2 text-sm text-ink-dim sm:flex">
                  {elapsed && (
                    <span className="rounded-badge bg-void px-1.5 py-0.5">⏱ {elapsed}</span>
                  )}
                  {ctx && <span className="rounded-badge bg-void px-1.5 py-0.5">ctx {ctx}</span>}
                  {agent.usage && (
                    <span className="rounded-badge bg-void px-1.5 py-0.5" title="Your Claude rate-limit usage (5-hour / 7-day)">
                      ⛽ {agent.usage}
                    </span>
                  )}
                </div>
                {/* per-agent standing orders for the autopilot brain */}
                <OrdersEditor surfaceId={agent.id} />
                {agent.state === 'working' && (
                  <button
                    onClick={() => interrupt(agent.id)}
                    className="pixel-btn ui shrink-0 px-2.5 py-1.5 text-xs font-bold"
                    style={{ borderColor: 'var(--error)', color: 'var(--error)' }}
                    title="Send Ctrl+C to the agent's terminal — stops what it's running"
                  >
                    ■ stop
                  </button>
                )}
                <button
                  onClick={minimize}
                  className="pixel-btn ui shrink-0 px-2.5 py-1.5 text-xs"
                  title="Close (Esc)"
                >
                  ✕ close
                </button>
              </div>

              {/* ---- body: tagged conversation (you vs agent), scrollable ---- */}
              <div className="relative min-h-0 flex-1 bg-panel p-3 sm:p-4">
                <div
                  ref={scrollRef}
                  onScroll={onScroll}
                  className="pixel-inset relative h-full overflow-y-auto overflow-x-hidden"
                >
                  <Conversation text={screen} agentName={agent.name} agentColor={stColor} />
                </div>
                {/* reading history? one tap back to the live tail */}
                {unpinned && (
                  <button
                    onClick={jumpToLatest}
                    className="pixel-btn ui absolute bottom-6 right-7 z-10 px-2.5 py-1.5 text-[11px] font-bold"
                    title="Jump back to the newest output"
                  >
                    ↓ latest
                  </button>
                )}
              </div>

              {/* ---- footer: docked command bar ---- */}
              <CommandBar target={agent} />
            </motion.div>
          ) : (
            // Pilot signed off mid-session — friendly exit. No layoutId (no tile).
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: reduce ? 1 : 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: reduce ? 1 : 0.96 }}
              className="pixel-panel flex w-full max-w-md flex-col items-center gap-4 px-8 py-10 text-center"
            >
              <div
                className="mono flex h-14 w-14 items-center justify-center rounded-full border-2 text-2xl"
                style={{ borderColor: 'var(--done)', color: 'var(--done)' }}
              >
                ✓
              </div>
              <div>
                <div className="ui text-base font-bold text-ink">Pilot signed off</div>
                <div className="mono mt-1 text-sm text-ink-mute">
                  This surface is no longer in the fleet.
                </div>
              </div>
              <button onClick={minimize} className="pixel-btn ui px-4 py-2 text-xs">
                ← back to deck
              </button>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Parse the terminal transcript into messages and tag who said what:
//   "❯ …"  → YOU (a prompt you/anyone typed to the agent)
//   "● / ⏺ / text" → the AGENT's reply/actions (consecutive lines merged)
// A multi-line prompt renders in scrollback as "❯ line1" + indented continuation
// lines — those belong to the YOU bubble, not the agent's reply. A line that
// opens with an agent marker (⏺ ● ⎿ ✻ …) always ends the prompt.
const AGENT_MARK = /^\s*[●⏺⎿✻✶✳✷✺╭│]/;
function parseMessages(text: string): { who: 'you' | 'agent'; lines: string[] }[] {
  const out: { who: 'you' | 'agent'; lines: string[] }[] = [];
  let cur: { who: 'you' | 'agent'; lines: string[] } | null = null;
  for (const raw of text.split('\n')) {
    const t = raw.replace(/\s+$/g, '');
    // Only a ❯ at column 0 is a real user prompt; an indented ❯ is agent output.
    if (/^❯\s/.test(t)) {
      cur = { who: 'you', lines: [t.replace(/^❯\s?/, '')] };
      out.push(cur);
    } else if (cur?.who === 'you' && t && /^\s{2,}/.test(t) && !AGENT_MARK.test(t)) {
      cur.lines.push(t.replace(/^\s{2}/, '')); // prompt continuation line
    } else {
      if (!cur || cur.who === 'you') {
        cur = { who: 'agent', lines: [] };
        out.push(cur);
      }
      cur.lines.push(t);
    }
  }
  return out.filter((m) => m.lines.join('').trim());
}

// One bubble, memoized on its content — while the agent streams, only the LAST
// bubble's content changes, so the rest of the (potentially long) scrollback
// skips re-rendering entirely. This is the client half of the no-flicker fix.
const Message = memo(function Message({
  you,
  label,
  accent,
  content,
}: {
  you: boolean;
  label: string;
  accent: string;
  content: string;
}) {
  return (
    <div
      className="rounded-card border-2 px-3 py-2"
      style={{
        borderColor: you ? 'var(--ap)' : 'var(--hairline)',
        background: you ? 'color-mix(in srgb, var(--ap) 9%, var(--term-bg))' : 'var(--term-bg)',
      }}
    >
      <div className="ui mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: accent }}>
        {label}
      </div>
      <pre
        className="mono whitespace-pre-wrap break-words text-[13.5px] leading-relaxed"
        style={{ color: 'var(--term-ink)' }}
      >
        {content}
      </pre>
    </div>
  );
});

function Conversation({ text, agentName, agentColor }: { text: string; agentName: string; agentColor: string }) {
  const msgs = useMemo(() => parseMessages(text.trimEnd()), [text]);
  if (!msgs.length) {
    return <div className="mono p-4 text-sm text-ink-mute">…loading terminal…</div>;
  }
  return (
    <div className="flex flex-col gap-2 p-3">
      {msgs.map((m, i) => {
        const you = m.who === 'you';
        return (
          <Message
            key={i}
            you={you}
            label={you ? 'You →' : agentName}
            accent={you ? 'var(--ap)' : agentColor}
            content={m.lines.join('\n').trimEnd()}
          />
        );
      })}
    </div>
  );
}
