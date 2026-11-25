# Coverage Matrix: Mortgage Geek

Last updated 2026-11-25, after PRs #6 to #14 merged. This file maps what we protect and what we
don't. Test counts are deliberately left out: one test at a fee boundary is worth more than
forty that load a page. Read this alongside QA_DEFECT_LOG.md and QA_RATE_SOURCES.md.

**Coverage levels**

- **Strong:** checked against an independent reference, including boundaries.
- **Partial:** some paths are checked; named gaps remain.
- **Smoke:** the page loads and hydrates without errors; its numbers are not checked.
- **None:** not tested.

**Layers**

- **U:** unit, `tests/*.test.mjs`.
- **P:** Python parity or reference.
- **E:** Playwright end to end, `tests/e2e/`.
- **H:** HTTP-only Playwright.

## 1. Calculators

| Tool | Level | What is protected | Gaps, by business impact |
|---|---|---|---|
| Mortgage calculator `/calculator` | **Strong** | U: P&I, amortization, extra payments, MI end dates, program rules, payment solver. E: card totals and breakdowns against the reference (`calculator.math`), down-payment and FHA MIP boundaries, VA usage, USDA term rule (`calculator.programs`), input sync, clamping and keyboard entry (`calculator.inputs`), rate sources | Payment mode in the UI (A3); loan-limit warning (B6); hide-program persistence (B5); saved scenarios; Compare hand-off (E2-E4); mobile overflow (F1). All in the approved Phase 2 scope |
| Pre-qualification `/prequal` | **Partial** | E: FHA MIP threshold, including the pinned-at-threshold case and an affordability invariant (`prequal.fha-mip`); USDA = FHA rate (R-6) | **DTI and purchasing power have no independent reference** (Phase 2); down-payment boundaries; D-8 default location; O-6 mobile roles; loan-limit capping |
| Cash to Close `/cash-to-close` | **Smoke** (rates only) | E: rate source labels (`rate-sources`) | **No number on this page is checked**: closing costs, about 50 state transfer-tax rules, prepaids, escrow, estimated APR. Its program rules are a separate copy (**D-9**, open). Highest-impact gap outside Phase 2 |
| Rent vs Own `/rent-vs-own` | **Strong** (math), **Smoke** (UI) | U+P: edge cases against the Python reference, model invariants, MI timing, agreement with the calculator | No E2E test of the page's inputs or displayed results |
| Compare `/compare` | **Smoke** | Loads and hydrates | Hand-off from the calculator; displayed values |
| Geek Charts and Deep Dives (25 pages) | **Smoke** | E: every public route loads, hydrates, one h1, no console errors. H: prerendered HTML, manifest link | Chart data and figures are not checked (they are dated published content, a lower risk) |

## 2. Business rules

Type tells you how a rule goes stale:

- **Regulatory:** changes only when an agency publishes a new rule.
- **Annual:** must be re-verified every year.
- **Market:** changes daily.
- **Assumption:** the site's own estimate, not an agency rule.

