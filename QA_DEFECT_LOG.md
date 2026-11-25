# QA Defect Log: Mortgage Geek

Every confirmed defect, open or closed. A defect enters this log only after it has been
reproduced and confirmed by a second, independent method (section 3 of QA_STRATEGY.md).
Each open defect has exactly one narrowly scoped allowance in
`tests/e2e/support/knownDefects.ts` and a characterization test that fails when the defect
is fixed or changes shape.

## Severity scale

| Severity | Meaning |
|---|---|
| Critical | A wrong financial figure or eligibility answer a borrower could act on, or the site or a tool is unusable |
| High | A core feature broken or misleading for many visitors, no reasonable workaround |
| Medium | A feature broken or visibly degraded, with a workaround or limited reach |
| Low | Minor, cosmetic, or invisible to visitors, with a quality or compliance cost |

## Summary

| ID | Title | Severity | Status | Decision (2026-11-24) |
|---|---|---|---|---|
| D-2 | Prerendered `<style>` content is HTML-escaped; hydration fails on every page | Medium (was High) | Open, fix planned | Remediation branch scheduled after Phase 2 (sooner if it interferes with calculator testing). Priority raised within Medium: it masks every other hydration error |
| D-3a | `/manifest.json` is not deployed | Medium | Fixed (2026-11-25) | Approved: separate branch; service worker stays off |
| D-3b | `/service-worker.js` is not deployed | Low | Open | Do not enable until the caching strategy is reviewed |
| D-1 | Prerendering inserts NUL bytes before some multi-byte characters | Low | Deferred | No workaround. Fix with the React 19 upgrade; a React-only test verifies the upgrade |
| D-4 | Two public pages have no `<h1>` | Low | Fixed (2026-11-25) | Approved: small isolated fix, no visual change |
| T-1 | Test defect: page HTML read from the browser inspector cache (flaky on WebKit in CI) | Medium (test) | Fixed | Found by the flaky gate on its first CI run |
| D-5 | FHA annual MIP ignores loan term: 15-year loans charged the 30-year rate | Medium | Open | Found in Phase 2 rule review. Not fixed; awaiting decision |
| D-6 | FHA annual MIP ignores loan size: base loans over $726,200 charged the standard rate | High | Open | Found in Phase 2 rule review. Not fixed; awaiting decision |
| D-7 | Keyboard entry in comma-formatted fields appends instead of replacing (Chrome, Edge) | Medium | Open | Found in Phase 2. Not fixed; awaiting decision |
| R-6 | PreQual USDA rate never live; must equal FHA (owner's rule) | High | Open, fix needed | 2026-11-25: USDA always matches FHA on every page. Backlog |
| R-1 | Rate API failure shows hardcoded rates credited to Mortgage News Daily | Medium | Open, fix needed | 2026-11-25: fall back to the last good (e.g. yesterday's) rate, dated. Backlog |
| R-2 to R-5, R-7 | Other rate-source findings (see QA_RATE_SOURCES.md) | Low to Medium | Open, for reference | Backlog |

---

## D-2: Prerendered `<style>` content is HTML-escaped; hydration fails on every page

- **Severity:** Medium. Downgraded from High on 2026-11-24 after measurement showed no
  load-time cost (see Business impact). **Found:** 2026-11-24, first Playwright smoke run.
- **Reproduction:**
  1. `npm run build`
  2. Open `build/client/about/index.html`, find the first `<style>` element: it contains
     `&#x27;`, `&quot;`, `&gt;`, `&amp;` instead of `'`, `"`, `>`, `&`.
  3. Load any public page (local build or live site) with the console open.
- **Expected:** prerendered CSS is valid; React hydrates the static HTML with no errors.
- **Actual:** React errors #425 (text mismatch), #418 (hydration failed), #423 (root switches to
  client rendering), 24 to 101 times per page; React discards the server HTML, including the
  `<html>` element itself, and re-renders the document. The mangled `@import url(&#x27;...)`
  requests a relative URL `&`, which 404s.
- **Root cause:** 106 sites render `<style>{css}</style>`. React's server renderer escapes text
  children. `<style>` is a raw-text element in HTML, so browsers do not decode the entities;
  the CSS arrives broken, and on hydration the DOM text differs from what React renders.
- **Evidence:**
  - Identical error counts on the live site and the local build (5 pages checked).
  - Dev build's readable warning: `Text content did not match. Server: ... @import url(&#x27;https://fonts.googleapis.com/...`
  - Experiment (throwaway worktree): replacing all 106 sites with `dangerouslySetInnerHTML`
    removed every hydration error and the `/&` 404 on all 5 pages.
  - Screenshot with JavaScript disabled: the calculator renders in fallback system fonts
    instead of Figtree/Archivo; layout otherwise intact.
- **Business impact (measured):**
  - Visible: the brand fonts are missing until the page becomes interactive (median 2.7 to
    5.9 s on a throttled mobile profile), then fonts swap and text reflows.
  - Quality: while every page fails hydration, no test can detect any *other* hydration bug.
    A new server/client mismatch (dates, saved state, layout checks) would be invisible.
  - Performance: **no measurable load-time cost.** Lab medians (7 runs, 4x CPU, 150 ms RTT,
    1.6 Mbps, 412x823) for the experimental fix vs. current: hydration errors 24-101 to 0,
    Total Blocking Time 0-47 ms to 0-22 ms, time-to-interactive, FCP, LCP and CLS unchanged
    within noise. An earlier statement that D-2 "largely loses the speed benefit of
    prerendering" was an unmeasured assumption and is withdrawn.
- **Regression tests:** `known-defects.spec.ts` "D-2 still present as documented" (3 routes,
  both browsers): asserts the signature in served HTML and exactly the codes 418/423/425.
  Allowance: hydration codes only when every page loaded in the test carries the signature;
  the `&` 404 only at the exact page-relative URL (`known-defect-allowances.http.spec.ts`
  proves both).
- **Resolution criteria:**
  1. No `<style>` element in any prerendered page contains HTML entities (all 38 routes).
  2. Zero React hydration errors on all 38 public routes, both browser projects, with the D-2
     allowance removed from `knownDefects.ts`.
  3. No visual change: screenshot comparison of all 38 routes x 2 viewports, before vs after.
  4. Before/after lab measurement with the same script and conditions, recorded here.
  5. Any hydration bug that D-2 was masking is logged as its own defect.
- **Remediation plan (branch `fix/d2-inline-style`, from `main` after the Playwright branch
  merges):**
  1. Add `src/components/InlineStyle.jsx`: `<style dangerouslySetInnerHTML={{ __html: css }} />`
     (named export). Safe because every CSS string is a constant in our code, never user
     input; a comment will say so.
  2. Capture baseline screenshots of all 38 routes x 2 viewports on `main`.
  3. Replace the 106 sites mechanically; review the diff by hand (multi-child sites join with
     `+`).
  4. Remove the D-2 allowance and characterization test; run the full suite; compare
     screenshots; rerun the measurement script.
  5. Commit the measurement script (`scripts/measurePerf.mjs`) with before/after results.

## D-3a: `/manifest.json` is not deployed

- **Severity:** Medium. **Found:** 2026-11-24 (WebKit requests the manifest on load).
- **Reproduction:** `curl -I https://mortgagegeek.ai/manifest.json` returns 404.
- **Expected:** 200 with the web app manifest that every page links in `<head>`.
- **Actual:** 404. The file is at the repo root; only `public/` is copied into `build/client`,
  which is Vercel's output directory.
- **Root cause:** file location (a public file outside `public/`). `vercel.json` sets cache headers for `/manifest.json` and
  `src/root.jsx` links it, so it was intended to be served. Not established whether it ever
  was.
- **Evidence:** live 404; absent from `build/client`; all four icons the manifest references
  exist in `public/favicons/`.
- **Business impact:** the /install page invites visitors to install the app. Chrome and Edge
  need a valid manifest to offer installation, so the prompt never appears on Android or
  desktop. iOS "Add to Home Screen" still works through the apple-specific meta tags.
- **Fix (branch `fix/d3a-manifest`):** `git mv manifest.json public/manifest.json`. Content
  unchanged. `service-worker.js` stays at the repo root, so it is still not deployed and the
  registration in `src/root.jsx` still fails harmlessly (D-3b unchanged, as decided).
- **Verification (2026-11-24, local production build):**
  - `build/client/manifest.json` is byte-identical to the source.
  - All 4 icons return 200 and their PNG headers match the declared sizes (192, 512, 1024,
    maskable 512). The maskable icon's artwork fits Android's safe zone: the farthest corner of
    the mark is about 194 px from center; the 80% circle is 205 px.
  - Launch URL `/` and the 3 shortcut URLs (`/calculator`, `/prequal`, `/cash-to-close`)
    return 200.
  - Chromium's parsed manifest (DevTools protocol `Page.getAppManifest`), production vs fix:
    production: 0 bytes, no name, no icons, display undefined. Fix: 1,751 bytes, "Mortgage
    Geek", standalone, 4 icons, 3 shortcuts, theme color #CF3338. `/geek-log` still gets
    `geeklog.webmanifest`.
  - **Not a valid check:** `Page.getInstallabilityErrors` returned no errors on production
    too, because current Chromium offers a basic "install page as app" for any site. It cannot
    tell broken from fixed, so the tests do not use it.
  - Fault injection: moving the file back to the repo root makes 43 tests fail (the 4
    manifest tests and 39 WebKit page tests that now flag the 404 with no allowance).
- **Verified on the Vercel preview (2026-11-24):** `/manifest.json` 200 with
  `Content-Type: application/manifest+json; charset=utf-8` and `Cache-Control: public,
  max-age=0, must-revalidate`; all 4 icons and `/geeklog.webmanifest` 200; Chromium parses
  it as a standalone app (1,751 bytes, 4 icons, 3 shortcuts, no errors); `/service-worker.js`
  still 404, and with service workers allowed the page registers none.
- **Still to verify by hand, on real devices:** Chrome on Android offers "Install app" with
  the Mortgage Geek name and icon; iOS "Add to Home Screen" opens standalone with the cream
  apple-touch-icon.
- **Browser behavior after the fix:** Chrome and Edge (desktop, Android) can install it as a
  standalone app with its name, icon and 3 shortcuts (long-press the icon on Android). iOS
  Safari ignores manifest icons and keeps using `apple-touch-icon`; it reads `display`.
  Firefox desktop does not install web apps. No offline support (no service worker).
- **Observation:** `background_color` is red (#CF3338) while the app icon is cream, so the
  Android splash screen is a red field with a cream icon. Possibly intended; a design call.
- **Regression tests:** `pwa-manifest.http.spec.ts` (served, valid, icons at declared sizes,
  launch and shortcut URLs load, linked from all 38 public pages, Geek Log keeps its own) and
  `pwa-manifest.spec.ts` (Chromium parses it as a standalone app). The D-3a allowance, its
  harness test and its characterization test are removed; a `/manifest.json` 404 now fails
  any browser test.
- **Resolution criteria:** preview checks pass (done); device checks pass; merge after the
  Playwright branch.

## D-3b: `/service-worker.js` is not deployed

- **Severity:** Low (no offline support; the main cost is the gap between what the code
  intends and what ships). **Found:** 2026-11-24.
- **Reproduction:** `curl -I https://mortgagegeek.ai/service-worker.js` returns 404.
- **Expected / Actual / Root cause:** as D-3a; `src/root.jsx` attempts registration on every
  page load and logs a warning when it fails.
- **Dependency:** must ship after D-3a. The worker's install step pre-caches
  `/manifest.json` with `cache.addAll()`, which fails the entire install if any file 404s.
- **Decision required before enabling:** see "Service worker review" below.
- **Regression test:** `known-defects.spec.ts` "D-3b still present as documented".
- **Resolution criteria:** a reviewed caching strategy (below) implemented and tested,
  including the update path and a kill switch, before the file is deployed.

### Service worker review (the current `service-worker.js`)

What it does today, if deployed:

| Request | Strategy | Problem |
|---|---|---|
| Install | Pre-caches `/`, `/manifest.json`, 4 icons | Fails completely while D-3a is open |
| Images | Cache-first, never revalidated | A changed logo or chart image stays stale until someone bumps `CACHE_VERSION` by hand |
| HTML, JS, CSS | Network-first, every 200 copied into the cache | Cache grows without limit (every page, every old JS bundle) |
| Offline, not cached | Falls back to the cached **homepage** for any request | A missing JS or CSS file gets HTML back; an uncached page shows the homepage at the wrong URL |
| `/api/*` | Never cached | Correct |
| Updates | `skipWaiting()` + `clients.claim()` | A new worker takes over open tabs mid-session |

Proposed strategy (for review, not implemented):

1. **HTML navigations:** network-first with a short timeout, falling back to that same page
   if cached, otherwise a small offline page. Never another page's HTML.
2. **Hashed build assets (`/assets/*`):** cache-first. Their file names change whenever their
   content changes, so a cached copy can never be stale.
3. **Images and icons:** stale-while-revalidate: show the cached copy, refresh it in the
   background.
4. **`/api/*`:** network only, never cached (unchanged).
5. **Cache invalidation:** cache name derived from the build (not a hand-edited constant);
   `activate` deletes every other cache; a cap on cached pages.
6. **Updates:** keep the waiting worker until the visitor's next navigation, or show a "new
   version available, refresh" notice, instead of swapping code under an open page.
7. **Kill switch:** keep a ready-to-deploy worker that unregisters itself and clears its
   caches, so a bad worker can be removed from visitors' devices quickly.

**Financial data freshness:**

- **Market rates** are never cached by the worker. But today, when `/api/rates` fails
  (offline, or the Mortgage News Daily page changes), the calculator silently uses built-in
  defaults (6.75% / 6.25%) with no visible sign the rates are not current. A worker makes
  offline use more likely, so it should ship with a visible "rates not current" state.
  (Phase 2 will test what the calculator shows when the rate fetch fails.)
- **Program rules and limits** (MIP, funding fees, loan limits, tax rates) are compiled into
  the JavaScript. A visitor offline runs whatever version they last cached. Network-first HTML
  plus hashed assets keeps online visitors current; offline visitors could see last year's
  limits after a January update. Showing the effective date of program data mitigates this.

## D-1: Prerendering inserts NUL bytes before some multi-byte characters

- **Severity:** Low. **Found:** 2026-11-24.
- **Reproduction:** `npm run build`, then count 0x00 bytes in
  `build/client/deep-dives/gift-funds/index.html` (3, before a 🤓) and
  `build/client/deep-dives/fha-manual-underwriting/index.html` (1, before a •).
- **Expected:** no NUL bytes in any HTML. **Actual:** as above; also on the live site.
- **Root cause (confirmed):** a bug in React 18.3.1's Node server renderer,
  `writeStringChunk` in `react-dom/cjs/react-dom-server.node.*.js`. When the next character
  does not fit in the remaining space of its 2048-byte buffer, it flushes `currentView` (the
  whole buffer) instead of `currentView.subarray(0, writtenBytes)`. The unfilled zero bytes
  are sent. React Router's default `entry.server` uses `renderToPipeableStream`, which takes
  this path.
- **Evidence:** source reading as above; a standalone reproduction with a bare React element
  (no site code, no `<style>`) produced NUL bytes when a multi-byte character landed at the
  boundary; byte counts match (4-byte emoji with 3 bytes of room: 3 NULs).
- **Related to D-2?** No. The D-2 experiment left the NUL bytes unchanged, and the standalone
  reproduction contains no `<style>` element.
- **Business impact:** invisible to visitors (browsers discard NUL characters in text). Tools
  reading raw HTML may treat the page as binary; SEO auditors may flag it. Which pages are
  affected depends on where multi-byte characters fall in the byte stream, so any content
  edit can move it to another page.
- **Decision (2026-11-24): deferred to the React 19 upgrade.** No custom `entry.server`
  workaround for a low-impact dependency defect. 18.3.1 is the final React 18 release, so no
  18.x patch will fix it. Not yet verified that React 19 fixes it.
- **Verifying the upgrade:** `known-defects.http.spec.ts` renders a bare React element (no
  site code) through `renderToPipeableStream` and asserts the exact 18.3.1 result: one input
  (2047 padding elements) produces 2 NUL bytes. Sensitivity checked: applying the one-line
  fix (`currentView.subarray(0, writtenBytes)`) to the installed React made the test fail;
  restoring React made it pass. On the upgrade branch:
  - Test still passes: React 19 did not fix it. Reopen the decision (workaround or wait).
  - Test fails: confirm 0 NUL bytes on all 38 routes (the routing spec will also fail, since
    its documented counts no longer match), then empty `KNOWN_NUL_BYTES`, delete the test and
    close D-1.
- **Regression tests:** `production-routing.http.spec.ts`: every public route must have exactly
  its documented NUL count (2 routes listed, all others 0). Content edits can move the NUL
  bytes to other pages; when that test fails after a content-only change, update
  `KNOWN_NUL_BYTES` from the new build and note it here (the React-only test is the one
  that tracks the cause). Plus `known-defects.http.spec.ts` above.
- **Resolution criteria:** 0 NUL bytes on all 38 routes; `KNOWN_NUL_BYTES` emptied; the
  React-only characterization test removed.

## D-4: Two public pages have no `<h1>`

- **Severity:** Low. **Found:** 2026-11-24.
- **Reproduction:** load `/jargon-decoder` or `/pre-approval-checklist`; list headings.
- **Expected:** one `<h1>` naming the page. **Actual:** the page title is an `<h2>` ("Jargon
  Decoder", "Pre-Approval Checklist") from the shared `SectionHeader` component; no `<h1>`.
- **Root cause:** both pages reuse a homepage section component, where `<h2>` is correct, as a
  standalone page.
- **Business impact:** screen-reader users jump to the `<h1>` to find a page's main content;
  a small SEO signal.
- **Fix (branch `fix/d4-page-headings`):** `SectionHeader` takes an optional `headingLevel`
  (default 2). `JargonDecoder` and `PreApprovalChecklist` pass 1 when `standalone`, so the
  standalone pages get an `<h1>` and the homepage sections stay `<h2>`.
- **No visual change, verified:** every element's box and computed style recorded before and
  after the fix on both pages, desktop Chromium and mobile WebKit. Computed styles identical;
  boxes within 1 px; 40 of 40 comparisons identical. The method was calibrated first: 80 of 80
  control runs without the change passed, and a deliberate 1 px margin change failed.
  (Plain screenshot comparison was tried first and rejected: text anti-aliasing differs by up
  to 1,715 pixels between identical loads, and font-load timing under D-2 shifts text by
  1.5 px. A tolerance large enough to absorb that would hide real changes.)
- **Regression test:** `smoke.spec.ts` "D-4 regression": both standalone pages have an `<h1>`
  with their title; the homepage still has exactly one `<h1>` and these sections are not it.
  The generic one-`<h1>` check in the smoke test now applies to all 38 routes.
- **Resolution criteria:** met on the branch; closes when merged.

## T-1 (test defect): page HTML read from the browser's inspector cache

- **Severity:** Medium for the suite (a flaky gate erodes trust in every result). **Found:**
  2026-11-24, first CI run after `failOnFlakyTests` was enabled. **Status:** Fixed.
- **Reproduction:** not reproducible locally (150 runs on macOS). In CI (Linux, slower), the
  "D-2 still present as documented on /" test failed once on mobile WebKit, then passed on
  retry, on two separate branches.
- **Expected:** the test reads the HTML the server sent. **Actual:**
  `response.text: Protocol error (Network.getResponseBody): Resource content was evicted from inspector cache`.
- **Root cause:** the test read the page body back from the browser after navigation. Under
  D-2, React replaces the whole document, and WebKit may drop the original body from its
  inspector cache first. A race that only loses on slower machines. The shared fixture used
  the same pattern for every page (it failed safe: a lost body removed the D-2 allowance, so
  the risk was false failures, never false passes).
- **Fix:** both places now fetch the HTML separately over plain HTTP from the same static
  server (identical bytes), so nothing depends on the browser's cache.
- **Evidence the policy worked:** the run was reported `1 flaky`, and `failOnFlakyTests`
  failed the job instead of letting it pass on the retry.
- **Verification:** removing the mechanism, not narrowing the timing; 440-run WebKit burn-in
  (smoke + D-2 tests x10) with zero failures; CI rerun on the branch.
- **Regression test:** the suite itself; CI with `failOnFlakyTests` reports any recurrence.

## D-5 and D-6: FHA annual MIP ignores the loan term and the loan size

Found 2026-11-25 while building the Phase 2 reference calculations, by checking the program
rules against their published source before writing expected values.

- **Source:** HUD Mortgagee Letter 2023-05 (effective for case numbers endorsed on or after
  March 20, 2023), Appendix 1.0, read from hud.gov
  (`https://www.hud.gov/sites/dfiles/OCHCO/documents/2023-05hsgml.pdf`):

  | Term | Base loan | LTV | Annual MIP | Duration |
  |---|---|---|---|---|
  | > 15 years | ≤ $726,200 | ≤ 90% / 90-95% / > 95% | 0.50 / 0.50 / 0.55% | 11 years / term / term |
  | > 15 years | > $726,200 | ≤ 90% / 90-95% / > 95% | 0.70 / 0.70 / 0.75% | 11 years / term / term |
  | ≤ 15 years | ≤ $726,200 | ≤ 90% / > 90% | 0.15 / 0.40% | 11 years / term |
  | ≤ 15 years | > $726,200 | ≤ 78% / 78-90% / > 90% | 0.15 / 0.40 / 0.65% | 11 / 11 / term |

  The letter ties the $726,200 threshold to the national conforming loan limit. Whether HUD
  has since moved the threshold with the annual conforming limit was not verified; check the
  current Handbook 4000.1 Appendix 1.0 before fixing.
- **Actual:** `fhaMiRate(downPct)` in `src/utils/mortgageMath.js` takes only the down
  payment: 0.55% under 5% down, else 0.50%. It never receives the term or the base loan. The
  30-year, standard-size rows match HUD; the other rows do not.
- **D-5, 15-year term (Medium, overstates the payment):** $350,000 at 3.5% down: app MIP
  $154.80/mo, HUD $112.58, **$42.22 too high**. At 10% down: app $131.25, HUD $39.38, **$91.88
  too high**. The calculator makes 15-year FHA look worse than it is next to conventional.
- **D-6, base loan over $726,200 (High, understates the payment):** reachable in the app:
  its FHA limits go up to $1,149,825 (Nashville MSA $1,029,250). $800,000 at 3.5% down: app
  $353.83/mo, HUD $482.50, **$128.67 too low**. $900,000 at 10% down: app $337.50, HUD $472.50,
  **$135.00 too low**. A wrong financial figure a borrower could act on, which the scale calls
  Critical; rated High because it reaches only high-balance FHA buyers in high-cost counties.
  Owner to confirm the severity.
- **Why the unit tests passed:** they test `fhaMiRate(3.5) === 0.55` and similar, exactly the
  rule the code implements. The function's inputs cannot express term or loan size, so no
  test of it could catch this. Expected values derived from the source table, not from the
  function's shape, are what found it.
- **Also affects:** Rent vs Own uses the same `resolveProgram` (30-year only, so D-5 does not
  apply there; D-6 does for high prices). PreQual has its own FHA logic (to be reviewed).
- **Regression tests (Phase 2):** characterization tests assert today's values with the HUD
  value in the test as the documented correct answer; they fail when the defect is fixed, and
  are then switched to assert the HUD value.
- **Resolution criteria:** `fhaMiRate` takes term, base loan and LTV; values match the table
  above at every band edge (90.00%, 95.00%, 78.00%, $726,200 and $726,201); card labels show
  the right rate; unit and browser tests assert the HUD values.

## D-7: Keyboard entry in comma-formatted fields appends instead of replacing (Chrome, Edge)

- **Severity:** Medium. **Found:** 2026-11-25, when Playwright's `fill()` put $99,999,999 in
  Home Price.
- **Reproduction (Chrome or Edge, desktop):** on `/calculator`, press Tab until Home Price is
  focused, type `400000`, press Tab.
- **Expected:** Home Price $400,000 (Tab selects the field's text; typing replaces it).
- **Actual:** $99,999,999. On focus, `CalcInput` switches the display from "350,000" to
  "350000". Setting the value programmatically clears the selection and puts the caret at the
  end, so the typed digits are appended ("350000400000"), and the value is clamped to the
  field's maximum on blur.
- **Not affected:** WebKit (Safari, iPhone) keeps the selection; clicking then selecting all,
  or triple-clicking, works in every browser; fields without thousands separators (the text
  does not change on focus).
- **Root cause:** `handleFocus` in `src/components/CalcInput.jsx` calls
  `setLocalVal(String(value))` for comma fields. Likely fix: select the text again after the
  re-render (`e.target.select()` in a layout effect), or stop reformatting on focus.
- **Business impact:** keyboard users and anyone who tabs through the form get an absurd price
  and every card recalculates on it. Obvious, so not a silent wrong number, but it breaks the
  calculator for keyboard users (WCAG 2.1.1) and reads as a broken site.
- **Regression test:** `calculator.inputs.spec.ts` "D-7 characterization" (Chromium asserts
  the defect, WebKit asserts correct behavior). The page object types like a mouse user so the
  calculation tests are not blocked by D-7.
- **Resolution criteria:** the Tab-and-type path gives $400,000 in Chromium and WebKit; the
  characterization test is rewritten to assert that for both.

## Observations (not defects)

- **O-1:** `src/pages/MainSite.jsx:20` and `src/pages/LearnPage.jsx:258` set `minHeight` twice
  in one style object; the second replaces the first, so the `100vh` fallback never applies
  (browsers without `dvh`, e.g. Safari before 15.4). The build warns on every run.
- **O-3:** under D-2, `document.fonts.ready` can resolve before the Google Fonts `@import`
  has registered any fonts, so text is measured in fallback fonts for a moment after load.
  Any future visual test must wait for specific registered font faces (see the D-4 method).
- **O-2:** the live `/api/rates` response on 2026-11-24 had `"change": null` for every rate and
  no 7/6 SOFR ARM entry, though the parser looks for both. Possibly a change on the source
  page. Not investigated.
- **O-4:** on the mobile layout, an eligible program card is a clickable `<div>` (select to
  show its pie chart) with no button role or keyboard handler; the desktop card is a proper
  `role="button"`. Touch users are unaffected; a keyboard or switch user on a narrow window
  cannot select a card. Found during the Phase 2 locator work (2026-11-25).
- **O-5:** VA cards show "Over Loan Limit" above the county limit. VA has not applied county
  loan limits to veterans with full entitlement since 2020 (Blue Water Navy Act). Not yet
  verified against a VA source; to confirm before logging as a defect.
