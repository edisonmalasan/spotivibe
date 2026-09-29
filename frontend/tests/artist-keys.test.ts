import { describe, expect, it } from "vitest";
import * as artistKeys from "@/features/artist/artistKeys";
import * as entityKeys from "@/lib/entityKeys";
import {
  artistHref,
  artistRequestKey,
  isProviderEntityId,
  normalizeEntityText,
} from "@/features/artist/artistKeys";

/**
 * M9 task 3.1: the artist route-key contract (spec: `catalog` — "Catalog entity
 * keys and resolution requests"; design §2).
 *
 * The classification is the load-bearing part: a name misread as an id resolves
 * to nothing, and an id misread as a name silently resolves to *some other*
 * entity — the one failure the spec refuses with "An unresolvable key is not
 * substituted". So the rule is pinned in **both** directions, with the
 * false-positive-prone inputs (short names, hyphenated names, lowercase `uc`,
 * digit runs) asserted as explicitly as the true positives.
 */

const CHANNEL_ID = "UCabcdefghijklmnopqrstuv";

/** The route segment of an href, still percent-encoded as a link carries it. */
function segmentOf(href: string): string {
  return href.slice(href.indexOf("/", "/".length) + 1);
}

describe("artist key classification", () => {
  it("accepts a YouTube channel id, case-sensitively", () => {
    expect(isProviderEntityId(CHANNEL_ID)).toBe(true);
    // Surrounding whitespace is the router's, not the id's.
    expect(isProviderEntityId(`  ${CHANNEL_ID}\n`)).toBe(true);
    // The prefix is what is case-sensitive: `UC…` is an id, `uc…` is not, and a
    // lowercase token only qualifies on the long-alphanumeric rule instead.
    expect(isProviderEntityId("ucshort")).toBe(false);
    expect(isProviderEntityId("UCshort")).toBe(true);
    // A 24-character lowercase token is still an opaque id, just not by prefix.
    expect(isProviderEntityId(CHANNEL_ID.toLowerCase())).toBe(true);
  });

  it("accepts a long unbroken alphanumeric token as an opaque id", () => {
    // 20 characters is the floor; 19 is a text key.
    expect(isProviderEntityId("a".repeat(20))).toBe(true);
    expect(isProviderEntityId("a".repeat(19))).toBe(false);
    expect(isProviderEntityId("01234567890123456789")).toBe(true);
  });

  it("accepts a YouTube release id, which carries an underscore", () => {
    // The M9 evidence run found a real release key that the two rules above
    // rejected as a *name*, which resolved an unrelated release instead of
    // reporting the key as unresolvable. An underscore is what a release id has
    // and a name does not.
    expect(isProviderEntityId("MPREb_eEpQf8QskKl")).toBe(true);
    expect(isProviderEntityId("OLAK5uy_lADvyQxLK7Xqc3Aw9VU")).toBe(true);
    expect(isProviderEntityId("PL1234567890abcdefghij")).toBe(true);
    // Surrounding whitespace is still just the id.
    expect(isProviderEntityId("  MPREb_eEpQf8QskKl  ")).toBe(true);
  });

  it("rejects names that merely look opaque", () => {
    // Hyphen/underscore are excluded on purpose, so no slug is ever an id.
    expect(isProviderEntityId("the-very-long-artist-name")).toBe(false);
    expect(isProviderEntityId("a".repeat(19) + "_")).toBe(false);
    expect(isProviderEntityId(`${"a".repeat(19)} `)).toBe(false);
    // A real name with a space, an accent, or punctuation.
    expect(isProviderEntityId("Aurora Sky")).toBe(false);
    expect(isProviderEntityId("Björk")).toBe(false);
    expect(isProviderEntityId("AC/DC")).toBe(false);
    expect(isProviderEntityId("Tyler, The Creator")).toBe(false);
    // Underscored *names* stay names: too short, or carrying other punctuation.
    expect(isProviderEntityId("A_C")).toBe(false);
    expect(isProviderEntityId("AC_DC_Band")).toBe(false);
    expect(isProviderEntityId("MPREb_eEpQf8QskKl.")).toBe(false);
    expect(isProviderEntityId("MPREb eEpQf8QskKl")).toBe(false);
  });

  it("rejects blank input rather than guessing", () => {
    expect(isProviderEntityId("")).toBe(false);
    expect(isProviderEntityId("   \t\n ")).toBe(false);
  });
});

