// OrdersEditor — standing orders for the autopilot brain. One button + popover,
// used in two places: TopBar (global, fleet-wide, persisted) and AgentExpanded
// (per-agent, session-scoped). The brain receives these verbatim and they
// override its defaults — this is how you teach Overseer to answer like YOU.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

export function OrdersEditor({ surfaceId }: { surfaceId: string | null }) {
  const orders = useStore((s) => s.orders);
  const setOrders = useStore((s) => s.setOrders);
  const value = surfaceId ? orders.perAgent[surfaceId] || '' : orders.global;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(value); // re-seed from live value on every open
    setTimeout(() => taRef.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // don't let Esc also close the expanded panel
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = () => {
    if (draft !== value) setOrders(surfaceId, draft);
    setOpen(false);
  };
  const hasOrders = !!value.trim();

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="pixel-btn ui flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-[12px] font-bold"
        style={hasOrders ? { borderColor: 'var(--ap)', color: 'var(--ap)' } : undefined}
        title={
          surfaceId
            ? 'Standing orders for THIS agent — the autopilot brain follows them when answering here.'
            : 'Fleet-wide standing orders — your written directive the autopilot brain obeys when it answers for you (e.g. "prefer npm", "never touch staging").'
        }
      >
        <span style={{ color: 'var(--ap)' }}>✎</span>
        orders{hasOrders ? ' ·' : ''}
      </button>
      {open && (
        <div className="pixel-panel absolute right-0 z-50 mt-1 w-[320px] p-2.5">
          <div className="ui mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-dim">
            {surfaceId ? 'standing orders — this agent' : 'standing orders — whole fleet'}
          </div>
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
            }}
            rows={4}
            maxLength={2000}
            placeholder={'e.g. prefer npm over pnpm · never touch the staging DB · pick the conservative option'}
            className="mono w-full resize-none rounded-[3px] border-2 border-[color:var(--hairline)] bg-void px-2 py-1.5 text-[12px] text-ink outline-none focus:border-[color:var(--ap)]"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="ui text-[10px] text-ink-mute">the brain obeys these · ⌘↩ saves</span>
            <button onClick={save} className="pixel-btn ui px-2.5 py-1 text-[11px] font-bold">
              save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
