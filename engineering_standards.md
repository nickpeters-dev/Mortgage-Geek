# MortgageGeek.ai — Engineering Standards

**Purpose:** Conventions any new code or content on this site must follow. Reference this when starting a fresh Claude chat, writing CC prompts, or reviewing CC output. Not every change touches every section. Match the relevant subset to what you're building.

**Last updated:** November 14, 2026

**Where the architecture is documented:** `CLAUDE.md` is the single authoritative description of the current architecture (React Router v7 framework mode, prerendered public routes, no `App.jsx`). This doc holds the detailed rules that build on it. If the two ever disagree, `CLAUDE.md` wins and this doc gets fixed. Finished migration notes live in `docs/archive/`, not here.

---

## Architectural conventions (all code)

- **Named exports only.** The sole default exports are the framework-mode route modules: `src/root.jsx`, `src/routes/layout.jsx`, and the thin per-route adapters in `src/routes/` (each re-exports its named page component from `src/pages/` as default). There is no `App.jsx`.
- **No barrel/index files.** Every import uses an explicit module path.
- **Per-file React hook imports.** Each file imports only the hooks it uses directly. No re-exporting, no aggregation.
- **Design tokens live in `src/theme.js`.** No hardcoded hex colors in components. Colors come from the `P` object; fonts from `F`.
- **Single source of truth per concern.** `src/routes.js` for the route table, the route `meta` export (built with `buildMeta` in `src/utils/routeMeta.js`) for public-page metadata, `theme.js` for design tokens, `data/` for content/data, `utils/` for shared logic.
- **Adding a route.** Create the page in `src/pages/` (named export), add a thin adapter in `src/routes/` that default-re-exports it, and register it in `src/routes.js`. If the route is public, also add its path to the prerender array in `react-router.config.js`. A public route missing from that array is not prerendered and returns 404 on a direct hit.
- **Token names are historical, not semantic** (since the Rate refresh, June 2026). The `P` palette was realigned to Rate's brand by swapping token *values* while keeping *names* stable, to avoid a rename across the whole codebase. Several names no longer describe their value: `P.navy` is charcoal `#24272A` (Rate's near-black), `P.gold` is Arrow Red `#CF3338`, `P.goldMuted` is red-dark, `P.goldLight` is a red tint, and `P.sage` is grey. Treat every `P.*` token as an opaque reference, never as a literal color name. Two rules follow from this: (1) future palette changes prefer a value swap with stable names over a rename; (2) `PROGRAM_COLORS` holds its own explicit hexes and must not reference the repurposed `P` neutral tokens, so the four-program coding stays independent of the chrome palette.

---

## SEO requirements (any new page or route)

Every new **public** page component must include (private/gated routes follow a different rulebook — see "Private / gated routes" below):

1. **A `meta` export in the route adapter** (`src/routes/<route>.jsx`), built with `buildMeta` from `src/utils/routeMeta.js`, so the tags land in the prerendered HTML:
   - Unique `title`. Format: `"Specific Page Topic: Descriptor | Mortgage Geek"`
   - Unique `description`: 140 to 160 characters, answers the search intent
   - `path` matching the route (`buildMeta` derives the canonical, Open Graph, and Twitter tags from it)
   - Do NOT use `<SEOHead>` on a public route. It injects client-side, does not appear in the prerendered HTML, and would duplicate the `meta` export. `<SEOHead>` / react-helmet-async is retained only for non-prerendered SPA routes.

2. **Appropriate JSON-LD schema via the `schema` field of `buildMeta`** (helpers in `src/utils/schema.js`):
   - Deep Dive / educational content: `Article` schema with `author`, `datePublished`, `dateModified`
   - Tool / calculator pages: `WebApplication` schema
   - About: handled by the site-wide `Person` + `FinancialService` schema in `src/root.jsx` (no action needed)

3. **Semantic heading hierarchy:**
   - Exactly one `<h1>` per page, matching the page's primary topic
   - `<h2>` for major sections, `<h3>` for subsections
   - Do not skip levels (no `<h2>` followed by `<h4>`)

4. **Route added to the prerender array in `react-router.config.js` and to `public/sitemap.xml`** (with accurate `<lastmod>` date). The two lists must stay in sync: every public route appears in both.

5. **Internal links from related existing pages** to the new page. Example: a new Deep Dive about gift funds should be linked from any existing page that mentions gift funds.