describe("artistRequestKey", () => {
  it("sends an id-shaped key as an id", () => {
    expect(artistRequestKey(CHANNEL_ID)).toEqual({ id: CHANNEL_ID });
    // A key the router padded still classifies as the same id.
    expect(artistRequestKey(` ${CHANNEL_ID} `)).toEqual({ id: CHANNEL_ID });
  });

  it("sends typed text as text, unchanged apart from whitespace collapsing", () => {
    expect(artistRequestKey("Aurora Sky")).toEqual({ name: "Aurora Sky" });
    // Case is the user's own text and is never rewritten.
    expect(artistRequestKey("  Lumivox  ")).toEqual({ name: "Lumivox" });
    expect(artistRequestKey("Björk")).toEqual({ name: "Björk" });
    expect(artistRequestKey("AC/DC")).toEqual({ name: "AC/DC" });
    expect(artistRequestKey("Tyler, The Creator")).toEqual({ name: "Tyler, The Creator" });
  });

  it("decodes a percent-encoded key from the URL", () => {
    expect(artistRequestKey("Aurora%20Sky")).toEqual({ name: "Aurora Sky" });
    expect(artistRequestKey("Bj%C3%B6rk")).toEqual({ name: "Björk" });
    // A malformed sequence is left alone rather than throwing on a bad route.
    expect(artistRequestKey("100%")).toEqual({ name: "100%" });
  });

  it("de-slugs a slug best-effort and never invents capitalization", () => {
    // Hyphens become spaces; the case the key arrived in is sent as-is,
    // because `lumivox` came from `Lumivox`, `lumivöx`, or `LumiVox` and
    // guessing would be fabricating metadata.
    expect(artistRequestKey("aurora-sky")).toEqual({ name: "aurora sky" });
    expect(artistRequestKey("aurora-sky-dawn")).toEqual({ name: "aurora sky dawn" });
    // A key that already carries a real space is the user's own text, not a
    // slug, so its hyphens are part of the name and are left alone.
    expect(artistRequestKey("Aurora-Sky Dawn")).toEqual({ name: "Aurora-Sky Dawn" });
    // The documented lossy case: a hyphen inside a name is de-slugged too, and
    // the provider's case/punctuation-insensitive search still resolves it.
    expect(artistRequestKey("K-Pop")).toEqual({ name: "K Pop" });
  });

  it("returns null for blank input so no request is ever attempted for it", () => {
    // `null` rather than a throw: an empty route parameter is a missing key, not
    // a malformed request, and the caller turns it into a not-found state.
    expect(artistRequestKey("")).toBeNull();
    expect(artistRequestKey("   ")).toBeNull();
    expect(artistRequestKey("\n\t ")).toBeNull();
    // Decodes to a blank string, so it is blank too.
    expect(artistRequestKey("%20")).toBeNull();
  });

  it("classifies the two halves of the contract, never both", () => {
    const idKey = artistRequestKey(CHANNEL_ID);
    const textKey = artistRequestKey("Aurora Sky");
    expect(idKey !== null && "id" in idKey).toBe(true);
    expect(idKey !== null && "name" in idKey).toBe(false);
    expect(textKey !== null && "name" in textKey).toBe(true);
    expect(textKey !== null && "id" in textKey).toBe(false);
  });
});

describe("artistHref", () => {
  it("builds a shareable, percent-encoded route", () => {
    expect(artistHref("Aurora Sky")).toBe("/artist/Aurora%20Sky");
    expect(artistHref("Björk")).toBe("/artist/Bj%C3%B6rk");
    expect(artistHref("AC/DC")).toBe("/artist/AC%2FDC");
    // Channel ids are URL-safe, so the canonical id form is untouched.
    expect(artistHref(CHANNEL_ID)).toBe(`/artist/${CHANNEL_ID}`);
  });

  it("trims the key and yields a bare route for empty input", () => {
    expect(artistHref("  Aurora Sky  ")).toBe("/artist/Aurora%20Sky");
    expect(artistHref("")).toBe("/artist/");
  });

  it("round-trips back into the same resolution key", () => {
    for (const key of ["Aurora Sky", "Björk", "AC/DC", "Tyler, The Creator", CHANNEL_ID]) {
      const recovered = artistRequestKey(segmentOf(artistHref(key)));
      expect(recovered, key).not.toBeNull();
      if (recovered !== null) {
        if ("id" in recovered) {
          // An id key must survive the round trip exactly — an id is never
          // re-sent as a name.
          expect(recovered.id, key).toBe(key);
        } else {
          expect(recovered.name, key).toBe(key);
        }
      }
    }
  });
});

describe("the shared entity-key module", () => {
  it("is the single definition of the rules both catalog routes classify with", () => {
    // The album route imports these from `@/lib/entityKeys`; if the two features
    // each declared their own copy they could drift, and a key minted by one
    // would be sent under the other's contract. Pinned by identity, not by value.
    expect(artistKeys.isProviderEntityId).toBe(entityKeys.isProviderEntityId);
    expect(artistKeys.normalizeEntityText).toBe(entityKeys.normalizeEntityText);
  });
});

describe("normalizeEntityText", () => {
  it("trims and collapses whitespace without touching case or punctuation", () => {
    expect(normalizeEntityText("  Aurora   Sky \n")).toBe("Aurora Sky");
    expect(normalizeEntityText("Lumivox")).toBe("Lumivox");
    expect(normalizeEntityText("Björk")).toBe("Björk");
    expect(normalizeEntityText("A.C/D.C")).toBe("A.C/D.C");
    expect(normalizeEntityText("")).toBe("");
    expect(normalizeEntityText("   ")).toBe("");
  });
});

describe("the artist key module's published surface", () => {
  it("exports exactly the helpers the entry points and view consume", () => {
    // Pinned because the M8/M9 entry points import `artistHref` to repoint at
    // this route: a renamed or dropped export must fail here rather than at the
    // call site.
    expect(Object.keys(artistKeys).sort()).toEqual([
      "artistHref",
      "artistRequestKey",
      "isProviderEntityId",
      "normalizeEntityText",
    ]);
  });
});
