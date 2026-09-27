/**
 * Typed failures surfaced by the local-data layer so the UI can distinguish
 * "storage is unavailable" (show an error state) from unexpected bugs.
 */

/** Base class for expected local-data failures. */
export class LocalDataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LocalDataError";
  }
}

/** IndexedDB could not be opened (storage disabled, quota, private mode). */
export class StorageUnavailableError extends LocalDataError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageUnavailableError";
  }
}