| Rule | Type | Source | Implemented in | Tests | Gap |
|---|---|---|---|---|---|
| FHA upfront MIP 1.75% | Regulatory | HUD ML 2023-05 | `mortgageMath.js`; **copy in `CashToClosePage.jsx:277`** | U, E | Copy is untested |
| FHA annual MIP by term, LTV, base loan | Regulatory | HUD ML 2023-05, App. 1.0 | `mortgageMath.js` `fhaMiRate` (calculator, Rent vs Own, PreQual); **old copy in `CashToClosePage.jsx:521`** | U (every row at its band edges), E (boundaries, PreQual) | **D-9** |
| FHA high-balance MIP threshold $726,200 | Regulatory (a fixed figure in the ML; it does **not** move with annual loan limits) | HUD ML 2023-05 | `FHA_HIGH_BALANCE_THRESHOLD` | U, E (at $726,200 and $726,201) | Owner accepted "for now"; re-check if HUD publishes a new ML |
| FHA MIP duration (11 years at 10%+ down, else life of loan) | Regulatory | HUD ML 2023-05 | `mortgageMath.js`; copy in Cash to Close APR | U | None in the calculator |
| VA funding fee table | Regulatory | va.gov, effective 2023-04-07 | `mortgageMath.js` `vaFeeRate`; **copy in `CashToClosePage.jsx:280`** | U, E (10 boundaries, usage) | Copy is untested |
| USDA 1% upfront, 0.35% annual | Annual (set each fiscal year) | **Owner-confirmed; no agency citation yet** | `mortgageMath.js`; copies in Cash to Close | U, E | Needs an authoritative USDA RD citation |
| Conventional PMI tiers 0.52 / 0.37 / 0.27% | Assumption (varies by credit score and MI company) | Site estimate | `mortgageMath.js`; copy in Cash to Close | U, E | Assumption is not disclosed as such everywhere it is used (review) |
| Minimum down payment (Conv 3%, FHA 3.5%, VA/USDA 0%) | Regulatory (agency guides) | Fannie/Freddie, HUD 4000.1, VA, USDA | `mortgageMath.js`, page logic | U, E (BVA) | PreQual not covered |
| USDA 30-year only | Regulatory | USDA | Calculator page logic | E | PreQual not covered |
| DTI limits per program (front and back) | Assumption (typical AUS approvals at stated FICO) | Owner's lending experience | `PreQualPage.jsx:193-209` | **None** | Phase 2 reference tests |
| Student loan 0.5% qualifying payment | Regulatory (FHA; others differ) | HUD 4000.1 | PreQual text only | None | Confirm per program |
| Conforming and FHA county loan limits | **Annual** | FHFA CLL, HUD FHA limits (CY2026) | `src/data/taxRates.js`, `src/data/tnLoanLimits2026.js` | None of the values | **The 2027 update is due now:** FHFA announced the 2026 limits on 2025-11-25. No test or reminder catches a stale year |
| VA county loan limits | Regulatory | VA (see O-5) | Calculator "Over Loan Limit" | E (incidental) | **O-5**: full-entitlement veterans have no limit since 2020; verify |
| Property tax rate by area, HOI 0.35% of price | Assumption / annual | Site data | `src/data/taxRates.js`, pages | Fixed inputs in E scenarios only | Values are unverified and undated |
| State transfer and recording taxes | Regulatory (state law, changes rarely) | State statutes | Inline in `CashToClosePage.jsx:342-456` | **None** | Untested; no sources cited in code |
| Estimated APR | Regulatory term (Reg Z) | 12 CFR 1026.22 method | `utils/math.js` `calculateAPR`, Cash to Close inputs | **None** | **D-9**; needs a reference |
| Starting rate rounding (nearest 1/8, plus 1/8) | Assumption | Site policy | Calculator, PreQual, Cash to Close | E, U | None |
| Live, fallback and manual rate labeling | Market / disclosure | QA_RATE_SOURCES.md | Three pages | E (characterization) | R-1 open; derived USDA rate is not labeled as derived (roadmap item) |

## 3. Critical user workflows

| Workflow | Level | Tests | Gap |
|---|---|---|---|
| Any public page: direct visit, refresh, shared link | **Strong** | E `smoke` (38 routes, 2 browsers), H `production-routing` | Against the build only, never production (roadmap: production smoke) |
| Redirects, rewrites, unknown URL 404, case-sensitive paths | **Strong** | H `production-routing` | Vercel `headers` not modeled (QA_STRATEGY 4b) |
| Shared calculator link with parameters | **Strong** | E `calculator.math` (A2) | None |
| Rate API down, partial or stale | **Partial** | E `rate-sources` | Real `/api/rates` contract untested (always mocked); O-2 drift unseen |
| Calculator to Compare | **None** | | Phase 2 (E2-E4) |
| PreQual result to next step | **None** | | Not yet inventoried |
| Contact and apply links (lead capture) | **None** | | Outbound links not checked; a broken one loses the lead silently |
| Install as an app | **Partial** | H `pwa-manifest`, E (Chromium) | Service worker deliberately off (D-3b) |
| Hydration health on every page | **Weak** | `known-defect-allowances` | **D-2 allowances can hide new hydration errors**; D-2 is next after Phase 2 |
| Geek Log (private), `/api/geeklog`, `/api/prospects` | **None** | | Out of current scope; holds prospect data, so it matters for monitoring privacy |
