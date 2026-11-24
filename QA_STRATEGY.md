# QA Strategy: Mortgage Geek

How mortgagegeek.ai is tested, why it is tested that way, what is covered, what is not, and
what is known to be broken. Kept current with the suites; if this file and the code disagree,
the code is the truth and this file is the bug.

Last updated: 2026-11-24 (Playwright Phase 1: infrastructure, smoke, production routing).

## 1. Principles

1. **Expected values never come from the code under test.** Financial results come from an
   independent Python implementation with exact decimal arithmetic (`tests/reference/`) or
   from dated public sources (HUD, VA, USDA). Production behavior (status codes, redirects)
   comes from observing the live site, not from our own server script.
2. **A failing test is a question, not a verdict.** Before calling something a defect, confirm
   it with a second, independent method. Before changing an expected value, show the expected
   value was wrong. Expected values are never edited to make a test pass.
3. **Known defects stay visible.** They are documented here, tolerated by ID in one file, and
   pinned by a `test.fail()` test that flips red when the defect is fixed (section 7).
4. **Deterministic or it does not ship.** No test depends on live rates, the date, the
   machine's locale, test order, or another test's leftovers.
5. **Few, valuable browser tests.** Math is proven by fast unit tests. Browser tests prove that
   what the user sees is right, which is where wiring, state, and formatting bugs live.

## 2. Test architecture

```
              ┌──────────────────────────────────────────┐
  few, slow   │ Playwright (tests/e2e/)                  │  Does the user see the right thing?
              ├──────────────────────────────────────────┤
              │ check:prerender (scripts/)               │  Is the static HTML and SEO right?
              ├──────────────────────────────────────────┤
  many, fast  │ node:test + Python parity (tests/*.mjs)  │  Is the math right?
              └──────────────────────────────────────────┘
```

| Layer | Runner | Files | Runs in CI job |
|---|---|---|---|
| Unit (calculator, Rent vs Own) | `node:test` | `tests/*.test.mjs` | `verify` |
| Python parity | node script vs Python reference | `scripts/rentVsOwnParity.mjs`, `tests/reference/` | `verify` |
| Prerender and SEO | node script | `scripts/checkPrerender.mjs` | `verify` |
| End to end | Playwright | `tests/e2e/**/*.spec.ts` | `e2e` |

### Playwright layout

```
playwright.config.ts                    projects, web server, diagnostics
scripts/serveBuild.mjs                  serves build/client the way Vercel does
tests/e2e/
  support/test.ts                       shared fixtures: rates mock, error gate, gotoHydrated()
  support/knownDefects.ts               the ONLY place known-defect errors are tolerated
  fixtures/rates.json                   fixed /api/rates response
  smoke.spec.ts                         every public route in a real browser
  production-routing.http.spec.ts       status codes, redirects, raw HTML (no browser)
  known-defects.spec.ts                 one test.fail() per open defect
```

### Projects (one suite, three environments)

| Project | Browser | Viewport | Purpose |
|---|---|---|---|
| `http` | none | n/a | Raw HTTP: status, redirects, served HTML |
| `desktop-chromium` | Chromium | 1280x720 | Calculator "cockpit" layout (>= 1100px) |
| `mobile-webkit` | WebKit (Safari engine) | iPhone 13 | Mobile layout, touch, Safari behavior |

Most browser specs run in both desktop and mobile projects. The calculator renders a separate
set of inputs per layout, so this is how both get tested without writing tests twice.

### Isolation from the node:test suite

- Playwright is pinned to `testDir: tests/e2e` and `testMatch: **/*.spec.ts`. Its default
  pattern would otherwise pick up `tests/*.test.mjs`.
- `npm test` names its files explicitly and never reads `tests/e2e/`.
- Different extensions (`.spec.ts` vs `.test.mjs`), different runners, different CI jobs.
- Checked: `npx playwright test --list` finds 0 `.test.mjs` files; `npm test` still reports
  146 cases (142 pass, 4 TODO).

## 3. How determinism is achieved

| Source of flakiness | Control |
|---|---|
| Live market rates (`/api/rates` scrapes Mortgage News Daily) | Every browser test gets `fixtures/rates.json` via `page.route()`. Any other `/api/*` call returns 501 and fails the test. |
| Service worker answering requests behind `page.route()` | `serviceWorkers: "block"` |
| Typing before React has hydrated the static HTML | `gotoHydrated()` waits for `<html data-hydrated="true">`, set by a mount effect in `src/root.jsx` that runs after every page's own mount effects |
| Desktop/mobile layout swap after first render | Covered by the same hydration wait; web-first assertions retry until the final layout |
| Locale and timezone | Pinned in config: `en-US`, `America/Chicago` |
| Leftover localStorage between tests | Each test gets a new browser context (empty storage, no cookies) |
| Stale build | The web server command builds before serving, every run |
| Today's date (Cash to Close default closing date, "Generated" dates) | Phase 2+: Playwright clock (`page.clock`) where a test depends on it |

### Why a custom static server

Checked against the live site on 2026-11-24:

| Request | Production | `vite preview` | `python3 -m http.server` | `serveBuild.mjs` |
|---|---|---|---|---|
| `/calculator` | 200, calculator HTML | 200, **homepage** HTML | 301 to `/calculator/` | 200, calculator HTML |
| `/deep-dives/gift-funds` | 200, own HTML | 200, **homepage** HTML | 301 | 200, own HTML |
| `/geek-log` (rewrite) | 200 | 200 | 404 | 200 |
| `/geek-maps` (redirect) | 308 to `/deep-dives` | 200 | 404 | 308 to `/deep-dives` |
| unknown URL | 404 | **200 homepage** | 404 | 404 |

`vite preview` would hide a route missing from the prerender list, because React repaints the
right page over the wrong HTML. `serveBuild.mjs` reads `vercel.json` at startup and refuses to
start on a route pattern it cannot translate.

## 4. Assertions and failure diagnostics

- **Web-first assertions** (`await expect(locator).toHaveText(...)`) retry until they pass or
  time out (5s). No sleeps.
- **Locators** prefer what a user or screen reader perceives: `getByRole`, `getByLabel`.
  `data-testid` only where no semantic hook exists.
- **Global error gate** (shared fixture): any console error, uncaught exception, or HTTP 400+
  response fails the test, with its URL, unless it belongs to a documented known defect.
- **On failure**, kept in `test-results/` and the HTML report: screenshot, full trace (DOM
  snapshots per step, network, console, filmstrip), and `error-context.md`. In CI these are
  uploaded as the `playwright-report` artifact for 14 days.
- **Retries:** 0 locally (see flakiness), 2 in CI. A test that passes on retry is reported as
  *flaky*, not hidden.

## 5. Risk-based prioritization

Risk = likelihood of a defect x cost if a borrower acts on it. A wrong payment or a wrong
eligibility answer is the costliest failure this site can have, so those get the most tests.

| Priority | Area | Why | Status |
|---|---|---|---|
| P1 | Calculator payment shown on screen, all four programs | Borrowers make decisions on this number | Planned, Phase 2 |
| P1 | Mortgage insurance and upfront fees per program and tier | Rule boundaries are where bugs hide | Planned, Phases 3-4 |
| P1 | Pre-qualification: DTI and purchasing power | Directly answers "what can I afford" | Planned, Phase 4 |
| P2 | Program eligibility messages (min down, USDA 30-yr only, loan limits) | Logic exists only in the page, untested by unit tests | Planned, Phase 3 |
| P2 | Input handling (limits, empty fields, comma format, $/% sync) | Wiring bugs unit tests cannot see | Planned, Phase 3 |
| P2 | Every public page loads without errors | Broken page = lost lead | **Done (Phase 1)** |
| P2 | Production routing (direct hits, refresh, redirects, 404) | Prerender regressions return 404 to real users | **Done (Phase 1)** |
| P3 | Mobile layout, no horizontal overflow | Primary audience is on phones | Partially (smoke runs on iPhone); Phase 5 |
| P3 | Saved state across pages (Compare, visible programs) | Annoying, not costly | Planned |

### Coverage today (Phase 1)

| Spec | Tests | What it proves |
|---|---|---|
| `smoke.spec.ts` | 39 per browser project (78 total) | All 38 public routes: HTTP 200, no redirect, hydrates, one visible h1, own title survives hydration, no console errors or failed requests. Plus refresh on a nested route. |
| `production-routing.http.spec.ts` | 43 | Direct hit on a nested route serves its own HTML, query strings, vercel.json redirect and rewrite, unknown URL is 404, no NUL bytes in any prerendered page |
| `known-defects.spec.ts` | 7 per browser project (14 total) | One expected failure per open defect |

Total: 135 tests, about 30 seconds locally including the build.

Mutation check (2026-11-24): an injected `console.error`, a deleted page title, and an
un-documented NUL-byte page were each caught by the intended test.

## 6. Running the tests

```bash
npm run test:e2e                        # everything: builds, serves, runs all three projects
npm run test:e2e:ui                     # UI mode: watch, time-travel through each step
npm run test:e2e:report                 # open the last HTML report

npx playwright test --project=mobile-webkit           # one project
npx playwright test smoke.spec.ts                     # one file
npx playwright test -g "calculator"                   # titles matching a pattern
npx playwright test --headed                          # watch the browser
npx playwright test --debug                           # step through with the inspector
npx playwright test --list                            # what would run, without running
npx playwright show-trace test-results/<test>/trace.zip   # replay a failure
npx playwright codegen http://localhost:4321          # record a flow (start serveBuild first)
```

`npm test` and `npm run verify` are unchanged and do not run Playwright.

## 7. Known defects

All four were present on the live site when found. Each is tolerated only through
`tests/e2e/support/knownDefects.ts` and pinned by a `test.fail()` test. **None has been fixed;
each needs an owner decision first.**

### D-2 (High): prerendered CSS is HTML-escaped, so hydration fails on every page

