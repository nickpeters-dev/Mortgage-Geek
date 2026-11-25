# QA and CI/CD Roadmap: Mortgage Geek

Last updated 2026-11-25. This file incorporates the 2026-11-25 architectural review.

**Ground rules from the review:**

- Keep the current architecture.
- Measure progress by risk reduced, not by test count.
- Do not expand the Phase 2 scope.
- Every item marked **Proposal** needs owner approval before any implementation starts.

**Status key:**

- **Approved:** cleared to work in order.
- **Proposal:** write-up or assessment only until approved.
- **Deferred:** on hold by decision.
- **Backlog:** logged for reference.

Related: QA_COVERAGE_MATRIX.md (what is covered), QA_DEFECT_LOG.md (D-n, T-n), QA_RATE_SOURCES.md (R-n).

## Released 2026-11-25 (PRs #6 to #14, all through the quality gate)

- Playwright suite and CI `e2e` job.
- D-4 headings fix.
- D-3a manifest fix.
- Node 24 and v7 actions.
- Rate-source characterization tests.
- Phase 2 calculator tests.
- D-5/D-6 FHA MIP fix.
- D-7 keyboard entry fix.
- R-6 PreQual USDA rate fix.

**Owner spot-check:** on the live calculator, a 15-year FHA loan should show 0.40% MIP at 3.5%
down and 0.15% at 10% down.

## Now: finish Phase 2 (Approved, scope unchanged)

1. PreQual: DTI and purchasing-power tests against an independent reference, down-payment
   boundaries.
2. Calculator: payment mode (A3), hide-program persistence (B5), loan-limit warning (B6).
3. Navigation including the Compare hand-off (E2-E4); mobile overflow (F1).
4. D-8 and O-6 are recorded during the PreQual work. Any fix needs separate approval.

## Next: D-2 hydration remediation (Approved to follow Phase 2)

Priority reason, from the review: the D-2 allowances in `known-defect-allowances` tolerate
hydration errors on every page, so a new hydration bug would pass CI unseen.

Exit criteria:

- The fix removes the allowances, not just the symptom.
- Every page hydrates with zero tolerated errors.
- Performance is measured before and after.

## Deferred (by decision)

- **D-3b service worker:** not until a caching strategy is approved.
- **React 19 upgrade, which carries D-1:** `known-defects.http.spec.ts` must flip on the upgrade
  branch to prove the fix.

## Proposals from the 2026-11-25 review (awaiting approval)

Each entry gives the problem, the facts gathered so far (no changes made), and the decision
the owner needs to make.

### A. Financial accuracy and traceability

**A1. Central business rules inventory.**

- The first version is section 2 of QA_COVERAGE_MATRIX.md. For each rule it records type,
  source, implementation location and tests.
- Proposal: grow it into `src/data/businessRules` metadata, or a dedicated doc, with an
  *effective date* and a *last verified* date per rule. A CI check would then fail when an
  annual rule passes its review date.
- The inventory has already paid off once: it found **D-9**. Cash to Close keeps a separate,
  stale copy of the program rules, and its estimated APR uses the pre-fix FHA MIP.
- *Decision: approve D-9's fix approach (route Cash to Close through `mortgageMath.js`, plus
  APR regression tests); the format of the inventory.*

**A2. Separate regulatory thresholds from annual limits.**

- The $726,200 FHA MIP threshold is fixed text in HUD ML 2023-05. County loan limits change
  every January.
- They need different review triggers: a new Mortgagee Letter for the first, the yearly
  FHFA/HUD announcements for the second.
- **Timely:** FHFA announced the 2026 limits on 2025-11-25, so the 2027 limits are due now.
- *Decision: who updates `taxRates.js` and `tnLoanLimits2026.js` for 2027, and when.*

**A3. Authoritative USDA fee source.** Replace "owner-confirmed" with a USDA Rural Development
citation (the fee notice or the HB-1-3555 chapter), with its fiscal year. USDA fees are set per
fiscal year, so this is an annual rule.

**A4. Golden test cases.**

- Proposal: 5 to 8 scenarios worked by hand by a licensed MLO, using the HUD and VA published
  tables and a real Loan Estimate style worksheet. They must not be produced from either the
  site or the Python reference.
- Each case is stored with its worksheet and who verified it, on what date.
- Purpose: catch a wrong assumption that the code and the Python reference share.
- *Decision: which scenarios, and who verifies them.*

**A5. Rate provenance.**

- Extend the R-1 fix plan in QA_RATE_SOURCES.md so every rate carries one of: live, cached,
  stale, default, **derived** or manual.
