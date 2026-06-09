// ============================================================================
// App.tsx — the shell: lays out TopBar + FleetGrid + RightRail and mounts the
// overlays (AgentExpanded, CommandPalette, Toaster). The composition + store
// wiring is fixed; this file owns shell layout + the deep-space atmosphere.
// ============================================================================

import { useStore } from './store';
import { TopBar } from './components/TopBar';
import { FleetGrid } from './components/FleetGrid';
import { RightRail } from './components/RightRail';
import { AgentExpanded } from './components/AgentExpanded';
import { CommandPalette } from './components/CommandPalette';
import { Toaster } from './components/Toaster';

export function App() {
  const master = useStore((s) => s.master);

  return (
    <>
      {/* ---- atmosphere (fixed, behind everything, pointer-events:none) ---- */}
      <div className="atmos-stars" aria-hidden />
      <div className="atmos-stars layer2" aria-hidden />
      <div className="atmos-vignette" aria-hidden />
      <div className="atmos-scan" aria-hidden />
      {/* cyan reactor grid — fades in when global autopilot is armed */}
      <div className={`atmos-master-grid${master ? ' on' : ''}`} aria-hidden />

      {/* ---- bridge ---- */}
      <div className="relative z-10 flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1 gap-1 px-3 pb-3">
          <main className="min-w-0 flex-1 overflow-y-auto py-2 pr-1">
            <FleetGrid />
          </main>
          <RightRail />
        </div>
        <AgentExpanded />
        <CommandPalette />
        <Toaster />
      </div>
    </>
  );
}
