// ============================================================================
// CommandPalette.tsx — a ⌘K global command palette. Two steps:
//   1) pick a target agent (filter by name / callsign / cwd, keyboard-driven)
//   2) type a message → Enter sends via store.sendCommand (with a confirm toast)
// Esc closes / backs out. Mounted from App.tsx. Keyboard-first, blurred backdrop.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useStore } from '../store';
import { identityFor } from '../lib/identity';
import { Avatar } from './Avatar';
import { STATE_META } from '../lib/state-ui';
import { Agent, LifecycleState } from '../../shared/contract';

// Map each lifecycle state to a theme color var so the row status reads
// correctly in both light + dark (STATE_META.color is a fixed hex we avoid).
const STATE_VAR: Record<LifecycleState, string> = {
  working: '--working',
  'waiting-permission': '--waiting',
  'waiting-question': '--waiting',
  error: '--error',
  done: '--done',
  idle: '--idle',
  unknown: '--idle',
};

export function CommandPalette() {
  const agents = useStore((s) => s.agents);
  const sendCommand = useStore((s) => s.sendCommand);
  const pushToast = useStore((s) => s.pushToast);
  const theme = useStore((s) => s.theme);
  // Signature hue stays per-agent; lightness flips per theme so callsigns stay
  // readable on the cream (light) panel AND the indigo (dark) panel.
  const sigL = theme === 'dark' ? 68 : 38;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [target, setTarget] = useState<Agent | null>(null);
  const [message, setMessage] = useState('');

  const searchRef = useRef<HTMLInputElement>(null);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const reduce = useReducedMotion();

  const reset = () => {
    setQuery('');
    setActive(0);
    setTarget(null);
    setMessage('');
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  // ⌘K / Ctrl-K toggles open; Esc closes (global)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => {
          if (o) reset();
          return !o;
        });
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // focus the right field on step change
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => (target ? msgRef.current?.focus() : searchRef.current?.focus()), 30);
    return () => clearTimeout(t);
  }, [open, target]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withIdent = agents.map((a) => ({ a, ident: identityFor(a.id, a.name) }));
    const list = q
      ? withIdent.filter(
          ({ a, ident }) =>
            a.name.toLowerCase().includes(q) ||
            ident.callsign.toLowerCase().includes(q) ||
            (a.cwd || '').toLowerCase().includes(q),
        )
      : withIdent;
    return list.sort((x, y) => STATE_META[x.a.state].prio - STATE_META[y.a.state].prio);
  }, [agents, query]);

  // clamp active index when the list shrinks
  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(0, filtered.length - 1));
  }, [filtered.length, active]);

  const pick = (a: Agent) => {
    setTarget(a);
    setMessage('');
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = filtered[active];
      if (sel) pick(sel.a);
    }
  };

  const doSend = () => {
    if (!target || !message.trim()) return;
    sendCommand(target.id, message.endsWith('\n') ? message : message + '\n');
    pushToast('success', `→ ${target.name}: "${message.trim().slice(0, 48)}${message.trim().length > 48 ? '…' : ''}"`);
    close();
  };

  const onMsgKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    } else if (e.key === 'Backspace' && message.length === 0) {
      // back out to agent picker
      e.preventDefault();
      setTarget(null);
    }
  };

  const targetIdent = target ? identityFor(target.id, target.name) : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={close}
          style={{ background: 'color-mix(in srgb, var(--shadow) 70%, transparent)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
        >
          <motion.div
            className="pixel-panel w-full max-w-xl overflow-hidden"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.985 }}
            transition={reduce ? { duration: 0.12 } : { type: 'spring', stiffness: 420, damping: 32 }}
            onMouseDown={(e) => e.stopPropagation()}
            style={{ boxShadow: '6px 6px 0 0 var(--shadow)' }}
          >
            {/* header / breadcrumb */}
            <div className="flex items-center gap-2 border-b-2 px-4 py-2.5" style={{ borderColor: 'var(--outline)', background: 'var(--panel-2)' }}>
              <span className="font-pixel text-[12px] text-ap">⌘K</span>
              <span className="ui text-[12px] uppercase tracking-wider text-ink-dim">
                {target ? 'compose' : 'hail a pilot'}
              </span>
              {targetIdent && (
                <span className="ui ml-auto flex items-center gap-1.5 text-[12px] text-ink-dim">
                  <span style={{ color: `hsl(${targetIdent.hue} 65% ${sigL}%)` }}>●</span>
                  {target!.name}
                  <span className="text-ink-mute">· {targetIdent.callsign}</span>
                </span>
              )}
            </div>

            {!target ? (
              <>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onSearchKey}
                  placeholder="Filter by name, callsign, or path…"
                  className="ui w-full bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-ink-mute"
                />
                <div className="max-h-[46vh] overflow-y-auto border-t-2" style={{ borderColor: 'var(--outline)' }}>
                  {filtered.length === 0 ? (
                    <div className="ui px-4 py-8 text-center text-xs text-ink-mute">No pilots match “{query}”.</div>
                  ) : (
                    filtered.map(({ a, ident }, i) => {
                      const meta = STATE_META[a.state];
                      const isActive = i === active;
                      return (
                        <button
                          key={a.id}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => pick(a)}
                          className="ui flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
                          style={{
                            background: isActive ? 'color-mix(in srgb, var(--ap) 14%, transparent)' : 'transparent',
                            boxShadow: isActive ? 'inset 3px 0 0 var(--ap)' : 'none',
                          }}
                        >
                          <Avatar id={a.id} name={a.name} state={a.state} size={30} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs text-ink" title={a.name}>
                                {a.name}
                              </span>
                              <span className="shrink-0 text-[12px]" style={{ color: `hsl(${ident.hue} 60% ${sigL}%)` }}>
                                {ident.callsign}
                              </span>
                            </div>
                            {a.cwd && (
                              <div className="truncate text-[12px] text-ink-mute" title={a.cwd}>
                                {a.cwd}
                              </div>
                            )}
                          </div>
                          <span className="shrink-0 text-[12px]" style={{ color: `var(${STATE_VAR[a.state]})` }} title={meta.label}>
                            {meta.glyph} {meta.label}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="ui flex items-center gap-3 border-t-2 px-4 py-1.5 text-[12px] text-ink-mute" style={{ borderColor: 'var(--outline)', background: 'var(--panel-2)' }}>
                  <span>↑↓ navigate</span>
                  <span>↵ select</span>
                  <span>esc close</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 pt-3">
                  <Avatar id={target.id} name={target.name} state={target.state} size={34} />
                  <textarea
                    ref={msgRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={onMsgKey}
                    placeholder={`Message ${target.name}…`}
                    rows={3}
                    className="pixel-inset mono flex-1 resize-none px-3 py-2 text-base outline-none"
                    style={{ color: 'var(--term-ink)' }}
                  />
                </div>
                {message.trim() && (
                  <div className="ui truncate px-4 pt-1.5 text-[12px] text-ink-mute" title={message}>
                    will send: <span className="text-ink-dim">{JSON.stringify(message.endsWith('\n') ? message : message + '\n')}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <button
                    onClick={() => setTarget(null)}
                    className="pixel-btn ui px-3 py-1.5 text-[12px] text-ink-dim"
                  >
                    ← change pilot
                  </button>
                  <div className="flex-1" />
                  <span className="ui hidden text-[12px] text-ink-mute sm:inline">↵ send · ⇧↵ newline · esc cancel</span>
                  <button
                    onClick={doSend}
                    disabled={!message.trim()}
                    className="pixel-btn ui px-4 py-1.5 text-xs font-bold transition-opacity disabled:opacity-40"
                    style={{ borderColor: 'var(--ap)', color: 'var(--ap)', background: 'color-mix(in srgb, var(--ap) 16%, var(--panel-2))' }}
                  >
                    Send → {target.name}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
