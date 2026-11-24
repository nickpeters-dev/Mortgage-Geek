// Known, documented production defects (QA_STRATEGY.md, "Known defects"). The
// shared fixture and smoke test tolerate ONLY what is listed here, so every
// other console error, uncaught exception, failed request, or missing heading
// still fails.
//
// Each defect also has a test marked test.fail() in known-defects.spec.ts. When
// the defect is fixed, that test starts passing, Playwright reports the
// unexpected pass as a failure, and the entries here get removed with it.

export const KNOWN_DEFECT_ERRORS: { id: string; pattern: RegExp }[] = [
  // D-2: <style>{css}</style> is HTML-escaped in prerendered output, so the
  // static CSS is broken and hydration fails on every page.
  { id: "D-2", pattern: /Minified React error #(418|423|425)/ },
  // D-2: the escaped @import url(&#x27;...) resolves to a relative URL "&".
  { id: "D-2", pattern: /^HTTP 404 .*\/&$/ },
  // D-3: manifest.json is not in the build output, so it 404s in production.
  // WebKit requests it on load; Chromium does not.
  { id: "D-3", pattern: /^HTTP 404 .*\/manifest\.json$/ },
];

// D-4: public pages whose main title is an <h2>, with no <h1>.
export const ROUTES_WITHOUT_H1 = new Set(["/jargon-decoder", "/pre-approval-checklist"]);
