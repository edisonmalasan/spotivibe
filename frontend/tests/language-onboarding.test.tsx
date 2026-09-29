import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { LANGUAGES, MAX_SELECTED_LANGUAGES } from "@/lib/languages";
import {
  LANGUAGE_ONBOARDING_LABEL,
  LanguageOnboarding,
} from "@/features/preferences/LanguageOnboarding";
import { LanguagesSettingsSection } from "@/features/preferences/LanguagesSettingsSection";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";

/**
 * M8 task 3.3: first-run language onboarding against the real (fake-indexeddb)
 * preferences repository — the full catalog renders as a keyboard-operable
 * multi-select, confirming persists the languages and the completed flag
 * through the repository, dismissal leaves everything untouched, Settings
 * reopens the same picker, and no account/sign-in/email prompt is ever shown.
 */

// IndexedDB round-trips plus a cold React start can exceed the 1s default.
configure({ asyncUtilTimeout: 5000 });

let repositories: RepositorySet;

/** Opener stand-in: owns focus return like every other M7 dialog host. */
function OnboardingHarness({ onClose }: { onClose?: () => void } = {}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Choose languages
      </button>
      {open && (
        <LanguageOnboarding
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        />
      )}
    </div>
  );
}

beforeEach(async () => {
  resetPreferencesStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: LANGUAGE_ONBOARDING_LABEL });
}

async function confirmSelection(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Save languages" }));
}

