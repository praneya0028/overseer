// TopBar — the retro game-HUD header: ☉ OVERSEER wordmark, animated fleet
// counters that pop on change, Σ cost, a light/dark theme toggle, the friendly
// Autopilot toggle, a calm "Recall All" (hold-to-confirm), and a tasteful
// connection chip. All colors come from theme tokens (light + dark both work);
// animations are GPU-only and reduced-motion safe.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Logo } from './Logo';
import { OrdersEditor } from './OrdersEditor';

// Pops (scale) a value whenever it changes — returns whether it's mid-tick.
function useTick(value: number): boolean {
  const prev = useRef(value);
  const [ticking, setTicking] = useState(false);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setTicking(true);
      const t = setTimeout(() => setTicking(false), 440);
      return () => clearTimeout(t);
    }
  }, [value]);
  return ticking;
}

// A cute pixel counter: glyph + number, color from a theme var, pops on change.
function Counter({
  glyph,
  count,
  colorVar,
  label,
  pulse,
}: {
  glyph: string;
  count: number;
  colorVar: string;
  label: string;
  pulse?: boolean;
}) {
  const ticking = useTick(count);
  const dim = count === 0;
  return (
    <span
      className="ui inline-flex items-center gap-1 tabular-nums text-[12px]"
      title={`${count} ${label}`}
      style={{ color: dim ? 'var(--ink-mute)' : `var(${colorVar})`, transition: 'color 0.3s ease', opacity: dim ? 0.65 : 1 }}
    >
      <span
        className={`inline-block ${ticking ? 'anim-tick' : ''} ${pulse && !dim ? 'anim-pulse-amber' : ''}`}
        style={{ transformOrigin: 'center' }}
      >
        {glyph}
      </span>
      <span className={`font-bold ${ticking ? 'anim-tick' : ''}`} style={{ transformOrigin: 'center' }}>
        {count}
      </span>
      <span className="font-normal">{label}</span>
    </span>
  );
}

