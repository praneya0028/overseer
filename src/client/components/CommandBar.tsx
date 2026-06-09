// CommandBar — a simple, clear chat composer for ONE pilot. Type, press Enter to
// send (Shift+Enter for a newline). The Send button names the exact target so you
// always know who receives it.
import { useEffect, useRef, useState } from 'react';
import { Agent } from '../../shared/contract';
import { useStore } from '../store';

export function CommandBar({ target }: { target: Agent }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const sendCommand = useStore((s) => s.sendCommand);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (sentTimer.current) clearTimeout(sentTimer.current); }, []);

  const fire = () => {
    const t = text.trim();
    if (!t) return;
    sendCommand(target.id, t + '\n'); // trailing newline submits it to the agent
    setText('');
    setSent(true);
    if (sentTimer.current) clearTimeout(sentTimer.current);
    sentTimer.current = setTimeout(() => setSent(false), 1400);
  };

  return (
    <div className="shrink-0 border-t-2 border-[color:var(--outline)] bg-panel-2 p-2.5">
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              fire();
            }
          }}
          placeholder={`Message ${target.name}…`}
          rows={1}
          className="mono pixel-inset min-h-[44px] max-h-40 flex-1 resize-y px-3 py-2.5 text-[15px] leading-snug outline-none"
          style={{ color: 'var(--term-ink)' }}
        />
        <button
          onClick={fire}
          disabled={!text.trim()}
          className="pixel-btn ui shrink-0 self-stretch px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: sent ? 'var(--working)' : 'var(--ap)',
            color: 'var(--panel)',
            borderColor: 'var(--outline)',
          }}
          title={`Send to ${target.name}`}
        >
          {sent ? '✓ Sent' : 'Send'}
        </button>
      </div>
    </div>
  );
}
