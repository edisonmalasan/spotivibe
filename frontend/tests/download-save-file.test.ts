import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadUrl, filenameFrom, saveResponseAsFile } from "@/features/download/saveFile";

/**
 * Handing a download to the device (M20; spec `download` — "A download leaves no persistent
 * application state"; ROADMAP §21.5's "download to device only").
 *
 * Three claims, and each one is the kind that silently stops being true:
 *
 * 1. **The filename is the server's.** This module never decides an extension. It reads
 *    `Content-Disposition` and passes the name through, because a name it chose is a name it could
 *    choose wrongly, and a wrongly-named file is a lie about the bytes on the listener's disk.
 * 2. **The object URL is released.** Leaking one per download pins a multi-megabyte Blob for the
 *    lifetime of the tab, which is invisible in development and fatal after a dozen tracks.
 * 3. **A failed download throws before the save.** A non-`ok` response must not produce a file, and
 *    its error must carry the machine-readable code the route chose so a message can be built from
 *    it.
 *
 * jsdom has no `URL.createObjectURL`, and no `a.click()` behaviour, so both are installed here. The
 * click is observed by spying on `HTMLAnchorElement.prototype.click` rather than by asserting a
 * download happened, because a real download cannot happen in jsdom and pretending otherwise would
 * make this suite prove nothing.
 */

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

interface AnchorRecord {
  href: string;
  download: string;
  rel: string;
  connected: boolean;
}

const anchors: AnchorRecord[] = [];

/** Every anchor this module created, captured at click time. */
function createdAnchors(): AnchorRecord[] {
  return anchors;
}

/**
 * The installed `createObjectURL` stub, kept so a test can read *which* URL was revoked.
 *
 * Reached through a variable rather than through `URL.createObjectURL.mock`: the DOM signature is
 * `(obj: Blob | MediaSource) => string`, which has no `.mock`, so reading it off the global would need
 * a cast on every access. The cast belongs once, here, where the stub is installed.
 */
let createObjectURLMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  anchors.length = 0;
  let counter = 0;
  createObjectURLMock = vi.fn(() => `blob:spotivibe/${counter++}`);
  URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchors.push({
      href: this.href,
      download: this.download,
      rel: this.rel,
      // Whether the element was still in the document when it was clicked.
      connected: this.isConnected,
    });
  });
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function ok(headers: Record<string, string>, body = "audio bytes"): Response {
  return new Response(body, { status: 200, headers });
}

describe("downloadUrl", () => {
  it("names the route the application owns, and nothing else", () => {
    expect(downloadUrl("dQw4w9WgXcQ", "")).toBe("/api/download/dQw4w9WgXcQ");
  });

  it("passes the title as a query parameter, encoded", () => {
    const url = downloadUrl("dQw4w9WgXcQ", "Sigur Rós — Hoppípolla");
    expect(url.startsWith("/api/download/dQw4w9WgXcQ?")).toBe(true);
    const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(query.get("title")).toBe("Sigur Rós — Hoppípolla");
    // A title is a filename stem and nothing else. If a future edit adds a `url` parameter here,
    // §21.5's non-goals are broken, so the shape of the query is asserted rather than assumed.
    expect([...query.keys()]).toEqual(["title"]);
  });

  it("adds no query string at all for an empty title", () => {
    expect(downloadUrl("dQw4w9WgXcQ", "")).not.toContain("?");
  });

  it("escapes the id, so a hostile id cannot address another route", () => {
    // The server validates the id too; this is the client half of the same boundary, and it matters
    // because an unescaped `..` in a path is a request for something this feature must never make.
    const url = downloadUrl("../../admin", "");
    expect(url).toBe("/api/download/..%2F..%2Fadmin");
    expect(url).not.toContain("/../");
  });
});

describe("filenameFrom", () => {
  it("reads the ASCII form", () => {
    const response = ok({
      "Content-Disposition": 'attachment; filename="Bohemian-Rhapsody.webm"',
    });
    expect(filenameFrom(response)).toBe("Bohemian-Rhapsody.webm");
  });

  it("prefers the RFC 5987 form, so a non-ASCII title is not percent-encoded in the dialog", () => {
    const response = ok({
      "Content-Disposition":
        "attachment; filename=\"Hoppipolla.webm\"; filename*=UTF-8''Hopp%C3%ADpolla.webm",
    });
    expect(filenameFrom(response)).toBe("Hoppípolla.webm");
  });

  it("decodes the `UTF-8''` prefix if the ASCII form is missing it", () => {
    const response = ok({ "Content-Disposition": "attachment; filename*=UTF-8''Track.webm" });
    expect(filenameFrom(response)).toBe("Track.webm");
  });

  it("survives a malformed percent-escape rather than losing the name", async () => {
    // The name is the server's decision even when it is not decodable; dropping it would fall back
    // to `track`, which is worse than an odd-looking filename.
    const response = ok({ "Content-Disposition": "attachment; filename*=UTF-8''100%25.webm" });
    expect(filenameFrom(response)).toBe("100%.webm");
    const broken = ok({ "Content-Disposition": "attachment; filename*=UTF-8''a%ZZ.webm" });
    expect(filenameFrom(broken)).toBe("a%ZZ.webm");
  });

  it("returns an empty string when the server named nothing, rather than inventing a name", () => {
    // The empty string is a distinct answer from a guess. `saveResponseAsFile` turns it into the
    // generic name `track`, which the listener can recognise and act on; a guessed `.webm` would be
    // indistinguishable from a real answer.
    expect(filenameFrom(ok({}))).toBe("");
    expect(filenameFrom(ok({ "Content-Disposition": "attachment" }))).toBe("");
  });

  it("does not fall back to the URL's last path segment", () => {
    // A `Content-Type` says what the bytes are; the header says what the server called the file.
    // Deriving the name from the path would reintroduce exactly the guess this feature refuses.
    const response = ok({ "Content-Type": "audio/webm" });
    expect(filenameFrom(response)).toBe("");
  });
});

