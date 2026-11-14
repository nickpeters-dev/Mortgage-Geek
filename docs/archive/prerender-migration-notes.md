# Prerender migration notes (archived)

**Status: historical. Do not follow these as instructions.** The React Router v7 prerender migration (branch `seo-prerender-migration`, phases P1 to P3) is finished. The site now prerenders every public route at build time. The current architecture is documented in `CLAUDE.md`, and the rules that came out of this migration (route `meta` exports, prerender-safe render code, `/geek-log` excluded from the prerender list) live in `engineering_standards.md`.

These notes were moved out of the "Non-goals / deferred concerns" section of `engineering_standards.md` on November 14, 2026. They are kept only as a record of what was deferred between phases and why. They mention things that no longer exist, including the `?key=` URL gate on `/geek-log`.

---

- **Prerendering for SPA crawler visibility.** Per-page schema is injected post-hydration; not visible to crawlers reading raw HTML. Being addressed by the React Router v7 prerender migration (branch `seo-prerender-migration`): P1 adopted framework mode (SPA), P2 added SSR-safety guards, P3 turns on prerendering. See the P3 carry-over below.

### P3 prerender carry-over (deferred from P2, branch seo-prerender-migration)
P2 guarded the render-time browser APIs that caused Node crashes or viewport hydration mismatches. These render-time browser reads were intentionally left untouched in P2 because they are crash-safe (try/catch) and changing them in P2 would have broken P2's "identical SPA behavior" rule. They must be handled in P3 when prerendering is enabled, because they will hydration-mismatch against the static HTML:
- **`localStorage`-seeded `useState` initializers (rows 9-13 of the P2 audit):** `PreApprovalChecklist.jsx` (checkedItems), `ComparePage.jsx` (scenarios), `CalculatorPage.jsx` (visiblePrograms), `InteractiveChecklist.jsx` (`loadInitial`), and `GeekLogPage.jsx` (URL `?key=` read).
- **Required P3 fix = HYDRATION-CLEAN RESTORE, not the naive default+effect pattern.** The naive "default + load-in-effect" approach is rejected: it makes returning users see saved checklist/scenarios/programs briefly flash to defaults. Instead: prerender renders the neutral DEFAULT (correct for SEO/indexing), and the persisted-state read is gated behind a post-mount "hydrated" flag (or a `suppressHydrationWarning` scoped to that specific subtree) so saved state restores with minimal/no visible flash.
- **`/geek-log` = EXCLUDE from the P3 prerender path list.** Private, `noindex`/`nofollow`, no SEO value; it has no business being prerendered. Keep it SPA-served (catch-all / SPA fallback).
