// Logo — a clean "control hub" emblem: a central command core with two orbit
// rings and a travelling node. Theme-aware (uses the autopilot cyan + ink),
// chunky enough to read as a retro app icon but not pixel-cramped.
export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span
      className="relative inline-flex items-center justify-center rounded-[8px] border-2"
      style={{
        width: size,
        height: size,
        borderColor: 'var(--outline)',
        background: 'linear-gradient(150deg, color-mix(in srgb, var(--ap) 26%, var(--panel)), var(--panel-2))',
        boxShadow: '2px 2px 0 0 var(--shadow)',
      }}
      aria-label="Overseer"
    >
      <svg width={size - 8} height={size - 8} viewBox="0 0 32 32" fill="none">
        {/* outer orbit */}
        <ellipse cx="16" cy="16" rx="13" ry="7" stroke="var(--ap)" strokeWidth="1.4" opacity="0.55" />
        {/* inner orbit (tilted) */}
        <ellipse
          cx="16"
          cy="16"
          rx="7"
          ry="13"
          stroke="var(--ap)"
          strokeWidth="1.4"
          opacity="0.4"
          transform="rotate(32 16 16)"
        />
        {/* command core */}
        <circle cx="16" cy="16" r="4" fill="var(--ap)" />
        <circle cx="16" cy="16" r="4" stroke="var(--outline)" strokeWidth="1.2" />
        {/* travelling node */}
        <circle cx="28.5" cy="16" r="2.1" fill="var(--working)" stroke="var(--outline)" strokeWidth="1" />
      </svg>
    </span>
  );
}