6. **URL structure:** `/deep-dives/specific-topic-with-keywords`. Descriptive, keyword-forward, kebab-case, under 60 characters.

---

## Private / gated routes

Some routes are intentionally not public: personal accountability tools, internal admin views, work-in-progress staging pages. These follow a different rulebook than the SEO requirements above. When building a private route:

1. **Skip the SEO requirements section entirely.** No `meta` export, no schema, no canonical URL, no internal links from public pages, no sitemap entry, and no entry in the prerender array (the route is served by the SPA fallback through a `vercel.json` rewrite). The page should still set a `<title>` (for the browser tab) and a `<meta name="robots" content="noindex, nofollow">` tag, via react-helmet-async.

2. **Add the route to `public/robots.txt` as `Disallow:`.** Belt and suspenders alongside the noindex meta.

3. **Do NOT add the route to `public/sitemap.xml`.** Public sitemaps must not advertise private routes, full stop.

4. **Gate access with a server-issued session, not a URL key.** The page calls an auth-check endpoint on load. Without a valid session it renders a login screen where the passphrase is typed once per device and never stored client-side. The server sets a signed, HttpOnly session cookie (HMAC, see `api/geeklog/_auth.js`), and any later 401 from the API drops the page back to the login screen. The old `?key=` URL parameter gate is retired: do not reintroduce it. `/geek-log` now holds third-party contact data (prospects), which is exactly what the URL-key approach was never adequate for.

5. **Server-side data access goes through serverless functions.** Any backend (KV, database, third-party API) is accessed via Vercel serverless functions, never client-direct. Every handler authorizes the request server-side before touching data. Secrets live in server-side env vars (no `VITE_` prefix) and never reach the browser. Non-browser clients (the Scriptable widget) use a separate device token that the server allows on a named allowlist of endpoints only (see `scriptable/README.md`).

6. **Architectural conventions still apply.** Named exports, the page + thin route adapter pattern, design tokens from `theme.js`, no barrel files. Private doesn't mean exempt.

7. **Accessibility still applies** for any inputs, forms, or interactive elements. Useful tools deserve usable tools even when only one person uses them.

8. **Voice and style requirements still apply** for any user-visible prose, including placeholder text and toast messages. Future Nick is the user. He deserves the same writing standard the public site holds.

Examples of private routes: `/geek-log` (accountability dashboard), future `/admin` views, future staging or preview routes.

---

## Accessibility requirements (any new component)

- **Every `<input>` and `<select>` must have an associated `<label htmlFor>` using `useId()`.** See `CalcInput.jsx` for the canonical pattern.
- **Icon-only links need `aria-label`.** Any `<a>` without visible text content (or with text hidden via media query) requires a descriptive aria-label.
- **Text color must meet WCAG AA (4.5:1) on its background at its rendered size.** Use tokens from `theme.js`. Do not introduce new hardcoded colors.
- **Touch targets on interactive elements should be ≥44px tall** on mobile where practical.

---

## Performance requirements (any new page)

- **New routes go through the route table.** Framework mode code-splits per route module automatically, so registering the adapter in `src/routes.js` is all that is needed. Do not add manual `React.lazy()` wrappers, and do not import page components into other pages in a way that bundles them together.
- **Render-time code must be prerender-safe.** Public pages render in Node at build time. No `window`, `document`, or `localStorage` reads during render. Render the neutral default, then restore any persisted state after mount (see `ComparePage.jsx` for the pattern).
- **Images need explicit `width` and `height` attributes** to prevent CLS.
- **No new npm dependencies without explicit approval.** Vite, React, React Router, and the existing toolchain cover 95% of needs.

---

## Content voice and style (ALL on-page text)

The site's written content must sound like Nick, a real and experienced loan originator, not like an AI or a content farm. This applies to all on-page copy: Deep Dives, FAQs, calculator explanations, tooltips, and anywhere else prose appears. These rules apply to Claude when drafting content, and to CC when generating copy inside components.

1. **No em-dashes (—).** Em-dashes are a well-known tell of AI writing. Use periods, colons, or parentheses. When in doubt, break the sentence in two.

2. **Avoid formulaic AI phrasing.** Patterns to cut:
   - "It's not just X — it's Y"
   - "In today's [adjective] world"
   - "It's important to note that..."
   - Overuse of "simply," "certainly," "indeed," "moreover," "furthermore"
   - Excessive hedging ("it's worth mentioning," "one thing to consider")
   - "Dive deep," "unlock," "leverage" as verbs in non-technical copy

