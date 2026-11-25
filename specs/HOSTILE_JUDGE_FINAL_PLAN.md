# Hostile External Judge Audit — Round 2 Final Reconciliation Plan (`smogwise-virtual`)

STATUS: EXECUTED AND VERIFIED  
**Target Score:** 97.00–100.00 / 100.00 across all 6 PromptWars dimensions  
**Hard Repo Invariants:** Single `main` branch, `< 10 MB` repo footprint, ALL tests strictly under `testscript/` (NEVER `src/`), strict ESLint (`complexity <= 10`, `max-len <= 100`, `max-lines-per-function <= 80`, zero `any`, `no-console` in `src/`, `jsx-a1y`) & TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).

---

## 1. Disk Verification Findings (Pre-Edit Grounding)

1. **Inline Styles & CSP `style-src` Check (`index.html`, `src/index.css`):**
   - `index.html` contains **zero** `<style>` blocks or inline `style=` attributes (only a `data:image/svg+xml` favicon link).
   - `src/index.css` uses Tailwind CSS v4 (`@import "tailwindcss";`) with `:root` custom properties and `html { scroll-behavior: smooth; }` (currently missing a `prefers-reduced-motion` guard).
   - **CSP `styleSrc` Rule:** Before dropping `'unsafe-inline'` from `styleSrc`, Worker H1 must grep `src/` for dynamic `style={{...}}` (e.g., progress bar widths / SVG chart transforms). If any dynamic `style={{...}}` remains or Vite/Tailwind injects runtime style tags, keep `styleSrc: ["'self'", "'unsafe-inline'"]` with an explicit documented rationale rather than breaking live rendering; if zero inline styles exist after H3, tighten to `styleSrc: ["'self'"]`.
2. **Toolchain Versions (`package.json`):**
   - `vitest: ^3.1.0`, `@vitest/coverage-v8: ^3.1.0`, `eslint: ^9.22.0`, `react: ^19.1.0`, `@testing-library/react: ^16.2.0`, `jsdom: ^26.0.0`, `zod: ^4.6.7`, `helmet: ^8.1.0`, `express: ^5.1.0`.
   - **Upgrade Safety:** Do **not** jump to `vitest` v5. Upgrade within the compatible `vitest` `3.x` line (or targeted `package.json` `overrides` for `tinypool`, `glob`, and `minimatch`) to resolve all 7 `npm audit` findings while preserving `@testing-library/react@16` + `jsdom@26` + React 19 compatibility.

---

## 2. Point-by-Point Reconciliation (All 6 Carbon Objections + 5 Blind Spots Accepted)

