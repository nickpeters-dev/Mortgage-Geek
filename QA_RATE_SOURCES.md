# Rate Sources Review: live, cached, default and manual rates

Status: **for review. No rate behavior has been changed.** Findings R-1 to R-7 are pinned by
characterization tests in `tests/e2e/rate-sources.spec.ts`. When a behavior is changed on
purpose, its test is rewritten to assert the approved behavior, in the same change.

Reviewed 2026-11-24 against `test/playwright-e2e` (code reading, browser tests with mocked
responses, and the live `/api/rates`).

## Decisions (2026-11-25, owner)

| ID | Decision | Status |
|---|---|---|
| R-6 | **USDA always equals the FHA rate**, on every page. Mortgage News Daily may not publish USDA, and USDA prices at or below FHA, so matching FHA is the conservative choice. This is already the calculator's and Cash to Close's rule; PreQual must follow it | **Fixed** (2026-11-25) |
| R-1 | When live rates fail, **auto-populate with the last good rate (for example yesterday's)**, dated, instead of hardcoded defaults (recommendation 6 below) | Fix needed (backlog) |
| R-2 to R-5, R-7 | Logged for reference | Backlog, not yet prioritized |

When a fix lands, its `R-n` test is rewritten to assert the decided behavior. R-6: PreQual now
sets USDA from the FHA rate; "R-6 regression" checks PreQual and the calculator both show the
FHA value for USDA (6.625 in the test fixture). Without the fix the PreQual check fails in both
browsers.

## 1. How a rate reaches the page

```
Mortgage News Daily page --(scrape)--> /api/rates (Vercel function)
   --(Vercel CDN: fresh 30 min, then up to 60 min stale while it refreshes)-->
      each page, after it becomes interactive --> rounding --> rate field
```

- **`/api/rates`** (`api/rates.js`) downloads the Mortgage News Daily rates page and, for
  each product label, takes the first `N.NN%` within 800 characters of the label, kept only
  if it is between 2% and 12%. It answers `success: true` if **at least one** product parsed;
  otherwise HTTP 500 with `success: false`.
- **`date`** in the response is the server's clock when the function ran (`new Date()`), not
  the date of the Mortgage News Daily figures. Confirmed live: on 2026-11-24 it returned
  "Tuesday, November 24, 2026".
- **Rounding** (calculator, PreQual, Cash to Close): round to the nearest 0.125%, then add
  0.125%. Live 30-year 7.32% is shown as 7.500%.
- **Before the page is interactive**, the prerendered HTML shows the built-in defaults with the
  hint "Adjust rates manually or they'll auto-populate when live data loads". While D-2 is
  open that lasts 3 to 6 seconds on a slow phone. The hint is accurate during loading.

## 2. The four kinds of rate, and how the code tells them apart

| Kind | Exists today? | How the code knows | What the visitor sees |
|---|---|---|---|
| **Live** | Yes | `ratesLoaded = true` after a `success: true` response | "Live rates loaded · {date}" (calculator, PreQual), "LIVE" tag + date (Cash to Close) |
| **Cached** | Server side only | Not distinguishable. The CDN may serve a response up to 90 minutes old; its `date` is when it was generated. No browser cache (no localStorage, no service worker) | Same as live |
| **Default** | Yes | `ratesLoaded = false`, plus every program missing from a partial response (no flag at all) | No badge. The text crediting Mortgage News Daily stays. See R-1, R-3 |
| **Manual** | Yes | URL `?program=X&rate=Y` is protected from live overwrite. A typed or slider value is not tracked (R-4) | The visitor's number, until something overwrites it |

Per page:

| Page | On failure | Manual rate protected? | Notes |
|---|---|---|---|
| Calculator | Defaults 6.750 / 6.250 / 6.250 / 6.250, silent | URL only | USDA follows FHA |
| PreQual | Same, silent | No URL param; typed values not protected | USDA never live (R-6) |
| Cash to Close | Default, no message at all | URL only | Shows "Loading today's rates..." while waiting |
| Homepage "Live Rates" tab | **Shows an error message** | n/a (display only) | The right pattern |
| Rent vs Own, Buy vs Invest charts | Silent fallback | **Yes** (`touchedRates`, `userTouchedRate`) | Range-checked. The right pattern |

## 3. Findings

Severity uses the scale in QA_DEFECT_LOG.md. Payment examples are principal and interest only,
calculated independently (Python), at the calculator's defaults: $350,000, 3.5% down, 30 years.

| ID | Finding | Severity | Test |
|---|---|---|---|
| R-1 | When live rates fail, built-in rates are shown **still credited to Mortgage News Daily**, with a promise they will "auto-populate when live data loads" that never happens. Cash to Close says nothing at all | Medium | `R-1:` (calculator, PreQual, Cash to Close) |
| R-2 | On failure, a 15-year term keeps the 30-year default (6.750); the 15-year default (6.000) is only used after a successful load | Low | `R-2:` |
| R-3 | A partial response (some products not parsed) shows a "Live" badge while the missing programs silently keep defaults | Medium | `R-3:` |
| R-4 | A rate the visitor typed is replaced by the live rate when the live rate arrives later, and **every time the loan term changes** (conventional) | Medium | `R-4:` (both cases) |
| R-5 | No age check, and the date shown is the request date, not the data date. A weekend or holiday visitor sees today's date on the last business day's figures | Low | `R-5:` |
| R-6 | **PreQual's USDA rate is never live.** It looks for a "usda" product that the API never returns, so USDA stays 6.250 under a "Live" badge. The calculator uses the FHA rate for USDA | High | `R-6:` |
| R-7 | The scraper accepts the first percentage near a label. A layout change on the source page could produce a wrong but plausible rate (within 2% to 12%) that is shown as live. Not testable in the browser; needs server-side checks | Medium (risk) | none yet |

**Why these matter (business impact):**

- **R-1, understated payment.** On 2026-11-24 the live 30-year rate shows as 7.500%. During an
  outage the calculator shows 6.750% credited to Mortgage News Daily: $2,190.64 instead of
  $2,361.60 a month, **$170.96 (7%) understated**, presented as a market figure. Frequency is
  unknown: no monitoring records how often `/api/rates` fails (Vercel function logs contain
  "Rate fetch error" lines; checking them would size this). Observation O-2 shows the scraper
  already partially fails at times (no ARM entry, `change` sometimes null).
- **R-6, overstated buying power.** Today's FHA 6.95% becomes 7.125% in the calculator's USDA
  column, while PreQual uses 6.250% for USDA. For the same $2,000 principal-and-interest
  budget, 6.250% supports a $324,824 loan and 7.125% supports $296,860: **about $28,000 (9.4%)
  more buying power** than the calculator's own rate would give, on a page whose purpose is
  answering "how much can I afford", every day and not only during outages. The rate is
  visible and editable, which is why this is High and not Critical.
- **R-4, the visitor's own quote is lost.** A visitor who enters the rate from a lender's quote
  and then compares 15 and 30 years gets the market rate back without notice; the comparison
  is no longer theirs. The page-load case is rare (the API answered in about 0.1 s in three
  live checks); the term-change case happens every time.
- **R-3, R-5** make the "Live" label claim more than is known.

## 4. Recommendations (for review; nothing implemented)

**Behavior**

1. **One shared source of truth.** A single `useMarketRates()` hook (or module) used by the
   calculator, PreQual and Cash to Close, returning per program `{ rate, source, asOf }` where
   `source` is `live | fallback | manual`. Today the three pages carry three near-copies of
   the fetch, which is how R-6 happened.
2. **Never overwrite a rate the visitor set** (typed, dragged or from the URL), as the charts
   already do. Offer "Reset to today's average" instead.
3. **Per-program source.** A partial response marks only the parsed programs live (R-3).
4. **Fix R-6** by following the calculator's documented rule (USDA tracks FHA), or decide on a
   different rule for both.
5. **Server-side validation** (R-7): require the 30-year fixed; reject a 15-year above the
   30-year; reject a day-over-day move larger than a set threshold; return the data's own
   as-of date. Log every failure so its frequency is known.
6. **A real "cached" tier instead of hardcoded defaults:** store the last good response with
   its date in the existing Upstash store. During an outage the page then shows a real, dated
   figure ("as of Friday") instead of a constant that drifts further from the market every
   month. The hardcoded defaults remain the last resort, with a named owner and review date.
7. **Staleness rule:** treat data older than N business days (proposal: 2) as unavailable.

**User-facing disclosure (draft wording; needs compliance review before use)**

This touches regulated mortgage advertising and disclosure, so the wording below is a starting
point for review, not a recommendation to ship as is.

| State | Draft text |
|---|---|
| Live | "Starting rates: Mortgage News Daily national averages as of {data date}, rounded up to the next 1/8% plus 1/8%. Your rate depends on your credit, down payment and lender." |
| Partial | Per program: "FHA: sample rate, today's average unavailable." |
| Last good (cached) | "Live rates are unavailable. Showing national averages from {date}." |
| Fallback | "Live rates are unavailable. These are sample rates, not today's market. Enter the rate from your quote." No credit to Mortgage News Daily |
| Manual | "Your rate" next to the field, with "Reset to today's average" |

Remove the "they'll auto-populate when live data loads" hint once the request has finished,
whatever the result.

## 5. Tests

`tests/e2e/rate-sources.spec.ts`: 16 tests per browser (32 total). Deterministic: every
response is mocked; the "slow API" case holds the response until the test releases it.

- **Fixture design:** the shared `rates.json` cannot tell live from fallback for FHA (6.10
  rounds to 6.250, the default), so these tests use their own values, each chosen so its
  rounded result differs from every default. Expected values are computed by hand from the
  rounding rule (table at the top of the spec), not with the app's function.
- **Covered:** live load with source date; 15-year live rate; URL rate preserved; typed rate
  overwritten by a late response and by a term change; 500 response; network failure; a
  non-JSON response (a platform error page); typing a rate during an outage; partial response;
  year-old date; PreQual USDA; Cash to Close live and failed.
- **Fault injection:** making USDA stop following FHA failed 2 tests; dropping the extra 1/8%
  failed 7. **Burn-in:** 10 repetitions on both browsers, 320 runs, no failures or flakes.
