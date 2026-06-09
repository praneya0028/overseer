import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { useStore } from '../store';
import { STATE_META } from '../lib/state-ui';
import { AgentTile } from './AgentTile';

export function FleetGrid() {
  const agents = useStore((s) => s.agents);
  const reduce = useReducedMotion();

  // STABLE order — tiles keep their position and never reshuffle when an agent's
  // state changes (no distracting background re-sorting). Order by the cmux
  // surface index, falling back to id. Urgent agents are surfaced via the
  // Needs-You rail + tile alert, not by moving tiles around.
  const sorted = [...agents].sort((a, b) => {
    const na = parseInt(a.surfaceRef.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.surfaceRef.replace(/\D/g, ''), 10) || 0;
    if (na !== nb) return na - nb;
    return a.id.localeCompare(b.id);
  });

  if (!agents.length) return <EmptyState reduce={!!reduce} />;

  return (
    <LayoutGroup>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        <AnimatePresence mode="popLayout">
          {sorted.map((a) => (
            <AgentTile key={a.id} agent={a} />
          ))}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}

// Charming retro "no crew on deck" scene — a little sleeping mascot on an empty
// pixel-panel station, with a friendly call-to-action. Theme-aware throughout.
function EmptyState({ reduce }: { reduce: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="pixel-panel relative flex max-w-md flex-col items-center px-8 py-10 text-center">
        {/* sleeping mascot in its docked station */}
        <div className="pixel-inset relative mb-6 flex h-28 w-28 items-center justify-center">
          {/* zzz floating up */}
          {!reduce && (
            <>
              <motion.span
                className="font-pixel absolute right-4 top-3 text-[8px] text-ink-mute"
                animate={{ y: [-2, -10], opacity: [0, 1, 0] }}
                transition={{ repeat: Infinity, duration: 2.6, ease: 'easeOut' }}
              >
                z
              </motion.span>
              <motion.span
                className="font-pixel absolute right-6 top-5 text-[12px] text-ink-mute"
                animate={{ y: [-2, -12], opacity: [0, 1, 0] }}
                transition={{ repeat: Infinity, duration: 2.6, ease: 'easeOut', delay: 0.6 }}
              >
                Z
              </motion.span>
            </>
          )}
          <div className={reduce ? '' : 'anim-bob'}>
            <SleepyBot />
          </div>
        </div>

        <div className="ui text-base font-extrabold tracking-wide text-ink">No agents yet</div>
        <div className="ui mt-3 max-w-xs text-[12px] leading-relaxed text-ink-dim">
          Start a Claude session in cmux and it shows up here automatically.
        </div>
      </div>
    </div>
  );
}

// A tiny sleeping critter (closed eyes), drawn in the same blocky theme-aware
// style as Avatar so the empty state feels of-a-piece.
function SleepyBot() {
  const outline = 'var(--outline)';
  return (
    <svg width={64} height={64} viewBox="0 0 48 48" role="img" aria-label="sleeping pilot" shapeRendering="crispEdges">
      {/* antenna */}
      <line x1="24" y1="9" x2="24" y2="4" stroke={outline} strokeWidth="1.5" />
      <circle cx="24" cy="3" r="2.2" fill="var(--idle)" stroke={outline} strokeWidth="1.2" />
      {/* body */}
      <rect x="9" y="10" width="30" height="30" rx="9" fill="var(--panel-2)" stroke={outline} strokeWidth="2" />
      {/* face plate */}
      <rect x="14" y="18" width="20" height="13" rx="5" fill="var(--term-bg)" stroke={outline} strokeWidth="1.5" />
      {/* closed sleepy eyes */}
      <g stroke={outline} strokeWidth="2" fill="none" strokeLinecap="round">
        <path d="M17.5 24 q2.5 1.8 5 0" />
        <path d="M25.5 24 q2.5 1.8 5 0" />
      </g>
      {/* tiny content mouth */}
      <line x1="22" y1="29" x2="26" y2="29" stroke={outline} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