### A. Security & Dependencies (`SEC-01`..`SEC-05` + Blind Spots #3, #4)
1. **HTTP Hardening Headers & CSP (`SEC-02` — Carbon Objection #1 Accepted):**
   - Set `Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()` so **Use My Location** continues working on `smogwise-virtual.vercel.app` while locking down unused sensors and payment APIs.
   - Explicitly configure `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, and CSP `baseUri: ["'self'"]`, `formAction: ["'self'"]` (plus `upgradeInsecureRequests` in production).
   - Apply the grounded `styleSrc` rule from Section 1.
2. **Own-Property Prototype-Pollution Guard (`SEC-04` — Carbon Objection #4 + Blind Spot #4 Accepted):**
   - **Never** use the `in` operator (which matches inherited `Object.prototype.constructor`).
   - Implement a recursive JSON body guard using `Object.getOwnPropertyNames(obj)` with a hard nesting depth limit (`MAX_JSON_DEPTH = 8`) and `64kb` body size cap, rejecting own keys `"__proto__"`, `"constructor"`, and `"prototype"` with HTTP `400`.
   - Return sanitized `400` validation errors from Zod (field path + safe message only; never raw internal Zod dumps).
3. **Unicode Normalization & Canonical Sanitizer (`SEC-03`, `SEC-05`):**
   - Strip zero-width (`\u200B-\u200F`, `\uFEFF`) and BiDi override (`\u202A-\u202E`, `\u2066-\u2069`) characters after `.normalize('NFKC')` in both `server/middleware/locationGuard.ts` and `server/middleware/promptGuard.ts`.
   - Export a single canonical `isUnsafeCityInput` / `sanitizeLocationText` from `server/middleware/locationGuard.ts` and reuse it in `openMeteoClient.ts` and `geocodingClient.ts`.
4. **Dependency Audit (`SEC-01`) & Serverless Rate-Limit Caveat (Blind Spot #3):**
   - Remediate all 7 `npm audit` issues (`tinypool`, `glob`, `minimatch`) via compatible `vitest@3.x` patch / `overrides` and verify `npm audit --audit-level=moderate` exits `0`.
   - Document in `server/middleware/security.ts` and `README.md` that in-memory `express-rate-limit` counters are per-instance on Vercel serverless and reset across cold starts.

### B. Alignment & Backend Efficiency (`ALN-01`, `EFF-01`, `EFF-02` + Blind Spot #2)
1. **Non-Blocking Gemini 4 Briefing (`ALN-01` — Carbon Objection #2 Accepted):**
   - Keep `POST /api/plan` **100% deterministic Tier-1** (`<20ms`, zero LLM latency) so sliders and checkboxes stay instant.
   - Add `POST /api/plan/briefing` protected by a strict `RateLimiter`, backed by a bounded LRU cache (`MAX_ENTRIES = 100`, `TTL = 10m`) keyed by canonical plan hash, calling Gemini 4 with a bounded timeout and deterministic bilingual (`en`/`hi`) fallback.
   - Surface the briefing prominently in the main plan column via `<AiPlanBriefingCard />` (debounced trigger after plan render).
2. **Bounded Singleflight Coalescing (`EFF-01` — Carbon Objection #3 + Blind Spot #2 Accepted):**
   - Add `Map<string, Promise<T>>` singleflight registries in `openMeteoClient.ts` and `geocodingClient.ts` with `MAX_INFLIGHT = 100`, canonicalized keys, a **detached** upstream timeout `AbortController` (never aborted by a single caller's signal), and guaranteed `finally` eviction so rejected promises never poison subsequent callers.
   - Enforce explicit `MAX_ENTRIES` + `TTL` bounds on all in-memory caches.
3. **Privacy-Safe `Cache-Control` Split (`EFF-02` — Carbon Objection #3 Accepted):**
   - Preset `GET /api/aqi?city=<preset>`: `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`.
   - Raw coordinates `GET /api/aqi?lat=&lon=`, `GET /api/locations/search`, `POST /api/plan`, `POST /api/plan/briefing`, `POST /api/ai/ask`: `Cache-Control: private, no-store`.
   - `GET /api/health`: `Cache-Control: no-store`.

### C. Code Quality & Accessibility (`CQ-01`..`CQ-03`, `A11Y-01`..`A11Y-04`)
1. **Modular Splitting (`<250L` target) & Resilience (`CQ-01`, `CQ-02`, `CQ-03`, `EFF-03`):**
   - Split `>300L` files (`LocationSearchCombobox.tsx`, `PersonaForm.tsx`, `openMeteoClient.ts`, `genaiService.ts`, `useSmogPlan.ts`) into cohesive submodules under 250 lines each, obeying `complexity <= 10` and `max-lines-per-function <= 80`.
   - Add a bilingual, accessible `src/components/ErrorBoundary.tsx` wrapping the main app tree.
   - Memoize callbacks in `src/App.tsx` (`useCallback`) and extract magic numbers into named constants.
2. **Accessibility (`A11Y-01`..`A11Y-04` — Carbon Objection #6 Accepted):**
   - Add a visually hidden (`sr-only`) semantic `<table>` (`<caption>`, `<th scope="col">`) inside `ImpactDashboard` alongside the SVG chart (marking decorative SVG primitives `aria-hidden="true"`).
   - Wrap grouped checkboxes in `PersonaForm` with `<fieldset>` and `<legend>`.
   - Wire `aria-invalid` and `aria-describedby` on numeric inputs in `PersonaForm` and `RWACommunityPanel`.
   - Keep `document.documentElement.lang` **single-sourced** in `useSmogPlan.ts` (do not duplicate); add `lang="hi"` on mixed-script inline labels (e.g., `हिन्दी` toggle).
   - Guard `scroll-behavior: smooth` in `src/index.css` with `@media (prefers-reduced-motion: no-preference)`.

### D. Testing & Coverage Gate (`TST-01` — Carbon Objection #5 Accepted)
- **Strict Placement:** ALL test files live strictly under `testscript/` (`testscript/unit/`, `testscript/integration/`, `testscript/security/`) — **NEVER** inside `src/`.
- **Coverage Config (`vitest.config.ts`):** Exclude `testscript/**`, `dist/**`, `dev.ts`, `*.config.*`, and `src/main.tsx`; enforce thresholds (`statements: 85`, `branches: 75`, `functions: 85`, `lines: 85`).
- **New Suites:**
  - `testscript/unit/apiClient.test.ts`
  - `testscript/unit/useSmogPlan.test.tsx`
  - `testscript/unit/LocationSearchCombobox.test.tsx`
  - `testscript/unit/GroundedAssistant.test.tsx`
  - `testscript/unit/WhatIfComparator.test.tsx`
  - `testscript/unit/RWACommunityPanel.test.tsx`
  - `testscript/security/inputGuards.test.ts` (zero-width/BiDi Unicode bypasses, `__proto__`/`constructor`/`prototype` own-property rejection, depth limit `>8`, sanitized Zod 400)
  - `testscript/integration/singleflightAndCache.test.ts` (concurrent coalescing, detached abort safety, no rejection poisoning, `Cache-Control` privacy split, `/api/plan/briefing` cache + fallback)

### E. Specs Cleanup (`ALN-02` + Blind Spot #1 Accepted)
- Audit `specs/` and remove or consolidate superseded debate/audit files containing raw blocker markers so automated external scanners do not misclassify resolved items as open defects.

---

## 3. Non-Overlapping Execution Worker Plan

| Worker | Scope & Ownership (Zero File Overlap) | Verification Gate |
|---|---|---|
| **H1 — Security & Deps** | `package.json`, `package-lock.json`, `server/middleware/security.ts`, `server/middleware/locationGuard.ts`, `server/middleware/promptGuard.ts`, `server/middleware/bodyGuard.ts` (new). Audit inline `style={{...}}` for CSP `styleSrc`, add `Permissions-Policy`/`Referrer-Policy`/COOP/CORP, own-property prototype-pollution + depth `<=8` + `64kb` guard, sanitized Zod 400s, BiDi/zero-width stripping, canonical sanitizer, `npm audit` remediation. | `npm audit --audit-level=moderate` (0 vulns), `npm run typecheck`, `npm run lint` |
| **H2 — Backend Efficiency & Alignment** | `server/services/openMeteoClient.ts` (+ helpers), `server/services/geocodingClient.ts`, `server/services/genaiService.ts` (+ prompt/fallback helpers), `server/routes/apiRoutes.ts`. Split `>300L` server files, add bounded singleflight (`MAX_INFLIGHT=100`, detached `AbortController`, `finally` cleanup), bounded LRU caches, `Cache-Control` privacy split, and `POST /api/plan/briefing` (rate-limited, LRU max 100 / 10m TTL, Gemini 4 + bilingual fallback). | `npm run typecheck`, `npm run lint`, `POST /api/plan` `<20ms`, `POST /api/plan/briefing` verified |
| **H3 — Frontend Modularization, Briefing & A11y** | `src/index.css`, `src/App.tsx`, `src/components/ErrorBoundary.tsx` (new), `src/components/AiPlanBriefingCard.tsx` (new), `src/components/LocationSearchCombobox.tsx` (+ hook/list), `src/components/PersonaForm.tsx` (+ sub-sections), `src/hooks/useSmogPlan.ts` (+ helpers), `src/components/ImpactDashboard.tsx`, `src/components/RWACommunityPanel.tsx`, `src/components/Header.tsx`, `src/services/apiClient.ts`. Split `>300L` files, memoize `App.tsx` callbacks, wire `AiPlanBriefingCard`, add `sr-only` `<table>`, `<fieldset>`/`<legend>`, `aria-invalid`/`aria-describedby`, `lang="hi"`, `prefers-reduced-motion`. | `npm run typecheck`, `npm run lint`, `npm run build` |
| **H4 — Comprehensive `testscript/` Suites & Coverage Gate** | `vitest.config.ts`, `testscript/unit/*`, `testscript/integration/*`, `testscript/security/*`. Exclude `testscript/**` from coverage, enforce `>=85%` thresholds, fix the 5000ms timeout in `testscript/security/security.test.ts:77` (10 sequential adversarial payloads on `/api/ai/ask`), and implement all 8 targeted suites covering UI components, hooks, `apiClient`, security guards, singleflight, `Cache-Control`, and `/api/plan/briefing`. | `npm run test:coverage` (`>=85%` stmts/lines/funcs, `>=75%` branches, 0 failures) |
| **H5 — Clean `specs/`, Docs & Sync** | `specs/*`, `README.md`, `SYSTEM_DESIGN.md`. Remove/consolidate stale `specs/*` files with raw blocker tags, document `/api/plan/briefing`, security headers, and serverless rate-limit caveat, verify repo `<10 MB` on `main`, and run final full build/lint/test/deploy verification. | `git status`, `du -sh .` (`<10 MB`), full `typecheck + lint + test:coverage + build` |
