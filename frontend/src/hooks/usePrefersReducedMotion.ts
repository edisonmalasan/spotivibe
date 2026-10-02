"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the user has asked for reduced motion (spec `lyrics` — reduced motion; extended to the
 * whole application by ROADMAP M19).
 *
 * **Why this exists when `globals.css` already collapses transitions.** The global rule is a
 * *net*, not a guarantee: it neutralises CSS transitions and animations, which is exactly right for
 * a marquee. It cannot neutralise anything a component does imperatively — a
 * `scrollTo({ behavior: "smooth" })` or a Web Animations call bypasses it completely. So the two
 * places that *drive* motion from JavaScript must ask the question themselves, and that question
 * needs one answer in one place rather than a `matchMedia` call per component.
 *
 * **`useSyncExternalStore` rather than `useState` + `useEffect`.** The media query is an external
 * store, and this is the subscription API built for one. The `useEffect` alternative renders once
 * with the wrong value and then corrects itself, which for motion means one frame of animation the
 * user asked not to see.
 *
 * Returns `false` during server rendering and when `matchMedia` is unavailable, so a
 * reduced-motion user is never *delayed* into motion by a hydration gap; it is the safe default in
 * the sense that matters here, because the CSS net is already active on first paint.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Subscribe to the media query. Shared by every caller, so a page with three consumers opens one
 * `MediaQueryList` and one listener rather than three of each.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const list = window.matchMedia(QUERY);
  // `addEventListener` is the modern form; the deprecated `addListener` is still the only one in
  // some embedded webviews, and a hook that silently stops working there is worse than a branch.
  if (typeof list.addEventListener === "function") {
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }
  const legacy = list as MediaQueryList & {
    addListener?: (listener: () => void) => void;
    removeListener?: (listener: () => void) => void;
  };
  legacy.addListener?.(onChange);
  return () => legacy.removeListener?.(onChange);
}

/** Read the current value. Must be referentially stable when unchanged. */
function getSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

/** The server has no media queries, so its snapshot is always `false`. */
function getServerSnapshot(): boolean {
  return false;
}

/** `true` when the user prefers reduced motion, tracked live as the preference changes. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The scroll behaviour to use for a programmatic scroll.
 *
 * One named decision instead of a `prefersReducedMotion ? "auto" : "smooth"` ternary repeated at
 * each call site, so the reduced-motion path cannot be forgotten at one of them.
 */
export function scrollBehaviorFor(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}
