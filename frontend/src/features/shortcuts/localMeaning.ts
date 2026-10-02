/**
 * The local-meaning guard (M18 design decision 1) — the whole safety story of the
 * global shortcut listener, in one pure function.
 *
 * A global keypress is only allowed to act when the key it just handled means
 * *nothing* to the element that received it. Everything the platform already
 * gives a key local meaning to is enumerated here: text entry, editable content,
 * a slider, a spinbutton, a dialog, and a menu.
 *
 * **Why one function rather than a check per handler.** Seven components already
 * bind individual keys (`ProgressSlider`, five dialogs, `ResultMenu`). A second
 * definition of "this key is mine" would be a seventh thing to keep in step, and
 * the one place that matters — "can a global shortcut ever steal this key?" —
 * would be unanswerable. As a pure function over an element it is decidable
 * without a browser and therefore testable directly, one assertion per surface
 * type, which is the only form of this claim that is evidence rather than a
 * review comment.
 *
 * **It reads nothing but the element.** No store, no `document.activeElement`, no
 * prop. The answer is a function of the target's tags, roles, and attributes, so
 * the same element cannot answer differently because some unrelated application
 * state moved underneath it.
 *
 * Each surface is a separately named selector rather than one built from a list,
 * because each is a separate claim with a separate failure: a rule that quietly
 * stopped matching one surface type is invisible in a combined list, and is
 * invisible in review too.
 *
 * `contenteditable` occurs nowhere in `src` today. It is here anyway: the
 * predicate is a statement about the web platform, not about today's inventory,
 * and an editable surface can arrive without anyone revisiting the shortcut code.
 */

/** Tags that own every keypress they receive. */
const TEXT_ENTRY_TAGS = ["input", "textarea", "select"] as const;

/**
 * A slider owns the arrow keys. It is the reason a global seek binding cannot be
 * written without a guard: `ProgressSlider` reads `ArrowLeft`/`ArrowRight` for a
 * five-second step, and a global ten-second seek on the same press would move the
 * position twice.
 */
const SLIDER_SELECTOR = '[role="slider"]';

/**
 * A spinbutton owns the arrow and number keys for the same reason, and no
 * surface in this repository carries the role today — which is exactly why it
 * belongs here: the predicate is about the platform, not about the inventory.
 */
const SPINBUTTON_SELECTOR = '[role="spinbutton"]';

/**
 * A dialog subtree owns every key while it is open. The five hand-rolled dialogs
 * additionally call `stopPropagation()` on `Escape`, so the shortcut listener's
 * bubble phase never sees that press at all; this rule covers the rest of the
 * keyboard, and any dialog that does not stop propagation.
 */
const DIALOG_SELECTOR = '[role="dialog"]';

/**
 * A menu subtree, for the same reason. `ResultMenu` is the case that makes this
 * load-bearing rather than theoretical: it does *not* stop propagation, so its
 * `Escape` really does reach the global listener, and the only thing stopping a
 * second action is this rule.
 */
const MENU_SELECTOR = '[role="menu"]';

/**
 * The element a target denotes, or `null` when there is none to ask about.
 *
 * A composed event can target a text node rather than an element; a text node
 * carries no roles of its own and inherits its parent's, so the parent is the
 * element the question is really about. `document` has no parent and therefore no
 * local meaning — which is the correct answer for a keypress nobody focused.
 */
function asElement(target: EventTarget | null): Element | null {
  if (target === null) return null;
  const candidate = target as Partial<Element> & { parentElement?: Element | null };
  if (typeof candidate.closest === "function") return candidate as Element;
  return candidate.parentElement ?? null;
}

/**
 * Whether the element sits inside editable content.
 *
 * `isContentEditable` is the platform's resolved answer — it already accounts for
 * inheritance and for a nested `contenteditable="false"` cancelling an editable
 * ancestor — so it is preferred wherever it exists. The attribute walk is the
 * fallback, and it reads the *nearest* `[contenteditable]`, which is the element
 * whose value wins; an explicit `"false"` is not editable.
 */
function hasEditableContent(element: Element): boolean {
  const host = element.closest("[contenteditable]");
  if (!host) return false;
  const resolved = (element as Element & { isContentEditable?: boolean }).isContentEditable;
  if (resolved === true) return true;
  return (host.getAttribute("contenteditable") ?? "").trim().toLowerCase() !== "false";
}

/**
 * Whether the key that reached `target` already meant something local.
 *
 * `true` for an `input`, `textarea`, or `select`; anything inside editable
 * content; a slider or spinbutton; and anything inside an open dialog or menu.
 * `false` for an ordinary element, an element carrying an unrelated role, and a
 * target that is not an element at all.
 */
export function keyHasLocalMeaning(target: EventTarget | null): boolean {
  const element = asElement(target);
  if (!element) return false;

  if (TEXT_ENTRY_TAGS.includes(element.tagName.toLowerCase() as (typeof TEXT_ENTRY_TAGS)[number])) {
    return true;
  }
  if (hasEditableContent(element)) return true;
  if (element.closest(SLIDER_SELECTOR)) return true;
  if (element.closest(SPINBUTTON_SELECTOR)) return true;
  if (element.closest(DIALOG_SELECTOR)) return true;
  return element.closest(MENU_SELECTOR) !== null;
}
