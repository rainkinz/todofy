/**
 * Fractional index between two neighbours, so a reorder writes one row instead
 * of renumbering the list. Shared by `orderIndex` and `boardIndex`.
 */
export function indexBetween(
  before: number | undefined,
  after: number | undefined,
): number {
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + 1;
  if (after !== undefined) return after - 1;
  return 0;
}
