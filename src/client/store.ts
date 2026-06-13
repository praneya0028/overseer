// ============================================================================
// store.ts — the single client state store (Zustand). ws.ts feeds server
// messages in via handleMessage; components read slices and call the action
// helpers, which send ClientMessages back over the socket.
// ============================================================================

import { create } from 'zustand';
import { Agent, AutopilotDecision, BrainModel, ClientMessage, OrdersState, ServerMessage } from '../shared/contract';

export interface Toast {
  id: number;
  level: 'info' | 'error' | 'success';
  text: string;
}

export type Theme = 'light' | 'dark';
const THEME_KEY = 'overseer-theme';
function initialTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* ignore */
  }
  return 'light'; // retro SNES-menu light is the signature look
}
export function applyTheme(t: Theme): void {
  try {
    document.documentElement.setAttribute('data-theme', t);
  } catch {
    /* ignore (SSR/non-DOM) */
  }
}

interface State {
  agents: Agent[];
  decisions: AutopilotDecision[];
  costToday: number;
  master: boolean;
  cmuxOk: boolean;
  shadowMode: boolean;
  brainModel: string;
  brainModels: BrainModel[];
  orders: OrdersState;
  connected: boolean;
  expandedId: string | null;
  fullScreens: Record<string, string>;
  toasts: Toast[];
  theme: Theme;
  toggleTheme: () => void;

  // wiring
  _send: (m: ClientMessage) => void;
  setSend: (fn: (m: ClientMessage) => void) => void;
  setConnected: (c: boolean) => void;
  handleMessage: (m: ServerMessage) => void;

  // actions
  expand: (id: string) => void;
  minimize: () => void;
  sendCommand: (surfaceId: string, text: string) => void;
  answer: (surfaceId: string, text: string) => void;
  interrupt: (surfaceId: string) => void;
  setAutopilot: (surfaceId: string, enabled: boolean) => void;
  setMaster: (enabled: boolean) => void;
  setBrainModel: (model: string) => void;
  setOrders: (surfaceId: string | null, text: string) => void;
  recallAll: () => void;
  pushToast: (level: Toast['level'], text: string) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

export const useStore = create<State>((set, get) => ({
  agents: [],
  decisions: [],
  costToday: 0,
  master: false,
  cmuxOk: true,
  shadowMode: false,
  brainModel: 'claude-opus-4-8',
  brainModels: [],
  orders: { global: '', perAgent: {} },
  connected: false,
  expandedId: null,
  fullScreens: {},
  toasts: [],
  theme: initialTheme(),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        /* ignore */
      }
      applyTheme(theme);
      return { theme };
    }),

  _send: () => {},
  setSend: (fn) => set({ _send: fn }),
  setConnected: (c) => set({ connected: c }),

  handleMessage: (m) => {
    switch (m.type) {
      case 'snapshot':
        set({
          agents: m.agents,
          master: m.master,
          cmuxOk: m.cmuxOk,
          shadowMode: m.shadowMode,
          brainModel: m.brainModel,
          brainModels: m.brainModels,
          orders: m.orders,
        });
        break;
      case 'agents': {
        // receiving a fleet update is itself proof cmux is reachable (the
        // server only broadcasts after a successful system.top) — self-heal.
        // Also prune cached screens for agents that have left the fleet.
        const live = new Set(m.agents.map((a) => a.id));
        set((s) => {
          const fullScreens = Object.fromEntries(
            Object.entries(s.fullScreens).filter(([k]) => live.has(k)),
          );
          return s.cmuxOk ? { agents: m.agents, fullScreens } : { agents: m.agents, fullScreens, cmuxOk: true };
        });
        break;
      }
      case 'agentScreen':
        set((s) => ({ fullScreens: { ...s.fullScreens, [m.id]: m.fullText } }));
        break;
      case 'decision':
        set((s) => ({ decisions: [m.decision, ...s.decisions].slice(0, 500) }));
        break;
      case 'decisionsInit':
        set({ decisions: m.decisions, costToday: m.costTodayUsd });
        break;
      case 'master':
        set({ master: m.master });
        break;
      case 'brainModel':
        set({ brainModel: m.model });
        break;
      case 'orders':
        set({ orders: m.orders });
        break;
      case 'cmux':
        set({ cmuxOk: m.ok });
        break;
      case 'toast':
        get().pushToast(m.level, m.text);
        break;
    }
    // keep costToday roughly live as decisions stream in
    if (m.type === 'decision' && typeof m.decision.costUsd === 'number') {
      set((s) => ({ costToday: s.costToday + (m.decision.costUsd || 0) }));
    }
  },

  expand: (id) => {
    set({ expandedId: id });
    pushSubscribe(get);
  },
  minimize: () => {
    set({ expandedId: null });
    pushSubscribe(get);
  },
  sendCommand: (surfaceId, text) => get()._send({ type: 'send', surfaceId, text, confirmed: true }),
  answer: (surfaceId, text) => get()._send({ type: 'answer', surfaceId, text }),
  // interrupt + recallAll are control actions whose effect (Ctrl+C / disarming the
  // fleet) is surprising if it fires LATER. They must not be silently queued while
  // offline and then replayed minutes later on reconnect — drop them with a toast.
  interrupt: (surfaceId) => {
    if (!get().connected) return get().pushToast('error', 'Offline — interrupt not sent');
    get()._send({ type: 'interrupt', surfaceId });
  },
  setAutopilot: (surfaceId, enabled) => get()._send({ type: 'setAutopilot', surfaceId, enabled }),
  setMaster: (enabled) => get()._send({ type: 'setMaster', enabled }),
  setBrainModel: (model) => get()._send({ type: 'setBrainModel', model }),
  setOrders: (surfaceId, text) => get()._send({ type: 'setOrders', surfaceId, text }),
  recallAll: () => {
    if (!get().connected) return get().pushToast('error', 'Offline — recall not sent');
    get()._send({ type: 'recallAll' });
  },

  pushToast: (level, text) => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, level, text }] }));
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Tell the server which tiles are visible / expanded so it can pace polling.
// Visibility is reported by tiles via reportVisible(); see useVisibility().
let visibleIds = new Set<string>();
export function reportVisible(id: string, visible: boolean): void {
  if (visible) visibleIds.add(id);
  else visibleIds.delete(id);
  pushSubscribe(() => useStore.getState());
}
function pushSubscribe(get: () => State): void {
  get()._send({ type: 'subscribe', visibleIds: [...visibleIds], expandedId: get().expandedId });
}

/** Re-send the current view state (ws.ts calls this on every (re)connect — a
 *  restarted daemon starts with no view state and needs it re-announced). */
export function resubscribe(): void {
  pushSubscribe(() => useStore.getState());
}
