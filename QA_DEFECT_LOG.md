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
| D-2 | Prerendered `<style>` content is HTML-escaped; hydration fails on every page | Medium (was High) | Open | Approved: investigate and plan on a dedicated branch, with before/after measurement |
| D-3a | `/manifest.json` is not deployed | Medium | Open | Separated from D-3b. Fix proposed, awaiting approval |
| D-3b | `/service-worker.js` is not deployed | Low | Open | Do not enable until the caching strategy is reviewed |
| D-1 | Prerendering inserts NUL bytes before some multi-byte characters | Low | Open, root cause found | Fix options listed, awaiting decision |
| D-4 | Two public pages have no `<h1>` | Low | Fix in progress | Approved: small isolated fix, no visual change |

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
- **Root cause:** file location. `vercel.json` sets cache headers for `/manifest.json` and
  `src/root.jsx` links it, so it was intended to be served. Not established whether it ever
  was.
- **Evidence:** live 404; absent from `build/client`; all four icons the manifest references
  exist in `public/favicons/`.
- **Business impact:** the /install page invites visitors to install the app. Chrome and Edge
  need a valid manifest to offer installation, so the prompt never appears on Android or
  desktop. iOS "Add to Home Screen" still works through the apple-specific meta tags.
- **Proposed fix:** `git mv manifest.json public/manifest.json`. No service worker involved.
  Current Chrome installability criteria do not require a service worker; to be confirmed on
  the Vercel preview (Chrome DevTools > Application > Manifest shows installability errors).
- **Regression test:** `known-defects.spec.ts` "D-3a still present as documented". Allowance:
  a 404 for exactly `/manifest.json`, only while the file is absent from the build.
- **Resolution criteria:** `/manifest.json` returns 200 with `application/manifest+json`
  (or JSON) on the preview; DevTools reports no installability errors; the D-3a allowance
  and characterization test are removed; a test asserts the manifest's icons all return 200.

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
- **Fix options:** (a) a custom `src/entry.server.jsx` that strips 0x00 from the prerender
  stream (valid HTML never contains it); (b) upgrade to React 19 (not verified to fix it).
  18.3.1 is the final React 18 release.
- **Regression test:** `production-routing.http.spec.ts`: every public route must have exactly
  its documented NUL count (2 routes listed, all others 0).
- **Resolution criteria:** 0 NUL bytes on all 38 routes; `KNOWN_NUL_BYTES` emptied.

## D-4: Two public pages have no `<h1>`

- **Severity:** Low. **Found:** 2026-11-24.
- **Reproduction:** load `/jargon-decoder` or `/pre-approval-checklist`; list headings.
- **Expected:** one `<h1>` naming the page. **Actual:** the page title is an `<h2>` ("Jargon
  Decoder", "Pre-Approval Checklist") from the shared `SectionHeader` component; no `<h1>`.
- **Root cause:** both pages reuse a homepage section component, where `<h2>` is correct, as a
  standalone page.
- **Business impact:** screen-reader users jump to the `<h1>` to find a page's main content;
  a small SEO signal.
- **Regression test:** `smoke.spec.ts` asserts, for these two routes only, no `<h1>` and the
  exact `<h2>` title.
- **Resolution criteria:** each page has exactly one visible `<h1>` with the same text, no
  visual change (screenshot comparison), entries removed from `ROUTES_WITHOUT_H1`.

## Observations (not defects)

- **O-1:** `src/pages/MainSite.jsx:20` and `src/pages/LearnPage.jsx:258` set `minHeight` twice
  in one style object; the second replaces the first, so the `100vh` fallback never applies
  (browsers without `dvh`, e.g. Safari before 15.4). The build warns on every run.
- **O-2:** the live `/api/rates` response on 2026-11-24 had `"change": null` for every rate and
  no 7/6 SOFR ARM entry, though the parser looks for both. Possibly a change on the source
  page. Not investigated.
