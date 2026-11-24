# QA Strategy: Mortgage Geek

How mortgagegeek.ai is tested, why it is tested that way, what is covered, what is not, and
what is known to be broken. Kept current with the suites; if this file and the code disagree,
the code is the truth and this file is the bug.

Last updated: 2026-11-24 (Phase 1 review: narrowed defect allowances, flaky policy, server limits).

Defects are tracked in [QA_DEFECT_LOG.md](QA_DEFECT_LOG.md).

## 1. Principles

1. **Expected values never come from the code under test.** Financial results come from an
   independent Python implementation with exact decimal arithmetic (`tests/reference/`) or
   from dated public sources (HUD, VA, USDA). Production behavior (status codes, redirects)
   comes from observing the live site, not from our own server script.
2. **A failing test is a question, not a verdict.** Before calling something a defect, confirm
   it with a second, independent method. Before changing an expected value, show the expected
   value was wrong. Expected values are never edited to make a test pass.
3. **Known defects stay visible, and their allowances stay narrow.** Each is logged in
   QA_DEFECT_LOG.md, tolerated in exactly one file and only when the page shows that defect's
   own evidence, and pinned by a characterization test that fails when the defect is fixed
   or changes shape (section 7).
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
  support/knownDefects.ts               the ONLY place known defects are tolerated (conditional)
  fixtures/rates.json                   fixed /api/rates response
  smoke.spec.ts                         every public route in a real browser
  production-routing.http.spec.ts       status codes, redirects, case, raw HTML (no browser)
  known-defects.spec.ts                 characterization test per open defect
  known-defect-allowances.http.spec.ts  proves each allowance rejects look-alike errors
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
  response fails the test, with its URL, unless a documented known defect explains it AND the
  page under test carries that defect's evidence. Tests that relied on an allowance get a
  `known-defect` annotation, visible in the HTML report.
- **On failure**, kept in `test-results/` and the HTML report: screenshot, full trace (DOM
  snapshots per step, network, console, filmstrip), and `error-context.md`. In CI these are
  uploaded as the `playwright-report` artifact for 14 days.
- **Retries:** 0 locally, 2 in CI, with `failOnFlakyTests` in CI (section 4a).

## 4a. Flaky tests: how they are identified, reported, and handled

**Definition.** A flaky test passes and fails on the same code. It is a defect, either in the
test (a race, a missing wait, shared state) or in the application (a real timing bug).

**How Playwright identifies one.** In CI each failing test is retried up to 2 times. A test
that fails and then passes on a retry is labelled **flaky** (a test that fails every attempt
is **failed**).

**How it is reported.**
- The `list` reporter prints a `flaky` count and each flaky test's name at the end of the log.
- The `github` reporter adds an annotation on the commit and pull request at the failing line.
- The HTML report (CI artifact `playwright-report`) has a **Flaky** filter; each flaky test
  shows every attempt, with the first failure's screenshot, error, and trace.
- `failOnFlakyTests: true` in CI makes the job **fail** when anything was flaky. Without it, a
  flaky test exits green, and a gate that sometimes passes broken code is not a gate. The
  retries still matter: they separate "flaky" from "consistently broken" and capture the
  evidence to diagnose it.

**How it is handled.**
1. Treat it as a defect: open a QA_DEFECT_LOG entry (test defect or application defect).
2. Reproduce locally with `npx playwright test <file> -g "<title>" --repeat-each=20 --workers=4`.
3. Fix the cause. Never "fix" flakiness by adding sleeps, longer timeouts, or more retries.
4. If it must be unblocked first: `test.fixme()` with the defect ID in the reason. It shows as
   skipped in every run, so it cannot be forgotten.
5. New tests get a burn-in before they are committed: `--repeat-each=10` in both browser
   projects, zero failures.

## 4b. Limits of the production-like server (`scripts/serveBuild.mjs`)

It reproduces Vercel's **static routing** (checked against the live site): exact files,
`<dir>/index.html` with or without a trailing slash, `vercel.json` redirects (308/307) and
rewrites, 404 for anything else, case-sensitive paths. It refuses to start if `vercel.json`
gains a setting it does not mirror (`trailingSlash`, `cleanUrls`, ...) or a route pattern it
cannot translate.

What it does **not** reproduce, so the suite cannot catch problems in these areas:

