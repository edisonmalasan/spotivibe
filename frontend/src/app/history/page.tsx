import { HistoryView } from "@/features/history/HistoryView";
import { StatsView } from "@/features/insights/StatsView";

/**
 * M11 listening-insights route: the local record (M11 design §1) with the
 * statistics derived from it. Both surfaces read local storage on the client, so
 * the route stays a thin shell with no server data of its own.
 */
export default function HistoryPage() {
  return (
    <>
      <h1 className="sr-only">History</h1>
      <div className="flex flex-col gap-10">
        <StatsView />
        <HistoryView />
      </div>
    </>
  );
}