- **What:** pages render `<style>{css}</style>`. React's prerenderer escapes the text (`'` to
  `&#x27;`, `"` to `&quot;`, `>` to `&gt;`). Browsers do not decode entities inside `<style>`,
  so the static HTML ships broken CSS. When React loads, the text does not match, hydration
  fails (React errors #425, #418), and **the entire page is re-rendered from scratch in the
  browser** (#423). The mangled `@import url(&#x27;...)` for Google Fonts also requests a
  relative URL `&`, which 404s.
- **Evidence:** identical error counts on the live site and the local build (/, /about,
  /calculator, /deep-dives/gift-funds, /geek-charts). The dev build's readable warning names
  the `@import url(&#x27;...` text directly. Experiment in a throwaway worktree: replacing the
  106 `<style>{...}</style>` sites with `dangerouslySetInnerHTML` removed every hydration error
  and the `/&` 404 on all five pages.
- **Business impact:** before JavaScript runs, every page renders with broken font and
  selector rules. Then React discards the prerendered page and rebuilds it, so the speed
  benefit of prerendering is largely lost, and the swap likely adds layout shift and delays
  the largest paint. Those are Core Web Vitals, which feed Google ranking (likely, not yet
  measured). Visitors whose JavaScript fails see a mis-styled site. Content still prerenders,
  so indexing of text is not affected.
- **Recommended fix:** a small shared component (e.g. `<InlineStyle css={...} />`) using
  `dangerouslySetInnerHTML`, swapped in at all 106 sites, verified by removing the D-2 entries
  from `knownDefects.ts` and the `test.fail()` marker. Touches about 50 files across the site,
  so it is its own workstream.

### D-3 (Medium): `/manifest.json` and `/service-worker.js` are not deployed

- **What:** both files sit at the repo root, not in `public/`, so they never reach
  `build/client` (Vercel's output directory). Both return 404 on the live site, although
  `vercel.json` sets cache headers for them and `src/root.jsx` links and registers them.
- **Business impact:** the site's own /install page invites visitors to install the app, but
  Chrome and Edge (Android and desktop) require a manifest to offer installation, and no
  service worker means no offline support. iOS "Add to Home Screen" still works through the
  apple-specific meta tags. Not verified whether this ever worked in production.
- **Fix caution:** moving the files into `public/` would switch on a caching service worker
  for every visitor. A service worker bug can keep stale pages on users' devices and is slow
  to undo, so the worker's caching rules need review before it goes live.

### D-1 (Low): prerendering inserts NUL bytes before some multi-byte characters

- **What:** `/deep-dives/gift-funds` (3 NUL bytes before a 🤓) and
  `/deep-dives/fha-manual-underwriting` (1 before a •). The source files are clean; the bytes
  appear during prerendering. Root cause not confirmed (React 18.3.1 server rendering is the
  likely area). Independent of D-2: the D-2 experiment did not remove them.
- **Business impact:** browsers discard NUL characters in page text, so visitors see nothing.
  Tools reading raw HTML may treat the page as binary (macOS `grep` did), and SEO auditors
  may flag it.

### D-4 (Low): two public pages have no `<h1>`

- **What:** `/jargon-decoder` and `/pre-approval-checklist` use an `<h2>` as the page title,
  in both layouts.
- **Business impact:** screen-reader users navigate by the top-level heading to find the main
  content; a small SEO signal. Changing the tag may change default font size, so it is a
  visual change to review.

### Other observations (not tracked as defects)

- `src/pages/MainSite.jsx:20` and `src/pages/LearnPage.jsx:258` set `minHeight` twice in one
  style object (`"100vh"` then `"100dvh"`). In JavaScript the second key replaces the first,
  so the intended `100vh` fallback never applies (affects only browsers without `dvh`,
  e.g. Safari before 15.4). The build warns about it on every run.

## 8. Known limitations

- **The service worker is not tested** (blocked so request mocking is reliable; it is also not
  deployed, D-3).
- **Serverless functions** (`api/`) are not tested by Playwright; tests mock them. The
  `/api/rates` scraper can break when the source page changes and no test would notice.
- **Firefox is not run.** Chromium plus WebKit covers the audience; Firefox can be added as a
  project if analytics show meaningful use.
- **Spec files are TypeScript but not type-checked.** Playwright strips types without checking
  them; adding `tsc --noEmit` would need `typescript` as a dependency.
- **The suite tests the build, not the deployment.** Vercel-only behavior beyond `vercel.json`
  (edge caching, headers) is not covered. A post-deploy smoke run against the preview URL is
  a possible later addition.
- **Visual appearance is not compared** (no screenshot diffing).

## 9. CI/CD

`.github/workflows/ci.yml` runs two parallel jobs on every push and pull request:

- `verify`: reference files current, unit tests, Python parity, build, prerender check
- `e2e`: installs Chromium and WebKit, runs the full Playwright suite against the app built
  from that commit, uploads report, traces, and screenshots as an artifact

### Deployment gating (current state: NOT gated)

As of 2026-11-24, `main` has no branch protection. Vercel deploys to production on every push
to `main` regardless of CI, so a failing check prevents nothing. Closing that gap needs
settings outside the repo; see the Phase 1 summary for the proposed changes. Nothing has been
changed.
