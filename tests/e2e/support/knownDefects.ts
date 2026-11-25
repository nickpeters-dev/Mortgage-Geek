// The ONLY place the suite tolerates known production defects. Each allowance
// is tied to one defect ID in QA_DEFECT_LOG.md and is CONDITIONAL: it applies
// only when evidence of that exact defect is present in the page under test,
// so it cannot wave through an unrelated failure that happens to look similar.
//
// Every open defect also has a characterization test (known-defects.spec.ts or
// production-routing.http.spec.ts) asserting its exact documented signature.
// When a defect is fixed, that test fails, and its allowance here is removed in
// the same change.
export type ServedDocument = { url: string; html: string };

// D-2 signature: HTML entities inside a <style> element. Browsers do not decode
// entities there, so their presence means the prerendered CSS is mangled.
export function hasD2Signature(html: string): boolean {
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    if (/&(#x27|quot|amp|gt|lt);/.test(m[1])) return true;
  }
  return false;
}

// Returns the defect ID that explains `error`, or null if no documented defect
// does (in which case the test must fail).
export function explainByKnownDefect(
  error: string,
  ctx: { baseURL: string; documents: ServedDocument[] },
): string | null {
  const d2Docs = ctx.documents.filter((d) => hasD2Signature(d.html));
  const everyDocHasD2 = ctx.documents.length > 0 && d2Docs.length === ctx.documents.length;

  // D-2: React hydration failure codes, tolerated only if EVERY page loaded in
  // this test was served with the D-2 signature. A page whose CSS is fine gets
  // no allowance, so a different hydration bug there fails the test.
  if (/Minified React error #(418|423|425)\b/.test(error) && everyDocHasD2) return "D-2";

  // D-2: the mangled @import url(&#x27;...) resolves to "&" relative to the
  // page. Only that exact URL, only for a page carrying the signature.
  const notFound = error.match(/^HTTP 404 (\S+)$/);
  if (notFound && d2Docs.some((d) => new URL("&", d.url).href === notFound[1])) return "D-2";

  return null;
}

// D-1: exact NUL byte counts in prerendered HTML. Every other route must have 0.
export const KNOWN_NUL_BYTES: Record<string, number> = {
  "/deep-dives/gift-funds": 3,
  "/deep-dives/fha-manual-underwriting": 1,
};
