"use client";

import { BottomNav } from "@/components/layout/BottomNav";
import { ConnectionBanner } from "@/components/layout/ConnectionBanner";
import { MiniPlayer } from "@/components/layout/MiniPlayer";
import { PlayerBar } from "@/components/layout/PlayerBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { PlayerHost } from "@/components/player/PlayerHost";
import { useListeningRecorder } from "@/features/history/useListeningRecorder";
import { UpdateNotice } from "@/features/pwa/UpdateNotice";
import { attachServiceWorker } from "@/features/pwa/serviceWorker";
import { RadioStartedTracker } from "@/features/personalization/RadioStartedTracker";
import { RefillAgent } from "@/features/personalization/RefillAgent";
import { useEffect, type ReactNode } from "react";

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
 *
 * **M10 mounts its two observers here for the same reason** (`design §5`, and
 * the single-video-host rule beside it): a radio outlives the route that started
 * it, so anything that has to keep observing it has to live outside `children`.
 * `<RefillAgent />` keeps a running queue playing (and renders the non-blocking
 * refill-failure notice), and `<RadioStartedTracker />` keeps the radio's played
 * set — which is what every later refill excludes — current. Both render nothing
 * into the layout; this is wiring, not presentation, and it keeps the
 * cross-store knowledge in the feature that owns it rather than here.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useListeningRecorder();
  // M13: the shell is where the worker's lifecycle belongs, because an update
  // notice that only appeared on one route would be an update most people never
  // see. The attacher returns a detach function and is a no-op where service
  // workers are unsupported, so this costs nothing in a browser without them.
  useEffect(() => attachServiceWorker(), []);

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
      {/* M13: a waiting build is announced here, on every route. */}
      <UpdateNotice />
      {/* Radio/autofill observers, mounted with the persistent player. */}
      <RefillAgent />
      <RadioStartedTracker />
      <PlayerHost />
    </div>
  );
}