- USDA is derived (it is set equal to FHA). Its label must not read as an observed USDA
  market rate. Any disclosure wording needs owner review (tripwire 2).

### B. CI/CD

**B1. Vercel Deployment Checks and bypass paths.**

- Today the GitHub ruleset gates `main`, but Vercel deploys any commit that reaches `main`.
- Known paths around the gate to assess:
  - `vercel --prod` from a laptop.
  - Deploy Hooks.
  - Redeploying or promoting an older deployment in the dashboard.
  - An admin bypass if one is ever added to the ruleset.
- Deployment Checks would hold the production domain until the GitHub checks pass.
- Assessment deliverable: confirm availability on the current Vercel plan; list each bypass
  with its control (disable, restrict, or accept and document).

**B2. Post-deployment production smoke suite.**

- Kept apart from the deterministic pre-release suite: different purpose, different rules.
- Sketch:
  - A separate Playwright project, `production`, aimed at https://mortgagegeek.ai.
  - Read only. Mocks nothing. Submits nothing.
  - About 10 checks: key pages load and hydrate, the manifest is served, and `/api/rates`
    returns `success: true` with a recent date (this would catch O-2 style drift in the
    rate source).
- Triggers: after each production deployment (GitHub `deployment_status` event) and on a
  schedule.
- It alerts but never blocks, because the code has already shipped.

**B3. Rollback runbook and rehearsal.**

- Vercel Instant Rollback moves the domain back to an earlier deployment in seconds. Git
  `main` still contains the bad commit, so the next merge would redeploy it.
- Runbook:
  1. Roll back in Vercel to stop the harm.
  2. Open a `git revert` PR through the gate.
  3. Confirm the reverted build is live.
  4. Undo the rollback state so automatic production deploys resume.
- The rehearsal confirms the exact Vercel behavior on a harmless change.

**B4. Supply chain and permissions review.** Facts so far:

- `permissions: contents: read` is already set (least privilege; good).
- Actions are pinned to major tags (`@v7`), not commit SHAs. A tag can be moved to different
  code; a SHA cannot.
- There is no Dependabot or Renovate config, no `npm audit` step, and no CodeQL.
- Secret scanning and push protection are repository settings, still to be checked in
  GitHub.
- *Decision: SHA pinning with Dependabot to keep pins current; which scanners to turn on.*

**B5. Duplicate runs and concurrency.**

- A concurrency group already cancels superseded runs. It includes the event name, though, so
  a branch with an open PR runs the full suite twice per push (once for `push`, once for
  `pull_request`).
- Option: run `push` only on `main`, and `pull_request` for branches. Trade-off: a branch
  without a PR gets no CI until one is opened.
- The required checks must keep reporting under the same names, or the ruleset blocks every
  merge.
- *Decision: accept the trade-off or keep the duplication.*

### C. Production observability

**C1. Error and uptime monitoring.**

- Today there is none: no error reporting, uptime check, or analytics in the code.
- Candidates to evaluate on cost and fit:
  - Vercel's built-in tools: function logs, Observability, Web Analytics, Speed Insights.
  - Sentry (browser errors, with a free tier).
  - An external uptime checker.
  - The B2 production smoke on a schedule. This doubles as a synthetic uptime monitor at no
    extra cost.
- Recommendation will favor the fewest moving parts.

**C2. Borrower data privacy in telemetry.** The specific risks found:

- Calculator inputs (price, down payment, rate, taxes) travel in the **URL query string**.
  Most monitoring and analytics tools record full URLs by default.
- Saved scenarios live in `localStorage`.
- `/api/prospects` holds prospect data.

Any tool must be configured so it does not record these:

- Strip query strings from recorded URLs.
- No session replay, or replay with all inputs masked.
- No request bodies.
- Send-PII settings off.
- Verify with a test that inspects the outgoing payload.

## Backlog (for reference)

- D-8 PreQual default location.
- D-9 Cash to Close APR (raised to a proposal, A1).
- R-1 fall back to the last good dated rate; R-2 to R-5, R-7.
- O-1 to O-6 observations.
- API contract tests for `/api/rates`.
- Number checks for Cash to Close and Rent vs Own UI (see the coverage matrix).

## Suggested order after Phase 2 and D-2

The owner decides the order. This one is based on business impact:

1. D-9 and A1, a wrong number that is live today.
2. A2, the 2027 loan limits (date-driven).
3. B1 and B3, because a gate with a bypass and an unrehearsed rollback are the two biggest
   release risks.
4. B2 and C1 together, since the production smoke doubles as uptime monitoring.
5. A4 and A5.
6. B4 and B5.
