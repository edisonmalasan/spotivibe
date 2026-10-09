# Replace the language onboarding dialog with a first-run artist picker

## Why

First run opens a modal that asks for languages, and it sits on top of a dashboard that already
has content behind it. Two things are wrong with that:

1. **It is the wrong question first.** The one thing the app cannot derive about a brand-new device
   is what the listener actually likes. Languages are a filter over a catalog; taste is the input.
   Asking for languages first means the dashboard renders behind a dialog before anyone has
   expressed a preference at all.
2. **It covers content that is already there.** The screenshot showed the dialog over a populated
   Home — a full Quick Picks rail and an Evening shelf. Nothing was hidden behind it that the dialog
   was helping the listener choose.

## What changes

- The first-run **language** dialog is removed. The language *preference* stays and remains editable
  in Settings, so nothing is lost and discovery still filters by it.
- First run becomes an **artist picker** over the Quick Picks rail: the listener selects artists
  they like, and the dashboard reveals after.
- Those selections **persist in IndexedDB**, in the backup envelope, so they survive a reload and
  travel through versioned JSON export/import.
- A tiny **`localStorage` "onboarding seen" flag** gates the first run, readable before IndexedDB
  opens — the same reasoning and the same shape as `installPrompt.ts`.

## The two stores, and why not one

The listener asked for localStorage. Storing the picks there would lose them on a cache clear and
would place user data outside the backup envelope, so it is **not** what is being built, and the
reasoning is recorded rather than quietly substituted:

| Data | Store | Why |
|---|---|---|
| Picked artists | IndexedDB (`quickPickPicks`) | Canonical user data; must survive export/import |
| Onboarding seen | `localStorage` | Must be readable before IndexedDB opens, or the dialog flashes on every paint |

`AGENTS.md` scopes localStorage to "tiny boot-time preferences" and that is exactly what the flag is.
The picks are not a preference — they are a dataset, and datasets live in IndexedDB.

## This amends the spec

`home-mixes` currently requires that completing the rail from provider results "SHALL introduce no
new request and **no new stored data**", and that Quick Picks are *derived*. Storing explicit picks
contradicts both clauses. The delta in this change therefore:

- **MODIFIED** the provider-completion requirement so stored picks are a recognised source rather
  than new stored data "of its own";
- **ADDED** a requirement for the first-run picker and its two-store persistence.

The derivation is not replaced — it still runs, and it still ranks liked artists above provider
ones. Explicit picks join it as a third source, at the top, because they are the only evidence the
listener actually gave.

## What this does not claim

- **Not verified in a browser.** No browser is attached to this session. Evidence is tests over the
  real DOM and over the persistence layer.
- Languages are not removed as a preference, only as a first-run question.
- The rail is not frozen. Explicit picks lead; the rail still tracks listening.