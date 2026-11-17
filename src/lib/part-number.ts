/**
 * Part-number normalization.
 *
 * The same part reaches the counter spelled half a dozen ways:
 *   "RE-50749", "re 50749", "RE50749", "R.E.50749"
 * All of them must find one record. Normalizing to uppercase alphanumerics
 * is crude but it is what the industry's interchange files effectively do,
 * and it is cheap enough to index.
 *
 * ProductCrossReference.normalized stores the output of this function, so
 * the lookup query is a plain indexed `contains` rather than a regex scan.
 */
export function normalizePartNumber(input: string): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * True when two part numbers refer to the same part for lookup purposes.
 */
export function partNumbersMatch(a: string, b: string): boolean {
  const na = normalizePartNumber(a);
  return na.length > 0 && na === normalizePartNumber(b);
}

/** Pretty-print a cross-reference type for the lookup grid. */
export const CROSS_REF_LABELS: Record<string, string> = {
  OEM: "OEM",
  ALTERNATE: "Alt",
  SUPERSEDED: "Superseded",
  INTERCHANGE: "Interchange",
  VENDOR_PART: "Vendor",
};
