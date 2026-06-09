// ============================================================================
// identity.ts — deterministic per-agent identity (callsign + hue + avatar seed)
// so an agent always shows the same "fleet pilot" face/name across the UI.
// ============================================================================

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A small roster of call-sign words; combined deterministically per agent.
const CALLSIGNS = [
  'Nova', 'Orion', 'Vega', 'Atlas', 'Echo', 'Pulsar', 'Comet', 'Lyra', 'Drift', 'Quasar',
  'Helix', 'Onyx', 'Zenith', 'Flux', 'Halo', 'Apex', 'Cobalt', 'Ember', 'Solis', 'Rook',
];

// Two-digit numeric tail so two agents that draw the same callsign word still
// read as distinct pilots ("Nova-07" vs "Nova-42").
export interface Identity {
  seed: number;
  hue: number; // 0..360 — the agent's signature color
  callsign: string; // e.g. "Vega-08"
  callsignWord: string; // e.g. "Vega"
  initials: string;
  // avatar shaping (deterministic, 12+ distinct combinations)
  helmet: number; // 0..3 silhouette
  visorShape: number; // 0..3 visor cut
  antenna: number; // 0..3 antenna rig
  marks: number; // 0..3 face detail count
}

// Per-agent signature colour that stays legible in BOTH themes (darker text on
// the light cream, brighter on the dark panel).
export function callsignColor(hue: number, theme: 'light' | 'dark'): string {
  return theme === 'dark' ? `hsl(${hue} 65% 70%)` : `hsl(${hue} 55% 36%)`;
}

export function identityFor(id: string, name: string): Identity {
  const seed = hashStr(id || name);
  // Spread hue away from the cyan autopilot band (180–195) so signature hues
  // never collide with the AP channel; quantize to keep neighbours separable.
  let hue = (seed % 18) * 20; // 0,20,...,340
  if (hue >= 170 && hue <= 200) hue = (hue + 60) % 360;

  const callsignWord = CALLSIGNS[seed % CALLSIGNS.length];
  const tail = String((seed >> 9) % 100).padStart(2, '0');
  const callsign = `${callsignWord}-${tail}`;

  const cleaned = (name || callsignWord).replace(/[^A-Za-z0-9 ]/g, '').trim();
  const parts = cleaned.split(/[\s-]+/).filter(Boolean);
  const initials = (parts[0]?.[0] || 'A') + (parts[1]?.[0] || parts[0]?.[1] || '');

  return {
    seed,
    hue,
    callsign,
    callsignWord,
    initials: initials.toUpperCase(),
    helmet: seed % 4,
    visorShape: (seed >> 2) % 4,
    antenna: (seed >> 4) % 4,
    marks: (seed >> 6) % 4,
  };
}
