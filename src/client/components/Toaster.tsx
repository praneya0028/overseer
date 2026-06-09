// Toaster — cute retro toasts. Chunky pixel-panel cards slide in from the
// bottom-right, click to dismiss (store auto-dismisses too). Color by level via
// theme vars. GPU-only motion, reduced-motion aware.
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useStore } from '../store';

const COLOR = {
  info: 'var(--ap)',
  success: 'var(--working)',
  error: 'var(--needs)',
} as const;
const GLYPH = { info: '◈', success: '✓', error: '✕' } as const;

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  const dismissToast = useStore((s) => s.dismissToast);
  const reduce = useReducedMotion();

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
      <AnimatePresence>
        {toasts.map((t) => {
          const color = COLOR[t.level];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              onClick={() => dismissToast(t.id)}
              className="pixel-panel pointer-events-auto relative flex cursor-pointer items-start gap-2 overflow-hidden px-3 py-2.5 text-sm"
              style={{ borderColor: color }}
            >
              {/* color rail */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-[4px]"
                style={{ background: color }}
              />
              <span className="mono shrink-0 pl-1 text-base leading-5" style={{ color }}>
                {GLYPH[t.level]}
              </span>
              <span className="ui min-w-0 flex-1 break-words text-[12px] leading-5 text-ink">
                {t.text}
              </span>
              <span className="mono shrink-0 select-none pl-1 text-sm text-ink-mute">✕</span>
              {/* progress sliver (auto-dismiss is ~4s in the store) */}
              {!reduce && (
                <motion.span
                  aria-hidden
                  className="absolute bottom-0 left-0 h-[3px]"
                  style={{ background: color, opacity: 0.7 }}
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: 4, ease: 'linear' }}
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
