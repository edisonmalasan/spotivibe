/**
 * The end-to-end fixture router's readiness, as two pure decisions.
 *
 * ## Why this is extracted from `harness.mjs`
 *
 * The original router set a flag **after** awaiting `Fetch.enable`, and its handler returned
 * without continuing a request that arrived before the flag was set. Both halves of the resulting
 * failure are a hang rather than an error, so the end-to-end run presented as an intermittent
 * failure somewhere downstream of the real cause.
 *
 * The fix was verified only by reading it, and then only by a source assertion comparing string
 * indices. The mutation proof showed that assertion was **unchecked**: restoring the silent drop
 * left the whole suite green, because the assertion only proved the word `continueRequest` appeared
 * *somewhere* inside the not-ready branch, and a branch that drops the request first and continues
 * second still contains it.
 *
 * So the decisions are here, as functions with no CDP in them, and the test asserts on what they
 * return. A source assertion cannot pass against a comment or against code placed after an early
 * return; a returned value cannot.
 */

/** What the paused-request handler should do. There is deliberately no "drop". */
export const PAUSED_ACTION = {
  /** A different target's request. Left entirely to that target's own session. */
  IGNORE: "ignore",
  /** This router is not intercepting yet, so the request must be allowed to proceed. */
  CONTINUE: "continue",
  /** The router is ready; look for a route. */
  ROUTE: "route",
};

/**
 * What to do with a paused request.
 *
 * @param {{ready: boolean}} readiness
 * @param {boolean} isPageSession whether the event came from the page's own CDP session
 */
export function pausedAction(readiness, isPageSession) {
  if (!isPageSession) return PAUSED_ACTION.IGNORE;
  // The order of these two tests is the fix. Testing readiness first and *continuing* when unset is
  // what closes the window; there is no path from here that leaves a request unresolved.
  return readiness.ready ? PAUSED_ACTION.ROUTE : PAUSED_ACTION.CONTINUE;
}

/**
 * Mutable readiness, so the ordering is expressed once rather than at each call site.
 *
 * `claim` is separate from `beginRouting` so that the ordering is enforced by the caller being
 * unable to enable interception without claiming first — see `beginRouting`.
 */
export function createReadiness() {
  let ready = false;
  return {
    get ready() {
      return ready;
    },
    claim() {
      ready = true;
    },
    release() {
      ready = false;
    },
  };
}

/**
 * Begin intercepting.
 *
 * `claim` happens **before** `send` is called, and that ordering is the whole point. The original
 * code awaited `Fetch.enable` and only then set the flag, so for the duration of that await the
 * domain was intercepting while the handler believed it was not, and every request paused in the
 * window was discarded.
 *
 * On failure the claim is released. Leaving it set would make the handler *continue* requests it
 * has no interception configured to intercept, which is a quieter version of the same bug reached
 * by a different route — and the reason this is a rollback rather than a plain assignment.
 *
 * @param {{
 *   send: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
 *   readiness: {claim: () => void, release: () => void},
 *   patterns: ReadonlyArray<Record<string, unknown>>,
 * }} options
 */
export async function beginRouting({ send, readiness, patterns }) {
  readiness.claim();
  try {
    await send("Fetch.enable", { patterns });
  } catch (error) {
    readiness.release();
    throw error;
  }
}