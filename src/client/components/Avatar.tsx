// ============================================================================
// Avatar.tsx — an adorable 90s game-character "pilot" sprite, deterministic
// per agent id. A little robot/critter mascot: body shell + face plate + ears/
// antennae + cheeks all vary by seed (4×4×4×… → 12+ visually distinct combos).
// The eyes/expression shift with lifecycle state so the avatar doubles as a
// status cue. Pure SVG, no assets. Theme-aware: the shell uses the agent's
// signature HUE (fine for variety per spec), all neutrals come from theme vars
// via currentColor so it reads in light AND dark.
//
// Crisp pixel edges: shapes are blocky, strokes are the dark theme outline, and
// shapeRendering="crispEdges" keeps it pixel-sharp at small sizes.
// ============================================================================

import { identityFor } from '../lib/identity';
import { LifecycleState } from '../../shared/contract';

// Expression of the eyes, per state. (working=focused, waiting=alert/surprised,
// done=happy, error=dizzy/x-eyes, idle=blinking-calm.)
type Expr = 'focused' | 'surprised' | 'happy' | 'dizzy' | 'sleepy' | 'neutral';
const STATE_EXPR: Record<LifecycleState, Expr> = {
  working: 'focused',
  'waiting-permission': 'surprised',
  'waiting-question': 'surprised',
  done: 'happy',
  error: 'dizzy',
  idle: 'sleepy',
  unknown: 'neutral',
};

// Per-state accent for the screen glow / cheeks (CSS var → theme-aware).
const STATE_VAR: Record<LifecycleState, string> = {
  working: 'var(--working)',
  'waiting-permission': 'var(--waiting)',
  'waiting-question': 'var(--waiting)',
  done: 'var(--done)',
  error: 'var(--error)',
  idle: 'var(--idle)',
  unknown: 'var(--ink-mute)',
};

export function Avatar({
  id,
  name,
  state = 'idle',
  size = 36,
}: {
  id: string;
  name: string;
  state?: LifecycleState;
  size?: number;
}) {
  const ident = identityFor(id, name);
  // Reuse the deterministic shaping fields as our critter variant selectors.
  const { hue, helmet, visorShape, antenna, marks } = ident;

  // Signature-hue body shell (kept as derived hue per spec — drives variety).
  const shell = `hsl(${hue} 62% 56%)`;
  const shellHi = `hsl(${hue} 70% 68%)`;
  const shellLo = `hsl(${hue} 50% 44%)`;
  const accent = STATE_VAR[state] || 'var(--ink-mute)';
  const expr = STATE_EXPR[state] || 'neutral';

  // theme-neutral outline + face-plate come through currentColor / vars
  const outline = 'var(--outline)';
  const plate = 'var(--panel)'; // face screen background (cream/dark per theme)
  const uid = `${ident.seed}-${state}`; // state-suffixed so url(#..) never bleeds

  const bodyKind = helmet; // 0..3 body silhouette
  const earKind = antenna; // 0..3 ear / antenna rig
  const faceKind = visorShape; // 0..3 face-plate shape
  const cheeks = marks > 1; // cheek blush on some variants

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-label={`${ident.callsign} pilot`}
      role="img"
      shapeRendering="crispEdges"
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`shell${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={shellHi} />
          <stop offset="55%" stopColor={shell} />
          <stop offset="100%" stopColor={shellLo} />
        </linearGradient>
      </defs>

      {/* soft ground shadow so the bobbing critter feels grounded */}
      <ellipse cx="24" cy="45" rx="11" ry="2.4" fill={outline} opacity="0.22" />

      {/* ---- ears / antennae (4 rigs) ---- */}
      <g stroke={outline} strokeWidth="1.5">
        {earKind === 0 && (
          <>
            {/* single bobble antenna */}
            <line x1="24" y1="9" x2="24" y2="4" />
            <circle cx="24" cy="3" r="2.4" fill={accent} />
          </>
        )}
        {earKind === 1 && (
          <>
            {/* two cat-ear nubs */}
            <path d="M13 10 L11 3 L19 8 Z" fill={shellLo} strokeLinejoin="round" />
            <path d="M35 10 L37 3 L29 8 Z" fill={shellLo} strokeLinejoin="round" />
          </>
        )}
        {earKind === 2 && (
          <>
            {/* twin side antennae with tips */}
            <line x1="12" y1="11" x2="9" y2="5" />
            <circle cx="9" cy="4.5" r="1.8" fill={accent} />
            <line x1="36" y1="11" x2="39" y2="5" />
            <circle cx="39" cy="4.5" r="1.8" fill={accent} />
          </>
        )}
        {earKind === 3 && (
          <>
            {/* round headphone bumps */}
            <circle cx="11" cy="22" r="3.2" fill={shellLo} />
            <circle cx="37" cy="22" r="3.2" fill={shellLo} />
          </>
        )}
      </g>

      {/* ---- body shell (4 silhouettes) ---- */}
      <g stroke={outline} strokeWidth="2" strokeLinejoin="round">
        {bodyKind === 0 && (
          // rounded blob
          <rect x="8" y="9" width="32" height="32" rx="11" fill={`url(#shell${uid})`} />
        )}
        {bodyKind === 1 && (
          // square robot head w/ soft corners
          <rect x="9" y="10" width="30" height="30" rx="5" fill={`url(#shell${uid})`} />
        )}
        {bodyKind === 2 && (
          // tall capsule
          <rect x="11" y="8" width="26" height="34" rx="13" fill={`url(#shell${uid})`} />
        )}
        {bodyKind === 3 && (
          // wide acorn / egg
          <path
            d="M24 9 C12 9 8 18 8 26 C8 36 15 41 24 41 C33 41 40 36 40 26 C40 18 36 9 24 9 Z"
            fill={`url(#shell${uid})`}
          />
        )}
      </g>

      {/* ---- face plate / screen (4 shapes) — dark in dark theme, cream in light ---- */}
      <g stroke={outline} strokeWidth="1.5">
        {faceKind === 0 && <rect x="14" y="17" width="20" height="15" rx="6" fill={plate} />}
        {faceKind === 1 && <rect x="13" y="18" width="22" height="13" rx="3" fill={plate} />}
        {faceKind === 2 && <ellipse cx="24" cy="25" rx="11" ry="8" fill={plate} />}
        {faceKind === 3 && (
          <path d="M14 19 L34 19 L32 31 Q24 35 16 31 Z" fill={plate} strokeLinejoin="round" />
        )}
      </g>

      {/* subtle state-tinted screen glow inside the plate */}
      <ellipse cx="24" cy="25" rx="9.5" ry="6.5" fill={accent} opacity="0.14" />

      {/* ---- cheeks (some variants) ---- */}
      {cheeks && (
        <>
          <circle cx="16" cy="28" r="1.8" fill={accent} opacity="0.5" />
          <circle cx="32" cy="28" r="1.8" fill={accent} opacity="0.5" />
        </>
      )}

      {/* ---- eyes + mouth: expression varies by state ---- */}
      <Face expr={expr} ink={outline} accent={accent} />

      {/* tiny body vent/buttons for extra critter detail */}
      {marks > 0 && <rect x="22.5" y="37" width="3" height="1.6" rx="0.8" fill={outline} opacity="0.5" />}
    </svg>
  );
}

