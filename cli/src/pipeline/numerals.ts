/**
 * NUMERALS — the boundary between model-authored wording and code-authored receipts.
 *
 * Counts, dates, rates and every other quantitative claim in HUMAN.md are assembled by code. The
 * borrowed model supplies words only, so a numeric code point in one of those words is a refusal:
 * it is precision whose provenance the renderer cannot prove. Unicode matters here — refusing `2`
 * while accepting `２` or `②` would be a cosmetic guard rather than a trust boundary.
 */
const NUMERAL = /\p{N}/u;

export function hasNumeral(...parts: string[]): boolean {
  return parts.some((part) => NUMERAL.test(part));
}
