import { HistoryView } from "@/features/history/HistoryView";
import { StatsView } from "@/features/insights/StatsView";
import { MixList } from "@/features/mixes/MixList";

/**
 * M11 listening-insights route: the local record (design §1), the statistics
 * derived from it, and the mixes built from the same local signal.
 *
 * All three are derived from local listening, which is why they share a route:
 * the page is "what this device knows about your listening", and nothing on it
 * needs a server of its own. The Home Smart Mixes section stays list-only — a
 * feed must not offer to spend provider work while it renders, and a mix the
 * listener cannot build anywhere would never appear there in the first place.
 */
export default function HistoryPage() {
  return (
    <>
      <h1 className="sr-only">History</h1>
      <div className="flex flex-col gap-10">
        <MixList title="Smart Mixes" />
        <StatsView />
        <HistoryView />
      </div>
    </>
  );
}