function Face({ expr, ink, accent }: { expr: Expr; ink: string; accent: string }) {
  const eyeFill = ink;
  switch (expr) {
    case 'focused':
      // narrowed determined eyes + flat mouth
      return (
        <g stroke={ink} strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="24" x2="21.5" y2="24" />
          <line x1="26.5" y1="24" x2="30" y2="24" />
          <line x1="21" y1="29.5" x2="27" y2="29.5" strokeWidth="1.6" />
        </g>
      );
    case 'surprised':
      // big alert round eyes + small open "o" mouth
      return (
        <>
          <circle cx="19.5" cy="24" r="2.8" fill={plateWhite} stroke={ink} strokeWidth="1.4" />
          <circle cx="28.5" cy="24" r="2.8" fill={plateWhite} stroke={ink} strokeWidth="1.4" />
          <circle cx="19.5" cy="24" r="1.3" fill={eyeFill} />
          <circle cx="28.5" cy="24" r="1.3" fill={eyeFill} />
          <circle cx="24" cy="30" r="1.6" fill="none" stroke={ink} strokeWidth="1.4" />
        </>
      );
    case 'happy':
      // upturned ^_^ eyes + big smile
      return (
        <g stroke={ink} strokeWidth="2.2" fill="none" strokeLinecap="round">
          <path d="M17 25 q2.5 -3 5 0" />
          <path d="M26 25 q2.5 -3 5 0" />
          <path d="M19 29 q5 4 10 0" strokeWidth="1.8" />
        </g>
      );
    case 'dizzy':
      // x-eyes + wavy mouth
      return (
        <g stroke={ink} strokeWidth="2.2" strokeLinecap="round">
          <line x1="17.5" y1="22.5" x2="21.5" y2="26" />
          <line x1="21.5" y1="22.5" x2="17.5" y2="26" />
          <line x1="26.5" y1="22.5" x2="30.5" y2="26" />
          <line x1="30.5" y1="22.5" x2="26.5" y2="26" />
          <path d="M20 30 q2 -2 4 0 q2 2 4 0" strokeWidth="1.6" fill="none" />
        </g>
      );
    case 'sleepy':
      // half-closed calm eyes + tiny content mouth (gentle "blinking-calm")
      return (
        <g stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round">
          <path d="M17.5 24.5 q2.5 1.6 5 0" />
          <path d="M25.5 24.5 q2.5 1.6 5 0" />
          <line x1="22" y1="29.5" x2="26" y2="29.5" strokeWidth="1.5" />
        </g>
      );
    default:
      // neutral round eyes + small smile
      return (
        <>
          <circle cx="19.5" cy="24.5" r="2" fill={eyeFill} />
          <circle cx="28.5" cy="24.5" r="2" fill={eyeFill} />
          <path d="M20 29.5 q4 2.5 8 0" stroke={ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          {/* eye shine */}
          <circle cx="20.3" cy="23.9" r="0.6" fill={accent} opacity="0.9" />
          <circle cx="29.3" cy="23.9" r="0.6" fill={accent} opacity="0.9" />
        </>
      );
  }
}

// white-ish sclera that reads on both themes (slightly transparent panel-2 lift)
const plateWhite = 'rgba(255,255,255,0.9)';
