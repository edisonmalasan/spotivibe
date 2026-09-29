import { HomeView } from "@/features/home/HomeView";

/**
 * Home route: shell chrome plus the client discovery feed. `HomeView` reads the
 * local stores and the router, so the page stays a thin server wrapper and the
 * feed's loading/empty/error states render in place (M8 replaces the M1
 * placeholder). The visually hidden heading is the page's single `h1`.
 */
export default function HomePage() {
  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="sr-only">Home</h1>
      <HomeView />
    </div>
  );
}
