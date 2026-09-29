"use client";

import { BottomNav } from "@/components/layout/BottomNav";
import { ConnectionBanner } from "@/components/layout/ConnectionBanner";
import { MiniPlayer } from "@/components/layout/MiniPlayer";
import { PlayerBar } from "@/components/layout/PlayerBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { PlayerHost } from "@/components/player/PlayerHost";
import { useListeningRecorder } from "@/features/history/useListeningRecorder";
import type { ReactNode } from "react";

/**
 * Single shell instance mounted in the root layout: the top bar, both variant
 * sidebars, the connection banner, and the player regions live outside the
 * page's `children`, so Next.js layout persistence guarantees the player never
 * remounts across route navigation.
 *
 * Variants (CSS-only, design.md): mobile <768px, tablet 768–1023px, desktop
 * ≥1024px — sidebar + desktop PlayerBar render at lg+, the compact
 * MiniPlayer + BottomNav below lg, never both meaningfully at once.
 *
 * The shell is also the one place the listening recorder is mounted (M8
 * design §5): the subscription must outlive route changes, and a hook keeps the
 * cross-store wiring out of every store.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useListeningRecorder();

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-void-black">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto bg-carbon">{children}</main>
      </div>
      <PlayerBar />
      <div data-testid="compact-shell" className="flex shrink-0 flex-col lg:hidden">
        <MiniPlayer />
        <BottomNav />
      </div>
      {/* Connectivity status: shell-global, fixed clear of the player regions. */}
      <ConnectionBanner />
      <PlayerHost />
    </div>
  );
}
