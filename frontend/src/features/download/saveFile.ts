/**
 * Handing a finished download to the device (M20; spec `download` — "A download leaves no persistent
 * application state").
 *
 * Four steps, in this order, and the order is the whole module:
 *
 * 1. `response.blob()` — the browser cannot offer a save dialog for a body it has not read, so the
 *    file is held in the tab until the click. This is the *client* holding the file, which is what
 *    ROADMAP §21.5 prescribes and is unrelated to the server-memory constraint the route respects:
 *    the 4.5 MB limit and the 2 GB memory figure in §21.5's table are both about the function.
 * 2. `URL.createObjectURL` — one URL for the blob.
 * 3. A temporary `<a download>` — the element that actually triggers the save, clicked once and then
 *    removed.
 * 4. `URL.revokeObjectURL` — on the next tick, not on unmount. By the time this runs the browser has
 *    the element and the URL it needs; holding the blob alive for a component's lifetime would keep
 *    several megabytes resident for no reason.
 *
 * Nothing here writes to IndexedDB, and this module imports nothing from the application's data layer,
 * so "download-to-device only" is a property of the import graph rather than of a code path that
 * could be reached.
 */

/** Minimal shape of the anchor element this module needs, so a test can observe what was set. */
interface DownloadAnchor {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click(): void;
}

/** How the caller gets the filename the route chose, when it chose one. */
export interface SavedFile {
  /** The filename the route sent, or the content type's natural extension as a fallback. */
  filename: string;
  /** The blob size in bytes. */
  size: number;
}

/**
 * The two `filename` forms, in the order they must be preferred.
 *
 * `filename*` first, because RFC 5987 is the form that can carry a non-ASCII title; `filename` is
 * the ASCII fallback the route sends alongside it. Trying them in one pass would take whichever
 * appears first in the header, and the route always writes the ASCII form first — so a single regex
 * silently discards every accented title the feature exists to preserve.
 */
const CONTENT_DISPOSITION_FILENAME = [
  /filename\*=(?:UTF-8'')?"?([^";]+)"?/i,
  /filename="([^"]*)"/i,
  /filename=([^";\s]+)/i,
] as const;

/**
 * The filename the server chose.
 *
 * Read from `Content-Disposition` rather than reconstructed from the title, because the server is
 * where the extension was decided — it is the only place that knows whether the bytes are Opus in
 * WebM or MP3, and rebuilding the name here would be exactly the kind of second guess this feature
 * exists to avoid.
 */
export function filenameFrom(response: Response): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  for (const pattern of CONTENT_DISPOSITION_FILENAME) {
    const raw = pattern.exec(disposition)?.[1];
    if (raw === undefined || raw === "") continue;
    try {
      return decodeURIComponent(raw);
    } catch {
      // A malformed percent-escape is not a reason to lose the name; the raw form is still the
      // server's decision, just not a decodable one.
      return raw;
    }
  }
  return "";
}

/**
 * Stream a successful response to the device as a file.
 *
 * @throws {Error} when the response is not successful — the caller turns that into a failure state,
 * and the body is not read for a response the browser was never going to receive anyway.
 */
export async function saveResponseAsFile(response: Response): Promise<SavedFile> {
  if (!response.ok) {
    // The body of a structured error is small and worth having: it carries the machine-readable code
    // the route chose, which is what a failure message should be built from.
    let detail = "";
    try {
      const payload: unknown = await response.json();
      if (payload !== null && typeof payload === "object") {
        const error = (payload as { error?: { code?: unknown; message?: unknown } }).error;
        if (error !== undefined && typeof error.code === "string") detail = error.code;
      }
    } catch {
      // A non-JSON error body is still an error; the status code is the part worth keeping.
    }
    throw new Error(
      detail === ""
        ? `The download failed (${response.status}).`
        : `The download failed (${response.status}: ${detail}).`,
    );
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const filename = filenameFrom(response);

  try {
    const anchor = document.createElement("a") as HTMLAnchorElement & DownloadAnchor;
    anchor.href = objectUrl;
    anchor.download = filename === "" ? "track" : filename;
    // The blob URL is same-origin, but the attribute costs nothing and some engines treat an
    // untrusted download name as a navigation without it.
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Next tick, not synchronously: some browsers read the anchor's href during the click
    // dispatch, and revoking inside the same task can cancel a download that has not started.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  return { filename: filename === "" ? "track" : filename, size: blob.size };
}

/** The route URL for a track. */
export function downloadUrl(videoId: string, title: string): string {
  const query = new URLSearchParams();
  if (title !== "") query.set("title", title);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `/api/download/${encodeURIComponent(videoId)}${suffix}`;
}
