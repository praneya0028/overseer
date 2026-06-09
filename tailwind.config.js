/** @type {import('tailwindcss').Config} */
// Colors reference CSS variables (defined per-theme in index.css) so the whole
// UI swaps between the retro LIGHT (SNES/Animal-Crossing) and DARK palettes.
module.exports = {
  content: ['./src/client/index.html', './src/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: 'var(--void)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        hairline: 'var(--hairline)',
        ink: 'var(--ink)',
        'ink-dim': 'var(--ink-dim)',
        'ink-mute': 'var(--ink-mute)',
        // lifecycle (Channel A)
        idle: 'var(--idle)',
        working: 'var(--working)',
        waiting: 'var(--waiting)',
        needs: 'var(--needs)',
        error: 'var(--error)',
        done: 'var(--done)',
        // autopilot (Channel B)
        ap: 'var(--ap)',
        recall: 'var(--recall)',
      },
      fontFamily: {
        // Pixel face is used ONLY for the wordmark/big accents; everything else
        // uses highly-readable Chivo (UI) and IBM Plex Mono (terminals).
        display: ['"Press Start 2P"', 'ui-monospace', 'monospace'],
        ui: ['Chivo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        // chunky hard-offset "SNES menu" shadows
        chunk: '4px 4px 0 0 var(--shadow)',
        'chunk-sm': '2px 2px 0 0 var(--shadow)',
        'chunk-lg': '6px 6px 0 0 var(--shadow)',
      },
      borderRadius: { tile: '6px', card: '5px', badge: '3px', modal: '8px' },
    },
  },
  plugins: [],
};
