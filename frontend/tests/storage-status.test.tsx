import { configure, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageNotice } from "@/features/storage/StorageNotice";
import {
  resetStorageStore,
  useStorageStatus,
  useStorageStore,
} from "@/features/storage/storageStatus";
import { StorageUnavailableError } from "@/data/repositories";

/**
 * M14 task 2.3: a storage failure the listener can tell apart from an empty library.
 *
 * The behavior this replaces: a failed read logged a warning and the surface fell
 * through to its empty state, which is what someone with an unreadable library and
 * someone with no tracks both saw.
 */

configure({ asyncUtilTimeout: 5000 });

const getLocalData = vi.hoisted(() => vi.fn());
vi.mock("@/data/localData", () => ({ getLocalData }));

beforeEach(() => {
  resetStorageStore();
  getLocalData.mockReset();
  getLocalData.mockResolvedValue({ likedTracks: {}, playlists: {} });
});

describe("storage status (task 2.3)", () => {
  it("records a healthy connection without showing anything", async () => {
    render(<StorageNotice />);
    await waitFor(() => expect(useStorageStore.getState().status).toBe("ready"));
    expect(screen.queryByTestId("storage-notice")).toBeNull();
  });

  it("names an unavailable database and says the data was not deleted", async () => {
    getLocalData.mockRejectedValue(
      new StorageUnavailableError("Could not open the Spotivibe database."),
    );
    render(<StorageNotice />);

    const notice = await screen.findByTestId("storage-notice");
    // A status region, like every other status surface in the shell.
    expect(notice).toHaveAttribute("role", "status");
    // What happened...
    expect(notice).toHaveTextContent(/could not read your local data/i);
    // ...that it is not data loss, which is the whole point...
    expect(notice).toHaveTextContent(/nothing was deleted/i);
    expect(notice).toHaveTextContent(/still on this device/i);
    // ...and what they can do about it.
    expect(notice).toHaveTextContent(/private browsing|full disk|denying site data/i);
    // The failure's own name is kept, so a future copy can distinguish an open failure
    // from an upgrade failure without the surfaces guessing.
    expect(useStorageStore.getState().reason).toBe("StorageUnavailableError");
  });

  it("does not mistake a failure for an empty library", async () => {
    // The old behavior in one assertion: the store said nothing, so the library
    // rendered its empty state and the person could not tell the two apart.
    getLocalData.mockRejectedValue(new StorageUnavailableError("no storage"));
    render(<StorageNotice />);
    await screen.findByTestId("storage-notice");
    expect(useStorageStore.getState().status).toBe("unavailable");
  });

  it("records nothing while unknown, so a notice cannot flash before the answer", () => {
    expect(useStorageStore.getState().status).toBe("unknown");
    const { container } = render(<StorageNotice />);
    expect(container.querySelector('[data-testid="storage-notice"]')).toBeNull();
  });

  it("observes the connection once, no matter how many surfaces ask", async () => {
    getLocalData.mockRejectedValue(new StorageUnavailableError("no storage"));
    function Observer() {
      useStorageStatus();
      return null;
    }
    render(
      <>
        <Observer />
        <Observer />
        <StorageNotice />
      </>,
    );
    await screen.findByTestId("storage-notice");
    // The connection is memoized by the data layer; asking again must not re-open it.
    expect(getLocalData).toHaveBeenCalledTimes(1);
  });

  it("does not report unavailable for an unrelated error shape", async () => {
    // A thrown non-Error still means storage did not open, so the notice is right - but
    // the reason must say so honestly rather than inventing a class name.
    getLocalData.mockRejectedValue("a string, not an Error");
    render(<StorageNotice />);
    await screen.findByTestId("storage-notice");
    expect(useStorageStore.getState().reason).toBe("unknown");
  });
});
