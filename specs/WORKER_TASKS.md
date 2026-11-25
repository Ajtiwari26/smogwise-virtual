# SmogWise Virtual — Isolated Worker Specifications (W1–W5)

All work occurs strictly inside `/Users/ajaytiwari/Desktop/promptwar/smogwise-virtual`. Every worker owns disjoint files and must pass `npx tsc --noEmit` and `npx eslint .` before handoff.

---

## W1: Project Scaffolding, Strict Config & Evaluator Harness

**Owned Files:**
- `package.json`, `tsconfig.json`, `tsconfig.server.json`, `eslint.config.js`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `index.html`, `.gitignore`, `.env.example`, `vercel.json`
- `testscript/evaluator/types.ts`
- `testscript/evaluator/analyzers/codeQualityAnalyzer.ts`
- `testscript/evaluator/analyzers/securityAnalyzer.ts`
- `testscript/evaluator/analyzers/efficiencyAnalyzer.ts`
- `testscript/evaluator/analyzers/alignmentRuntimeAnalyzer.ts`
- `testscript/evaluator/analyzers/testingAnalyzer.ts`
- `testscript/evaluator/analyzers/accessibilityAnalyzer.ts`
- `testscript/evaluator/aiJudge.ts`
- `testscript/evaluator/runEvaluator.ts`

**Requirements:**
1. Configure TypeScript with `"strict": true`, `"noUncheckedIndexedAccess": true`, `"noImplicitAny": true`, `"exactOptionalPropertyTypes": true`.
2. Configure ESLint flat config with `@typescript-eslint/no-explicit-any: "error"`, `complexity: ["error", 10]`, `max-len: ["error", { "code": 100, "ignoreUrls": true, "ignoreStrings": true }]`, `max-lines-per-function: ["warn", 80]`.
3. Keep production dependencies lean: `react`, `react-dom`, `express`, `cors`, `helmet`, `express-rate-limit`, `zod`, `@google/genai`, `lucide-react`.
4. Implement all 6 deterministic analyzers + adversarial AI judge per `specs/EVALUATOR_SPEC.md`.
5. Scripts in `package.json`: `dev`, `build`, `typecheck`, `lint`, `test`, `evaluate`.

**Verification:** `npm run typecheck && npm run lint` pass with 0 errors.

---

## W2: Deterministic Exposure, IAQ & Emission Impact Engine

**Owned Files:**
- `src/domain/types.ts` (shared pure types for Persona, RoutineBlock, IAQHacks, CityPreset, DeterministicReport, WhatIfComparison, RWAConfig)
- `src/domain/constants.ts` (physical constants: ventilation rates, emission factors, inversion curve, IAQ hack specs, CPCB AQI bands)
- `src/domain/cityPresets.ts` (12 Indian cities with lat/lon, winter PM2.5/PM10/NO2, GRAP stage)
- `src/domain/exposureEngine.ts` (inversion curve, indoor mass-balance $C_{\text{in}}(h)$, inhaled dose $D_{\text{day}}$, optimal ventilation window)
- `src/domain/emissionsEngine.ts` (commute/cooking/heating $\text{CO}_2\text{e}$ & $\text{PM}_{2.5}$ deltas, monthly ₹ cost/savings, RWA community multiplier)
- `src/domain/impactService.ts` (facade orchestrating `computeDeterministicReport()` and `compareWhatIf()` with stable citation IDs `[CALC:*]`)
- `src/domain/i18n.ts` (complete English `en` and Hindi `hi` Devanagari dictionary + plain-language metric formatters)

**Requirements:**
1. Zero React, DOM, Node `fs`, or network imports inside `src/domain/`.
2. Full JSDoc docstrings on every exported function and interface.
3. Strictly $O(N)$ complexity; all edge cases guarded (0 distance, 0 budget, extreme AQI 999, room volume bounds).
4. Budget-aware IAQ hack ranking so low-budget households always receive ₹0–₹500 hacks first.

**Verification:** `npx tsc --noEmit` + domain unit assertions pass.

---

## W3: Express/Vercel Backend, Grounded GenAI Pipeline & Security Middleware

**Owned Files:**
- `server/app.ts` (Express app factory exported for both local dev, Vercel, and Supertest)
- `server/index.ts` (local HTTP server entrypoint)
- `api/index.ts` (Vercel serverless adapter wrapping `server/app.ts`)
- `server/config/env.ts` (strict env loader; never leaks secrets)
- `server/middleware/security.ts` (`helmet` CSP, strict CORS, `express-rate-limit`, `16kb` JSON limit, centralized sanitized error handler)
- `server/middleware/promptGuard.ts` (Zod schemas + prompt-injection detector/sanitizer + XML delimiter wrapper + output leak checker)
- `server/cache/lruCache.ts` (generic SHA-256 keyed LRU cache with TTL & hit/miss stats)
- `server/services/openMeteoClient.ts` (SSRF-safe allowlisted Open-Meteo AQ client with 3.5s `AbortController` timeout + city preset fallback)
- `server/services/genaiService.ts` (`@google/genai` grounded proxy with `[CALC:*]`/`[AQ:*]`/`[GUIDE:*]` citations, Zod output validation, and deterministic offline fallback synthesizer)
- `server/routes/apiRoutes.ts` (`GET /api/health`, `GET /api/aqi`, `POST /api/plan`, `POST /api/what-if`, `POST /api/ai/ask`)