| Vercel behavior | Status | Mitigation |
|---|---|---|
| Serverless functions (`/api/*`) | Not served; tests mock them | API contract tests are a gap (section 8) |
| `vercel.json` `headers` (cache headers, `Referrer-Policy` on `/geek-log`) | Not applied | Check on the preview: `curl -I <preview-url>/geek-log` |
| CDN caching (`Cache-Control`, `s-maxage`, `stale-while-revalidate`), ETags, 304s | Not modeled | None yet |
| Compression (gzip, Brotli), HTTP/2, TLS | Not modeled | Not behavior-relevant for these tests |
| Redirect/rewrite features beyond `:param` and `:param*` (`has`, `missing`, regex, parameter substitution) | Refuses to start | Extend the server when first used |
| Domain-level behavior (www to apex, custom domains) | Not modeled | Vercel dashboard |
| Skew protection (old tabs requesting old JS after a deploy) | Not modeled | Relevant if D-3b ships |
| Edge middleware, environment variables, deployment protection | Not used today | Revisit if adopted |
| Custom `404.html` | None exists in production either | n/a |

The first two rows are the most likely to matter. A later step can run the smoke suite
against the Vercel preview URL after deploy to cover them.

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
| `production-routing.http.spec.ts` | 44 | Direct hit on a nested route serves its own HTML, query strings, vercel.json redirect and rewrite, unknown URL is 404, no NUL bytes in any prerendered page |
| `production-routing.http.spec.ts` (cont.) | | Case-sensitive paths, as on Vercel |
| `known-defects.spec.ts` | 4 per browser project (8 total) | Characterization of D-2, D-3b |
| `known-defect-allowances.http.spec.ts` | 5 | Each allowance applies only with its evidence and rejects look-alikes |
| `pwa-manifest.http.spec.ts` | 42 | D-3a regression: manifest served and valid, icons at declared sizes, launch and shortcut URLs load, linked from every public page, Geek Log manifest intact |
| `pwa-manifest.spec.ts` | 1 (Chromium only; skipped on WebKit) | Chromium parses the linked manifest as a standalone app |

Total: 178 tests plus 1 skip, about 28 seconds locally including the build.

Mutation checks (2026-11-24), each caught by the intended test: an injected `console.error`;
a deleted page title; an undocumented NUL-byte page; the manifest moved back out of `public/` (43 failures); a missing image on a page carrying D-2
(proves the D-2 allowance does not cover other 404s); a renamed D-4 title; a new `<h1>` on a
D-4 page.

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

The register is [QA_DEFECT_LOG.md](QA_DEFECT_LOG.md): ID, severity, reproduction, expected and
actual behavior, business impact, root cause, evidence, resolution criteria, and regression
test for each.

How an open defect is handled in the suite:

1. **One conditional allowance** in `tests/e2e/support/knownDefects.ts`, which applies only when
   the page under test carries that defect's evidence (e.g. D-2's escaped `<style>`), and only
   to the exact error it causes. `known-defect-allowances.http.spec.ts` proves each one rejects
   look-alike errors.
2. **One characterization test** asserting the defect's exact documented signature (e.g.
   exactly 3 NUL bytes, exactly React codes 418/423/425). It fails if the defect is fixed or
   changes shape. `test.fail()` is deliberately not used: it inverts the whole test, so any
   unrelated failure would count as "defect still present".
3. **Fixing a defect** means removing its allowance and characterization test in the same
   change, and updating the log.

## 8. Known limitations

- **While D-2 is open, no test can detect another hydration bug.** Every page already fails
  hydration, so React reports no further mismatches. This is the main reason to fix D-2.
- **The service worker is not tested** (blocked so request mocking is reliable; it is also not
  deployed, D-3b).
- **Serverless functions** (`api/`) are not tested by Playwright; tests mock them. The
  `/api/rates` scraper can break when the source page changes and no test would notice.
- **Firefox is not run.** Chromium plus WebKit covers the audience; Firefox can be added as a
  project if analytics show meaningful use.
- **Spec files are TypeScript but not type-checked.** Playwright strips types without checking
  them; adding `tsc --noEmit` would need `typescript` as a dependency.
- **The suite tests the build, not the deployment.** See section 4b for what the local server
  does not reproduce.
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
