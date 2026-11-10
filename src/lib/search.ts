const WORD = /[\p{L}\p{N}]+/gu;
const MAX_QUERY_TERMS = 5;

/** Lowercase word tokens, stored in an indexed array so search can prefix-match any word. */
export function tokenize(...values: (string | undefined)[]): string[] {
  const tokens = new Set<string>();
  for (const value of values) {
    for (const word of value?.toLowerCase().match(WORD) ?? []) tokens.add(word);
  }
  return [...tokens];
}

/** Digits-only forms of a phone number, so "01711…" and "+8801711…" both match. */
export function phoneTokens(phone: string | undefined): string[] {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (!digits) return [];
  return digits.startsWith("880") ? [digits, digits.slice(2)] : [digits];
}

/**
 * Every term must prefix-match some token. An anchored, case-sensitive regex on the
 * lowercase tokens becomes an index range scan on `searchTokens`.
 */
export function searchFilter(search: string | undefined) {
  const terms = tokenize(search).slice(0, MAX_QUERY_TERMS);
  if (terms.length === 0) return {};
  // Tokens contain only letters and digits, so they need no regex escaping.
  return { $and: terms.map((term) => ({ searchTokens: { $regex: `^${term}` } })) };
}