describe("saveResponseAsFile — success", () => {
  it("hands the file to the device under the name the server chose", async () => {
    const response = ok({
      "Content-Type": "audio/webm",
      "Content-Disposition": 'attachment; filename="Track.webm"',
    });
    const saved = await saveResponseAsFile(response);
    expect(saved.filename).toBe("Track.webm");
    expect(saved.size).toBe("audio bytes".length);
    expect(createdAnchors()).toHaveLength(1);
    expect(createdAnchors()[0]).toMatchObject({ download: "Track.webm", rel: "noopener" });
  });

  it("points the anchor at an object URL, never at the route", async () => {
    // A remote `href` would make the browser navigate and possibly re-request; the blob URL is the
    // only thing that carries the bytes already read.
    await saveResponseAsFile(ok({ "Content-Disposition": 'attachment; filename="t.webm"' }));
    expect(createdAnchors()[0]?.href).toMatch(/^blob:/);
    expect(createdAnchors()[0]?.href).not.toContain("/api/");
  });

  it("leaves the anchor attached when it is clicked, then detaches it", async () => {
    await saveResponseAsFile(ok({ "Content-Disposition": 'attachment; filename="t.webm"' }));
    expect(createdAnchors()[0]?.connected, "removing before the click cancels the download").toBe(
      true,
    );
    // …and it is gone from the document afterwards.
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("releases the object URL on the next tick, not synchronously", async () => {
    vi.useFakeTimers();
    await saveResponseAsFile(ok({ "Content-Disposition": 'attachment; filename="t.webm"' }));
    // Some browsers read the anchor's href during the click dispatch, so revoking inside the same
    // task can cancel a download that has not started. Asserting the *absence* immediately after
    // the await is what makes that ordering requirement testable.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(createObjectURLMock.mock.results[0]?.value);
  });

  it("releases the object URL even when clicking the anchor throws", async () => {
    // A browser that refuses the save — a sandboxed frame, a blocked download — must not also leak
    // the Blob.
    vi.useFakeTimers();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("the browser refused the save");
    });
    await expect(
      saveResponseAsFile(ok({ "Content-Disposition": 'attachment; filename="t.webm"' })),
    ).rejects.toThrow(/refused the save/);
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("falls back to a recognisable generic name when the server named nothing", async () => {
    // `track` has no extension on purpose. A name with an extension would be a guess, and the
    // browser would then be told the bytes are something this client never checked.
    const saved = await saveResponseAsFile(ok({}));
    expect(saved.filename).toBe("track");
    expect(createdAnchors()[0]?.download).toBe("track");
  });

  it("reads the body exactly once, and never inspects the content type", async () => {
    const response = ok({
      "Content-Type": "audio/webm",
      "Content-Disposition": 'attachment; filename="t.opus"',
    });
    await saveResponseAsFile(response);
    expect(response.bodyUsed, "the body must have been read").toBe(true);
    expect(createdAnchors()[0]?.download).toBe("t.opus");
  });
});

describe("saveResponseAsFile — failure", () => {
  it("throws for a non-ok response and creates no file", async () => {
    const response = Response.json(
      { error: { code: "upstream_unavailable", message: "try later" } },
      { status: 502 },
    );
    await expect(saveResponseAsFile(response)).rejects.toThrow(/502: upstream_unavailable/);
    expect(createdAnchors(), "a failed download must not produce a file").toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("distinguishes the two 502s, because the listener's next move differs", async () => {
    const codes = ["upstream_unavailable", "no_suitable_format"];
    for (const code of codes) {
      const response = Response.json({ error: { code, message: "x" } }, { status: 502 });
      await expect(saveResponseAsFile(response)).rejects.toThrow(new RegExp(code));
    }
  });

  it("reports the status even when the body carries no code", async () => {
    const response = new Response("<html>gateway</html>", {
      status: 504,
      headers: { "Content-Type": "text/html" },
    });
    await expect(saveResponseAsFile(response)).rejects.toThrow(/The download failed \(504\)/);
  });

  it("treats a malformed error body as an error rather than throwing a second time", async () => {
    // A proxy in front of the application can return HTML for a 502. Reading the body must not
    // replace the download's failure with a JSON parse failure.
    const response = new Response("not json", { status: 500 });
    await expect(saveResponseAsFile(response)).rejects.toThrow(/The download failed \(500\)/);
  });

  it("treats an error body that is JSON but not the shape it expects as an error", async () => {
    for (const body of [null, 42, "text", { error: "a string" }, { error: { code: 7 } }, {}]) {
      const response = Response.json(body, { status: 500 });
      await expect(saveResponseAsFile(response), JSON.stringify(body)).rejects.toThrow(
        /The download failed \(500/,
      );
    }
  });

  it("does not read the body of a response the browser was never going to receive", async () => {
    // Asserted after the throw: a client that buffered the bytes of a 502 would be doing exactly
    // the buffering this route was designed to avoid, one level up.
    const response = Response.json({ error: { code: "x" } }, { status: 400 });
    await expect(saveResponseAsFile(response)).rejects.toThrow();
    expect(response.bodyUsed).toBe(true);
    expect(createdAnchors()).toHaveLength(0);
  });
});