3. **Write like Nick talks.** Short sentences. Real contractions. Direct language. When in doubt, read the sentence out loud. If it sounds stilted or formal, rewrite it.

4. **Prefer specific over general.** "Nick has closed hundreds of FHA manuals" beats "Nick has extensive experience." Numbers, names, and concrete examples build trust. Vague claims erode it.

5. **Don't oversell.** If something is complicated, say it's complicated. If a loan is hard to get, say it's hard to get. Honesty beats marketing in every E-E-A-T signal Google measures.

---

## Writing CC prompts — checklist

Before sending any CC prompt that creates or modifies a page, verify the prompt includes:

- [ ] Explicit "do not" list covering architectural conventions that could get regressed
- [ ] SEO requirements if it's a new public page (route `meta` export, schema, prerender array, sitemap, internal linking)
- [ ] If private/gated route, the private-routes section requirements (noindex, robots disallow, session-cookie gate, no sitemap or prerender entry, serverless API mediation)
- [ ] Accessibility requirements if it involves forms, links, or colors
- [ ] Content voice and style requirements if it generates prose
- [ ] Route pattern if it's a new route (page, thin adapter, `src/routes.js`)
- [ ] One commit per logical change, with descriptive messages
- [ ] Verification steps CC should complete before declaring done (`npm run verify`, clean dev console, smoke test of affected routes)

For routine changes (styling, copy edits, bug fixes), only the relevant subset applies. Don't over-constrain prompts.

---

## Deep Dive content drafting

When drafting long-form content that cites HUD, agency, or other regulatory guidelines:

1. **Identify and flag logical tensions between rules.** Don't present downgrade triggers, qualifying thresholds, or exception rules in isolation. Show how they interact. If Rule A creates a path to X but Rule B disqualifies most files on that path, the reader needs to know both. Borrowers and LOs care about the combined effect, not individual rules. This is the specific insight that separates experienced-LO content from AI-generated content.

2. **Verify the current handbook version before citing specifics.** HUD 4000.1 and similar regulatory documents update regularly. Before citing specific thresholds, percentages, or waiting periods, confirm the current section date via web search against the official source. Do not rely on training data for specific regulatory numbers.

3. **Leave explicit placeholders for Nick's real-world commentary.** Real LO experience is the page's competitive advantage over content-farm writing. Draft around clearly-marked `[NICK: prompt]` placeholders rather than writing generic filler where experiential content belongs.

4. **Paraphrase rather than quote.** Regulatory text is dense and passive. Rewrite in plain English for the target audience, but never at the expense of accuracy. If a specific dollar amount, percentage, or time period appears in the source, preserve it exactly.

---

## Keeping this doc alive (Claude's responsibility)

This document is meant to evolve. If, during any conversation, Claude identifies a broadly applicable convention, pattern, or lesson that belongs in this doc, something that would help future sessions or future CC prompts avoid a recurring mistake, Claude will:

1. **Mention it in the conversation** so Nick can review and decide.
2. **Draft the proposed edit inline** (the exact text to add or change, and where in the doc it belongs).
3. **Offer to regenerate the full updated doc** as a downloadable file so Nick can reupload it to the project.

This applies to: new architectural decisions, new conventions that emerged from trial-and-error, new categories of mistakes to avoid, or updates to deferred/non-goal items as priorities shift. It does NOT apply to one-off fixes or changes specific to a single page. Those stay in the conversation.

Standards that drift from reality are worse than no standards. The goal is a living doc, not a historical artifact.

---

## Non-goals / deferred concerns

These are known but intentionally not enforced:

- **Sub-16ms interaction latency.** Good-enough targets; not a current optimization priority.
- **100 Lighthouse Accessibility.** 90+ is the target; chasing 100 is not worth the redesign cost.
- **Core Web Vitals field data.** Requires real traffic to measure; not actionable until the site has user volume.
- **Semantic token rename.** Renaming the `P` palette tokens to describe their post-refresh values (`P.accent`, `P.ink`, `P.surface`, and so on) is an optional cleanup, not a requirement. The value-swap approach keeps names stable to avoid a high-blast-radius refactor across roughly 40 files. Revisit only if the historical names become a genuine source of error.