export function TopBar() {
  const agents = useStore((s) => s.agents);
  const master = useStore((s) => s.master);
  const setMaster = useStore((s) => s.setMaster);
  const recallAll = useStore((s) => s.recallAll);
  const costToday = useStore((s) => s.costToday);
  const cmuxOk = useStore((s) => s.cmuxOk);
  const connected = useStore((s) => s.connected);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const brainModel = useStore((s) => s.brainModel);
  const brainModels = useStore((s) => s.brainModels);
  const setBrainModel = useStore((s) => s.setBrainModel);

  // Head-agent brain-model dropdown.
  const curModel = brainModels.find((m) => m.id === brainModel);
  const [brainOpen, setBrainOpen] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const [triggerW, setTriggerW] = useState(0); // menu matches the trigger button width
  const brainRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!brainOpen) return;
    if (triggerRef.current) setTriggerW(triggerRef.current.offsetWidth); // pin menu width = trigger width
    const onDoc = (e: MouseEvent) => {
      if (brainRef.current && !brainRef.current.contains(e.target as Node)) setBrainOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setBrainOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [brainOpen]);

  const counts = {
    working: agents.filter((a) => a.state === 'working').length,
    waiting: agents.filter((a) => a.needsInput).length,
    armed: agents.filter((a) => a.autopilot !== 'off').length,
  };

  // ---- hold-to-confirm Recall All (700ms press-and-hold fills, then recallAll) ----
  const HOLD_MS = 700;
  const [recallProgress, setRecallProgress] = useState(0); // 0..1
  const rafRef = useRef<number | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef(0);
  const firedRef = useRef(false);

  const stopHold = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (resetTimerRef.current != null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (!firedRef.current) setRecallProgress(0);
  };
  const startHold = () => {
    if (rafRef.current != null) return;
    firedRef.current = false;
    startRef.current = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / HOLD_MS);
      setRecallProgress(p);
      if (p >= 1) {
        if (!firedRef.current) {
          firedRef.current = true;
          recallAll();
        }
        rafRef.current = null;
        resetTimerRef.current = setTimeout(() => {
          resetTimerRef.current = null;
          firedRef.current = false;
          setRecallProgress(0);
        }, 320);
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };
  useEffect(() => () => stopHold(), []);

  const offline = !connected;
  const cmuxDown = connected && !cmuxOk;

  return (
    <header className="pixel-panel relative z-10 m-3 mb-1 flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
      {/* wordmark — control-hub logo + clean OVERSEER */}
      <div className="flex items-center gap-2.5" title="Overseer · your agent control center">
        <Logo size={38} />
        <div className="leading-none">
          <div className="ui font-black text-ink" style={{ fontSize: 21, letterSpacing: '0.14em' }}>
            Overseer
          </div>
          <div className="ui mt-1 text-[10px] font-bold uppercase tracking-[0.24em] text-ink-mute">
            control center
          </div>
        </div>
      </div>

      {/* divider */}
      <span className="hidden h-7 w-0.5 bg-hairline md:inline-block" />

      {/* animated fleet counters — cute pixel readouts, pop (anim-tick) on change */}
      <div className="ui flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[12px] text-ink-mute" title="Total agents Overseer is overseeing">
          <span className="font-bold text-ink-dim tabular-nums">{agents.length}</span> agents
        </span>
        <Counter glyph="✻" count={counts.working} colorVar="--working" label="working" />
        <Counter glyph="◆" count={counts.waiting} colorVar="--needs" label="need you" pulse />
        <Counter glyph="◈" count={counts.armed} colorVar="--ap" label="on autopilot" />
      </div>

      {/* connection chip — only when something's off */}
      {(offline || cmuxDown) && (
        <span
          className="anim-chip ui inline-flex items-center gap-1.5 px-2 py-0.5 text-[12px]"
          style={{
            border: '2px solid var(--outline)',
            borderRadius: '3px',
            color: 'var(--needs)',
            background: 'var(--panel-2)',
          }}
          title={offline ? 'Reconnecting to the Overseer daemon' : 'cmux not reachable — retrying'}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
          {offline ? 'reconnecting' : 'cmux offline'}
        </span>
      )}

      <div className="min-w-0 flex-1" />

      {/* Autopilot AI spend today — only shown once it's actually spent something */}
      {costToday > 0 && (
        <span
          className="ui hidden shrink-0 whitespace-nowrap text-[12px] tabular-nums text-ink-dim md:inline"
          title="What Overseer's autopilot AI has cost today (it answers stalled agents for you)"
        >
          autopilot spend <span className="font-bold text-ink">${costToday.toFixed(2)}</span>
        </span>
      )}

      {/* light / dark theme toggle — chunky pixel-btn, clearly visible */}
      <button
        onClick={toggleTheme}
        className="pixel-btn ui shrink-0 px-3 py-1.5 text-sm"
        title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
        aria-label="Toggle light/dark theme"
      >
        {theme === 'light' ? '☾' : '☀'}
      </button>

      {/* fleet-wide standing orders for the autopilot brain */}
      <OrdersEditor surfaceId={null} />

      {/* Overseer brain-model dropdown — the model the head-agent uses to answer
          stalled agents across the whole fleet. Click to open, pick to switch. */}
      <div className="relative shrink-0" ref={brainRef}>
        <button
          ref={triggerRef}
          onClick={() => setBrainOpen((o) => !o)}
          className="pixel-btn ui flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-[12px] font-bold"
          title="Overseer's brain model — the AI that auto-answers stalled agents across your whole fleet. Click to switch."
          aria-haspopup="listbox"
          aria-expanded={brainOpen}
        >
          <span style={{ color: 'var(--ap)' }}>◈</span>
          brain: <span className="text-ink">{curModel?.label || brainModel}</span>
          <span className="text-ink-mute">{brainOpen ? '▴' : '▾'}</span>
        </button>
        {brainOpen && (
          <div
            role="listbox"
            className="pixel-panel absolute right-0 z-50 mt-1 overflow-hidden p-1"
            style={{ width: triggerW ? `${triggerW}px` : undefined }}
          >
            {brainModels.map((m) => {
              const active = m.id === brainModel;
              return (
                <button
                  key={m.id}
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    if (!active) setBrainModel(m.id);
                    setBrainOpen(false);
                  }}
                  className="ui flex w-full items-center gap-2 rounded-[3px] px-2.5 py-1.5 text-left text-[12px] hover:bg-panel-2"
                  style={active ? { color: 'var(--ap)', fontWeight: 700 } : { color: 'var(--ink)' }}
                >
                  <span className="w-3">{active ? '◈' : ''}</span>
                  {m.label}
                </button>
              );
            })}
            {/* any model id, right here — type it and press Enter */}
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customModel.trim()) {
                  setBrainModel(customModel.trim());
                  setCustomModel('');
                  setBrainOpen(false);
                }
              }}
              placeholder="+ custom model id ↩"
              title="Type any claude model id (e.g. a dated snapshot) and press Enter to use it as the brain"
              className="mono mt-1 w-full border-t-2 border-[color:var(--hairline)] bg-transparent px-2.5 pt-1.5 text-[11px] text-ink outline-none placeholder:text-ink-mute"
            />
          </div>
        )}
      </div>

      {/* Autopilot toggle — uses var(--ap) when ON; drives the app-wide reactor grid */}
      <button
        onClick={() => setMaster(!master)}
        className="pixel-btn ui shrink-0 whitespace-nowrap px-3 py-1.5 text-[12px] font-bold"
        style={
          master
            ? { borderColor: 'var(--ap)', color: 'var(--ap)', background: 'color-mix(in srgb, var(--ap) 16%, var(--panel-2))' }
            : undefined
        }
        title={
          master
            ? 'Autopilot is ON — Overseer (an AI) auto-answers agents that stall waiting for input, so they never halt. Click to turn off.'
            : 'Autopilot (OFF). Turn on and Overseer auto-answers agents that get stuck waiting for input. Off by default; you can also arm it per-agent.'
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`inline-block h-2 w-2 rounded-full ${master ? 'anim-pulse-amber' : ''}`}
            style={{ background: master ? 'var(--ap)' : 'var(--ink-mute)' }}
          />
          Autopilot: {master ? 'ON' : 'OFF'}
        </span>
      </button>

      {/* Recall All — only meaningful when autopilot is active; hold-to-confirm */}
      {(master || counts.armed > 0) && (
      <button
        onMouseDown={startHold}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onTouchStart={(e) => {
          e.preventDefault();
          startHold();
        }}
        onTouchEnd={stopHold}
        onTouchCancel={stopHold}
        className="pixel-btn ui relative shrink-0 overflow-hidden whitespace-nowrap px-3 py-1.5 text-[12px] font-bold"
        style={{ borderColor: recallProgress > 0 ? 'var(--recall)' : undefined }}
        title="Press and hold to recall the whole fleet from autopilot"
      >
        {/* hold-progress fill (left-to-right), tinted with the recall accent */}
        <span
          className="pointer-events-none absolute inset-0"
          style={{
            background: 'color-mix(in srgb, var(--recall) 28%, transparent)',
            transform: `scaleX(${recallProgress})`,
            transformOrigin: 'left',
            transition: recallProgress === 0 ? 'transform 0.18s ease' : 'none',
          }}
        />
        <span className="relative inline-flex items-center gap-1.5">
          <span style={{ color: 'var(--recall)' }}>⟲</span>
          {recallProgress >= 1 ? 'Recalled!' : recallProgress > 0 ? 'Hold…' : 'Recall All'}
        </span>
      </button>
      )}
    </header>
  );
}
