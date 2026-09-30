import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/layout/AppShell";
import "./globals.css";

// DESIGN.md: SpotifyMixUI substitute — Inter, loaded locally via next/font.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Spotivibe",
    template: "%s · Spotivibe",
  },
  description: "Local-first music discovery and playback.",
  // M13: what an installed copy needs from the document itself. `themeColor` is
  // the browser UI and the task switcher, `appleWebApp` is iOS's home-screen path
  // (there is no `beforeinstallprompt` there, so the document is the only place
  // the installed name and icon can be declared), and the manifest is linked
  // explicitly because the metadata route alone is not enough for every browser.
  manifest: "/manifest.webmanifest",
  applicationName: "Spotivibe",
  appleWebApp: {
    capable: true,
    title: "Spotivibe",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

/**
 * Standalone mode gives the app the whole window, so the layout must reach the
 * window's own insets: `viewport-fit=cover` plus `env(safe-area-inset-*)` padding
 * on the body, or a notched device crops the top bar and the bottom player.
 * M13; see `pwa` — "Local pages are usable offline" and design §2 (token-only).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