**Requirements:**
1. Every route validates input with Zod; invalid inputs return `400` with clean field errors.
2. Prompt-injection attempts are neutralized and logged as `guardTriggered: true` without leaking system prompts or crashing.
3. `GEMINI_API_KEY` is read strictly on the server; offline fallback returns schema-identical grounded responses in both `en` and `hi`.
4. All upstream calls use `AbortController` timeouts and SHA-256 LRU caching.

**Verification:** `npx tsc --noEmit`, `npx eslint server api`, and live smoke checks on all 5 routes.

---

## W4: Accessible React + Tailwind Frontend UI

**Owned Files:**
- `src/main.tsx`, `src/index.css`, `src/App.tsx`
- `src/services/apiClient.ts` (typed fetch wrapper with `AbortController` support)
- `src/hooks/useSmogPlan.ts` (memoized live Tier 1 preview + debounced Tier 2 grounded fetch with abort cleanup)
- `src/components/Header.tsx` (skip link, city selector, EN/HI toggle, live/preset AQ badge)
- `src/components/SmogAlertBanner.tsx` (`role="alert" aria-live="assertive"` for Severe/GRAP-IV, plain-language guidance)
- `src/components/PersonaForm.tsx` (accessible form for household type, city, commute, cooking, budget, room size, active IAQ hacks)
- `src/components/ImpactDashboard.tsx` (before vs. after $\mu\text{g/day}$ inhaled dose, indoor $\text{PM}_{2.5}$, $\text{CO}_2\text{e}$ avoided, ₹/month, accessible SVG bar/diurnal inversion chart)
- `src/components/DailyRoutineTimeline.tsx` (morning/afternoon/evening low-emission schedule + optimal ventilation window)
- `src/components/WhatIfComparator.tsx` (interactive 2-choice side-by-side comparison with instant quantitative deltas)
- `src/components/RWACommunityPanel.tsx` (household count slider, adoption rate, seasonal $\text{kg CO}_2\text{e}$ & $\text{g PM}_{2.5}$ avoided, copyable RWA notice)
- `src/components/GroundedAssistant.tsx` (interactive Q&A with citation badges `[CALC:*]`, `[AQ:*]`, `[GUIDE:*]`, keyboard-accessible quick prompts)

**Requirements:**
1. WCAG 2.1 AA contrast ($\ge 4.5:1$ text, $\ge 3:1$ UI); never use color alone for AQI severity.
2. Full keyboard navigation (`Tab`, `Enter`, `Space`, `Esc`), visible focus rings, `<html lang>` synced to `en`/`hi`.
3. Zero `dangerouslySetInnerHTML`, zero `@google/genai` imports, zero secrets in client code.
4. Clean responsive layout (mobile + desktop) with `React.memo` / `useMemo` on computed views.

**Verification:** `npm run build` produces lean gzipped bundle (`< 150 KB` JS) with 0 warnings/errors.

---

## W5: Comprehensive Test Suites & Documentation

**Owned Files:**
- `vitest.config.ts`
- `testscript/unit/exposureEngine.test.ts` (inversion curve, mass-balance formula accuracy, inhaled dose, HEPA/Corsi-Rosenthal/mask deltas, boundary cases)
- `testscript/unit/emissionsEngine.test.ts` (commute/cooking deltas, budget sorting, RWA multiplier linearity)
- `testscript/unit/lruCache.test.ts` (SHA-256 determinism, TTL expiry, LRU eviction)
- `testscript/integration/apiRoutes.test.ts` (Supertest tests for `/api/health`, `/api/aqi`, `/api/plan`, `/api/what-if`, `/api/ai/ask` in `en` and `hi`, offline fallback)
- `testscript/security/security.test.ts` (10 prompt-injection payloads, XSS payloads, SSRF rejection, Zod malformed inputs, security headers, CORS rejection, rate limiting)
- `testscript/a11y/accessibility.test.tsx` (JSDOM + Testing Library checks for landmarks, skip link, `aria-live`, form labels, keyboard navigation, EN/HI `<html lang>` toggle, WCAG contrast math)
- `README.md` (problem statement, architecture overview, mathematical formulas summary, setup & `.env` guide, API endpoints, running tests & evaluator)

**Requirements:**
1. 100% deterministic tests (no flaky external network dependency; mock `fetch` for Open-Meteo and test offline fallback cleanly).
2. `src/domain/` coverage $\ge 90\%$.
3. Run `npm run evaluate` as final verification gate and confirm zero Hard-Fail caps and target score $\ge 95.00 / 100.00$.

**Verification:** `npm run typecheck && npm run lint && npm test && npm run build && npm run evaluate`.