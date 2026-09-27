/**
 * Shared normalization stage (design decision 1): every tier's candidates go
 * through the same conversions so behavior is identical regardless of tier.
 *
 * Task 3.1 adds candidate→Track conversion here; duration text parsing
 * (`M:SS` / `H:MM:SS`, Lyrix-derived) is needed by the tier parsers first.
 */

/**
 * Parse a clock-style duration text into seconds.
 *
 * @returns whole seconds for `M:SS` / `H:MM:SS`, or `0` when the text is not
 * a parsable duration. `0` means "the tier presented a duration but it is
 * invalid" — distinct from an absent duration (`undefined`), which the filter
 * stage treats more leniently (design decision 9).
 */
export function parseDurationText(text: string): number {
  const parts = text.trim().split(":").map(Number);
  if (parts.length !== 2 && parts.length !== 3) return 0;
  if (!parts.every((part) => Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}
