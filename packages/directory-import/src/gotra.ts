/**
 * The Agrawal gotra vocabulary, used as a parsing anchor.
 *
 * Why a vocabulary and not a coordinate: the three booklets draw their header
 * row differently (the Boys files emit "Date of Birth Birth Time" as one run and
 * omit "Name" and "Eduation" entirely), so column boundaries derived from header
 * positions do not survive across files. What does survive is that gotra is a
 * closed set of eighteen clan names — so finding it in a row splits birth place
 * from education without needing to know where the printed rules are.
 *
 * Spelling in the source is inconsistent (`Eran` for `Airan`, `Mital` for
 * `Mittal`), so variants map onto one canonical spelling. Matching is
 * case-insensitive.
 */

/** Canonical spelling → the variants seen in the booklets. */
const GOTRA_VARIANTS: Record<string, readonly string[]> = {
  Airan: ["airan", "eran", "aeran", "airon"],
  Bansal: ["bansal", "bansl"],
  Bindal: ["bindal", "bindl"],
  Bhandal: ["bhandal"],
  Dharan: ["dharan", "dhaaran"],
  Gangal: ["gangal"],
  Garg: ["garg", "gargh"],
  Goyal: ["goyal", "goyan", "goel"],
  Jindal: ["jindal", "jindl"],
  Kansal: ["kansal", "kansl"],
  Kuchhal: ["kuchhal", "kuchal"],
  Madhukul: ["madhukul", "madhukal"],
  Mangal: ["mangal", "mangl"],
  Mittal: ["mittal", "mital", "mitl"],
  Nangal: ["nangal"],
  Singhal: ["singhal", "singal"],
  Tayal: ["tayal", "tayl"],
  Tingal: ["tingal"],
  Tundal: ["tundal", "tundl"],
};

const LOOKUP = new Map<string, string>();
for (const [canonical, variants] of Object.entries(GOTRA_VARIANTS)) {
  for (const variant of variants) LOOKUP.set(variant, canonical);
}

/** Canonical gotra for a token, or null if it isn't one. */
export function canonicalGotra(token: string): string | null {
  return LOOKUP.get(token.trim().toLowerCase().replace(/[.,]/g, "")) ?? null;
}

export function isGotra(token: string): boolean {
  return canonicalGotra(token) !== null;
}
