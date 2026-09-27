import type { YtNamespace } from "./types";

/**
 * Once-guarded loader for the YouTube IFrame Player API (ROADMAP M4:
 * "Load YouTube IFrame Player API once").
 *
 * Every call within a page session shares one in-flight promise; a failed
 * load clears that promise (and removes the rejected script tag) so a later
 * attempt can genuinely retry instead of waiting forever on a dead script.
 */

const API_SRC = "https://www.youtube.com/iframe_api";

declare global {
  interface Window {
    YT?: Partial<YtNamespace> & { Player?: YtNamespace["Player"] };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let pending: Promise<YtNamespace> | null = null;

function scriptTagExists(): boolean {
  return document.querySelector(`script[src="${API_SRC}"]`) !== null;
}

export function loadYouTubeIframeApi(): Promise<YtNamespace> {
  if (pending) return pending;

  if (typeof document === "undefined") {
    return Promise.reject(new Error("The YouTube IFrame API can only load in a browser."));
  }

  pending = new Promise<YtNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT as YtNamespace);
      return;
    }

    // YouTube's bootstrap invokes whatever callback is installed when the
    // script finishes; chain any previous handler for safety under HMR.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) {
        resolve(window.YT as YtNamespace);
      } else {
        reject(new Error("The YouTube IFrame API loaded without exposing YT.Player."));
      }
    };

    if (scriptTagExists()) return; // a prior attempt's script is still in flight

    const tag = document.createElement("script");
    tag.src = API_SRC;
    tag.async = true;
    tag.onerror = () => {
      tag.remove(); // let the next attempt inject a fresh script
      reject(new Error("Failed to load the YouTube IFrame API."));
    };
    document.head.appendChild(tag);
  }).catch((error: unknown) => {
    pending = null; // failed loads are retryable
    throw error;
  });

  return pending;
}
