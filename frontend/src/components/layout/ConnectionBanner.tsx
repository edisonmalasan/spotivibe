"use client";

import { useNetworkStore } from "@/stores/networkStore";

/**
 * Connectivity status surface (design §8), mounted once by the AppShell so it
 * is present on every route in both responsive variants. `role="status"` is a
 * polite live region; the copy is fixed per state and the banner renders only
 * while not online. Positioned fixed top-right beneath the 64 px top bar with
 * a stacking level below the player overlays (`z-50`), so it can never cover
 * the bottom player region or the docked video surface. Token-only styling.
 *
 * M13 made the offline message specific. The old copy - "some things won't load
 * until you reconnect" - was true and useless: a listener's next question is always
 * "can I still listen to this?", and the honest answer names the two capabilities
 * that genuinely need a network and the one body of data that does not (spec:
 * `network` - "Connection status banner"). It is also the only place that says so,
 * which is what makes the claim a fact that can be tested rather than a tone that
 * can be reworded.
 */
export function ConnectionBanner() {
  const connection = useNetworkStore((state) => state.connection);

  if (connection === "online") return null;
  const offline = connection === "offline";

  return (
    <div
      role="status"
      data-testid="connection-banner"
      data-connection={connection}
      className="fixed right-4 top-18 z-40 flex max-w-96 items-center gap-2 rounded-cards bg-graphite px-4 py-3 shadow-lg"
    >
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${offline ? "bg-signal-red" : "bg-steel"}`}
      />
      <span className={`text-body font-regular ${offline ? "text-pure-white" : "text-mist"}`}>
        {offline
          ? "You're offline — search and playback need a connection. Your library, playlists, and history still work."
          : "Connection looks slow."}
      </span>
    </div>
  );
}
