// Map a lifecycle state (+ the separate needsInput flag) to a THEME TOKEN, so
// colors swap correctly between the light and dark retro palettes. STATE_META's
// own .color/.glow are old-skin hardcoded hex — never use them for styling.
import { LifecycleState } from '../../shared/contract';

const STATE_TOKEN: Record<LifecycleState, string> = {
  working: 'var(--working)',
  'waiting-permission': 'var(--waiting)',
  'waiting-question': 'var(--waiting)',
  error: 'var(--error)',
  done: 'var(--done)',
  idle: 'var(--idle)',
  unknown: 'var(--idle)',
};

export function stateVar(state: LifecycleState, needsInput = false): string {
  if (needsInput) return 'var(--needs)';
  return STATE_TOKEN[state] ?? 'var(--idle)';
}
