import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { LanguagesSettingsSection } from "@/features/preferences/LanguagesSettingsSection";
import { resetPreferencesStore } from "@/stores/preferencesStore";

/**
 * Settings → Languages.
 *
 * **This coverage used to live in `language-onboarding.test.tsx`, alongside the
 * first-run language dialog.** That dialog is gone on purpose — first run now
 * asks for artists (`ArtistOnboarding`) — but the *preference* stayed, so these
 * cases stayed too, and the original assertions are carried over verbatim rather
 * than paraphrased.
 *
 * Keeping them is what makes "we removed the dialog" different from "we removed
 * the ability to choose languages". If the Settings surface ever stops persisting
 * a changed selection, these fail.
 *
 * The cases that covered the deleted dialog itself (catalog multi-select,
 * keyboard operability, the a11y contract, the failed-write retry) are **not**
 * inherited by this file — they describe a surface that no longer exists, and
 * their equivalents for the new first-run surface live in
 * `artist-onboarding.test.tsx`. Carrying them over here would assert behaviour
 * of a deleted component.
 */

// IndexedDB round-trips plus a cold React start can exceed the 1s default.
configure({ asyncUtilTimeout: 5000 });

let repositories: RepositorySet;

beforeEach(async () => {
  resetPreferencesStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function confirmSelection(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Save languages" }));
}

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