describe("first-run language onboarding", () => {
  it("offers the whole catalog as a multi-select with accessible names", () => {
    render(<LanguageOnboarding onClose={vi.fn()} />);

    const options = screen.getAllByRole("checkbox");
    expect(options).toHaveLength(LANGUAGES.length);
    expect(options.length).toBeGreaterThanOrEqual(37);
    for (const language of LANGUAGES) {
      expect(screen.getByRole("checkbox", { name: language.name })).toBeInTheDocument();
    }
    // English is the pre-selected default; every other option starts unchecked.
    expect(screen.getByRole("checkbox", { name: "English" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Spanish" })).not.toBeChecked();
  });

  it("shows the English name and the endonym side by side", () => {
    render(<LanguageOnboarding onClose={vi.fn()} />);
    const spanish = screen.getByRole("checkbox", { name: "Spanish" }).closest("label");

    expect(within(spanish as HTMLElement).getByText("Spanish")).toBeInTheDocument();
    expect(within(spanish as HTMLElement).getByText("Español")).toBeInTheDocument();
  });

  it("keeps every option keyboard-operable with a visible focus ring", () => {
    render(<LanguageOnboarding onClose={vi.fn()} />);
    const spanish = screen.getByRole("checkbox", { name: "Spanish" });

    expect(spanish.tagName).toBe("INPUT");
    expect(spanish).toHaveAttribute("type", "checkbox");
    // The design system keeps a global :focus-visible outline, so no per-option
    // outline suppression may hide the ring.
    expect(spanish.className).not.toMatch(/outline-none/);

    spanish.focus();
    expect(spanish).toHaveFocus();
    spanish.click(); // native checkbox activation (Space/Enter equivalent)
    expect(spanish).toBeChecked();
  });

  it("shows the selected count, caps the selection, and offers select-all/clear", () => {
    render(<LanguageOnboarding onClose={vi.fn()} />);

    expect(screen.getByTestId("language-picker-count")).toHaveTextContent(
      `1 of ${MAX_SELECTED_LANGUAGES} selected`,
    );
    expect(screen.getByRole("button", { name: "Select all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByTestId("language-picker-count")).toHaveTextContent(
      `${MAX_SELECTED_LANGUAGES} of ${MAX_SELECTED_LANGUAGES} selected`,
    );
    // The catalog is wider than the cap, so unselected options lock at the cap.
    expect(screen.getByRole("checkbox", { name: "Russian" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByTestId("language-picker-count")).toHaveTextContent(
      "Choose at least one language.",
    );
    expect(screen.getByRole("button", { name: "Save languages" })).toBeDisabled();
  });

  it("filters the catalog without changing the selection", () => {
    render(<LanguageOnboarding onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Filter languages"), { target: { value: "span" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Spanish" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter languages"), { target: { value: "klingon" } });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByTestId("language-picker-no-matches")).toBeInTheDocument();
  });

  it("prompts no account, sign-in, or email step", () => {
    render(<LanguageOnboarding onClose={vi.fn()} />);

    expect(dialog().textContent).not.toMatch(
      /sign in|sign up|log in|signup|email|password|account|profile name/i,
    );
    expect(screen.getByText("You can change this later in Settings.")).toBeInTheDocument();
  });

  it("confirms the selection, persisting the languages and the completed flag", async () => {
    const onClose = vi.fn();
    render(<LanguageOnboarding onClose={onClose} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Hindi" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Japanese" }));
    await confirmSelection();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await repositories.preferences.get()).toMatchObject({
      languages: ["en", "hi", "ja"],
      onboardingComplete: true,
    });
    expect(usePreferencesStore.getState().languages).toEqual(["en", "hi", "ja"]);
    expect(usePreferencesStore.getState().onboardingComplete).toBe(true);
  });

  it("offers no second time after a reload: the completed flag survives", async () => {
    render(<LanguageOnboarding onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Korean" }));
    await confirmSelection();
    await waitFor(() => expect(usePreferencesStore.getState().onboardingComplete).toBe(true));

    // Reload: a fresh store reading the same repository sees the choice.
    resetPreferencesStore();
    await usePreferencesStore.getState().hydrate();
    expect(usePreferencesStore.getState().onboardingComplete).toBe(true);
    expect(usePreferencesStore.getState().languages).toEqual(["en", "ko"]);
  });

  it("normalizes a tampered selection before persisting it", async () => {
    render(<LanguageOnboarding onClose={vi.fn()} />);

    await usePreferencesStore.getState().hydrate();
    await usePreferencesStore.getState().completeOnboarding(["klingon", "es", "es", "  fr  "]);
    resetPreferencesStore();
    await usePreferencesStore.getState().hydrate();

    expect(usePreferencesStore.getState().languages).toEqual(["es", "fr"]);
  });

  it("reports a failed write and keeps the dialog open for a retry", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi
      .spyOn(repositories.preferences, "set")
      .mockRejectedValueOnce(new Error("storage blocked"));
    render(<LanguageOnboarding onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "French" }));
    await confirmSelection();

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your languages");
    expect(screen.getByRole("dialog", { name: LANGUAGE_ONBOARDING_LABEL })).toBeInTheDocument();
    expect((await repositories.preferences.get()).onboardingComplete).toBe(false);
    spy.mockRestore();
  });

  it("honors the dialog a11y contract: role, focus entry, and dismissal", () => {
    const onClose = vi.fn();
    render(<LanguageOnboarding onClose={onClose} />);

    const surface = dialog();
    expect(surface).toHaveAttribute("aria-modal", "true");
    expect(surface).toHaveFocus(); // keyboard users land inside the surface

    // A press inside the panel is not a backdrop press.
    fireEvent.mouseDown(surface);
    expect(screen.getByRole("dialog", { name: LANGUAGE_ONBOARDING_LABEL })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on a backdrop press and on Close, persisting nothing", () => {
    const onClose = vi.fn();
    const view = render(<OnboardingHarness onClose={onClose} />);

    fireEvent.mouseDown(dialog().parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Choose languages" }));
    expect(dialog()).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(2);

    // Dismissal never writes: onboarding is offered again on the next visit.
    expect(view.container.textContent).not.toMatch(/sign in|account/i);
    return repositories.preferences.get().then((stored) => {
      expect(stored.onboardingComplete).toBe(false);
      expect(stored.languages).toEqual([]);
    });
  });
});

describe("Settings → Languages", () => {
  it("summarizes the saved selection without competing live regions", async () => {
    await repositories.preferences.set({ languages: ["ja", "hi"], onboardingComplete: true });
    render(<LanguagesSettingsSection />);

    await waitFor(() =>
      expect(screen.getByTestId("languages-summary")).toHaveTextContent("Showing Japanese, Hindi."),
    );
    // The Data controls own the page's status/alert regions.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change languages" })).toBeInTheDocument();
  });

  it("reopens the picker and persists a changed selection the same way", async () => {
    await repositories.preferences.set({ languages: ["ja"], onboardingComplete: true });
    render(<LanguagesSettingsSection />);
    await waitFor(() =>
      expect(screen.getByTestId("languages-summary")).toHaveTextContent("Showing Japanese."),
    );

    fireEvent.click(screen.getByRole("button", { name: "Change languages" }));
    expect(screen.getByRole("checkbox", { name: "Japanese" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Tamil" }));
    await confirmSelection();

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save languages" })).toBeNull(),
    );
    expect((await repositories.preferences.get()).languages).toEqual(["ja", "ta"]);
    expect(screen.getByTestId("languages-summary")).toHaveTextContent("Showing Japanese, Tamil.");
  });

  it("discards the draft on cancel and keeps the stored selection", async () => {
    await repositories.preferences.set({ languages: ["ja"] });
    render(<LanguagesSettingsSection />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Change languages" })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Change languages" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Tamil" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect((await repositories.preferences.get()).languages).toEqual(["ja"]);
    expect(screen.getByTestId("languages-summary")).toHaveTextContent("Showing Japanese.");

    // Reopening starts from the saved selection, not the discarded draft.
    fireEvent.click(screen.getByRole("button", { name: "Change languages" }));
    expect(screen.getByRole("checkbox", { name: "Japanese" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Tamil" })).not.toBeChecked();
  });

  it("reports a blocked storage instead of rendering an unusable control", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi
      .spyOn(repositories.preferences, "get")
      .mockRejectedValueOnce(new Error("storage blocked"));
    render(<LanguagesSettingsSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Languages are unavailable");
    expect(screen.getByTestId("error-retry")).toBeInTheDocument();
    spy.mockRestore();
    warn.mockRestore();
  });
});
