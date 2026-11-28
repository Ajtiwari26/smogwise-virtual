# SmogWise Virtual

## Chosen Vertical
**Urban Families & Neighborhood Communities Navigating Severe Winter Smog** — a bilingual (English / हिन्दी) decision-support assistant that helps Indian households and Resident Welfare Associations (RWAs) cut daily inhaled $\text{PM}_{2.5}$ dose, reduce household emissions, and stay within realistic monthly ₹ budgets during winter inversion episodes and GRAP stages.

---

## Approach and Logic

SmogWise Virtual uses a **Two-Tier Hybrid Architecture** so every number is auditable, fast, and resilient even when upstream APIs are offline:

1. **Tier 1 — Deterministic Physics, Exposure & Emissions Engine (`src/domain/`)**
   - Pure TypeScript with zero React, DOM, Node, or network dependencies.
   - **Diurnal Winter Inversion Curve:** Scales baseline city $\text{PM}_{2.5}$ across 24 hours with morning (06:00–09:00) and evening (19:00–23:00) boundary-layer peaks and a midday trough (13:00–16:00) for checking ventilation conditions.
   - **Transient Single-Zone Indoor Mass Balance:**
     $$C_{\text{steady}}(h) = \frac{P \cdot \text{ACH}(h) \cdot C_{\text{out}}(h) + E_{\text{cook}}(h)/V}{r(h)}, \quad C_{\text{in}}(h) = C_{\text{steady}}(h) + \bigl(C_{\text{in}}(h-1) - C_{\text{steady}}(h)\bigr)e^{-r(h)}$$
     where $r(h) = \text{ACH}(h) + k_{\text{dep}} + \text{CADR}/V$ is stepped across 2 passes of the 24-hour diurnal cycle with selective sealing and a modeled afternoon ventilation option ($P$: penetration, $\text{ACH}$: air changes per hour, $k_{\text{dep}}$: deposition rate enhanced by wet mopping, $\text{CADR}$: clean air delivery rate from HEPA / Corsi-Rosenthal box, and $V \in [12, 500]\,\text{m}^3$ clamped room volume).
   - **Selective Sealing & Ventilation:** The sealing schedule maintains baseline air exchange during cooking and its modeled recovery period. An eligible afternoon hour models 30 minutes of higher airflow followed by 30 minutes of ordinary exchange. The model flags hours only when outdoor PM2.5 is lower than indoors and at or below 120 ug/m3.
   - **Daily Inhaled Dose:** Integrates hourly outdoor/indoor concentration $\times$ activity-specific inhalation rate (sleep, resting, commute), scaled for vulnerable members and N95 filtration efficiency.
   - **Emissions, Budget Ranking & RWA Multiplier:** Computes $\text{CO}_2\text{e}$ (g/day), $\text{PM}_{2.5}$ (mg/day), and net monthly ₹ savings across commute and cooking choices, sorts IAQ interventions so ₹0–₹500 hacks surface first, and scales community impact linearly across participating RWA households.

2. **Tier 2 — Grounded GenAI Advisory (`server/services/genaiService.ts`)**
   - Uses `@google/genai` Interactions API strictly on the server (`gemini-3.5-flash-lite` primary with a `4500ms` timeout and `gemini-4-hydrogen` `1800ms` fallback bounded inside `5500ms`), grounded on Tier 1 citation tokens (`[CALC:DOSE_BEFORE]`, `[CALC:DOSE_AFTER]`, `[CALC:INDOOR_PM25]`, `[CALC:INDOOR_TARGET]`, `[CALC:CO2E_SAVED]`, `[CALC:INR_DELTA]`, `[SCI:PLANTS_VS_HEPA]`, `[AQ:SOURCE]`).
   - Uses Zod for API request schemas and structured briefing JSON. Free-text Q&A checks for usable prose after citation cleanup and secret redaction. Both endpoints return deterministic bilingual guidance when Gemini is disabled or returns no usable result.

---

## Pan-India Location Search & Browser Geolocation

- **Pan-India Geocoding (`GET /api/locations/search?q=<query>`):** Uses Open-Meteo Geocoding with `countryCode=IN` and checks the returned country code and coordinate bounds (`lat` $\in [6.5, 37.5]$, `lon` $\in [68.0, 97.5]$). Successful responses, including empty results, are cached for 24 hours. Searches with no usable remote matches return matching curated Indian presets. Failed and malformed responses are retried on the next search.
- **Browser Geolocation & `0.05°` Coordinate Grid (`GET /api/aqi?lat=<lat>&lon=<lon>`):** Quantizes coordinates to a `0.05°` (~5.5 km) SHA-256 LRU cache key so nearby requests share cached live readings. Each caller's exact location determines its distance to the nearest fallback station.
- **50 km Nearest-Station Fallback:** If Open-Meteo Air Quality fails or times out (3.5s), custom coordinates within **50 km** of a preset station receive that preset and its name. Beyond **50 km**, the API returns `503 LIVE_AQ_UNAVAILABLE`. The cutoff uses the unrounded distance. The workspace keeps the location selected, shows the outage and nearest station, and withholds local exposure, routines, what-if results, and briefings until a representative snapshot is available.

---

## CPCB NAQI Sub-Index Engine

- **0–500 Piecewise Linear Calculation (`src/domain/cpcbAqi.ts`):** Computes official Central Pollution Control Board National Air Quality Index sub-indices for $\text{PM}_{2.5}$, $\text{PM}_{10}$, and $\text{NO}_2$ using:
  $$I_p = \frac{I_{\text{HI}} - I_{\text{LO}}}{B_{\text{HI}} - B_{\text{LO}}} (C_p - B_{\text{LO}}) + I_{\text{LO}}$$
  clamped to `[0, 500]` across all six CPCB severity bands (`Good` 0–50, `Satisfactory` 51–100, `Moderate` 101–200, `Poor` 201–300, `Very Poor` 301–400, `Severe` 401–500), reporting the governing `dominantPollutant`.
- **Observation Timestamp:** The API adds `+05:30` to offset-free Open-Meteo timestamps requested in `Asia/Kolkata` and preserves explicit upstream offsets, including `Z`. The UI formats live observation times in IST.

---

## Sample Evaluator Scenarios

| Scenario ID | Preset Household | City / Grid | Language | Key Verification Focus |
| :--- | :--- | :--- | :--- | :--- |
| `delhi_young_family` | Delhi Family (4 members, vulnerable child, ₹2,500/mo, `metro_bus`) | Delhi (Anand Vihar) | English (`en`) | Before/after inhaled $\text{PM}_{2.5}$ dose drop, midday ventilation window, `[CALC:INDOOR_TARGET]` & `[SCI:PLANTS_VS_HEPA]` citations |
| `lucknow_senior_hindi` | Lucknow Senior Citizen Home (3 members, vulnerable senior, ₹1,800/mo, `induction`) | Lucknow (Gomti Nagar) | हिन्दी (`hi`) | Low-cost hacks + DIY Corsi-Rosenthal Box ranking + Devanagari localized advice |
| `gurugram_rwa_180` | Gurugram RWA Coordinator (180 flats, 65% adoption, ₹4,500/mo) | Gurugram (DLF Phase 3) | English (`en`) | Linear RWA community $\text{CO}_2\text{e}$ & $\text{PM}_{2.5}$ scaling + copyable RWA notice |
| `patna_clean_cooking` | Patna Chulha Transition (5 members, ₹900/mo, `biomass_chulha`) | Patna (Boring Road) | English (`en`) | Clean-cooking transition impact + budget-first low-cost hacks |
| `delhi_office_commuter` | Delhi Office Commuter (`office_commuter` persona contrasting `delhi_young_family`) | Delhi (Anand Vihar) | English (`en`) | High-exposure daily commute dose reduction, N95 mask impact, and transit mode deltas |
| `kanpur_outdoor_student` | Kanpur Outdoor Student (`outdoor_student`, `two_wheeler`, ₹1,200/mo, N95) | Kanpur (Nehru Nagar) | English (`en`) | `1.1x` commuting-student inhalation multiplier and afternoon sports AQI threshold gate |

---

## Architecture, Prompt Flow & GenAI vs Deterministic Engineering Split

| Layer | Responsibility | Implementation & Safeguards |
| :--- | :--- | :--- |
| **Tier 1: Deterministic Engine** | Diurnal inversion profile, indoor mass balance, inhaled dose, CPCB NAQI sub-indices, emissions, budget ranking, RWA scaling | Pure TypeScript in `src/domain/`; zero network/DOM calls; sub-millisecond client & server execution; emits `[CALC:*]`, `[SCI:*]`, and `[AQ:*]` ground-truth tokens |
| **Edge & Location Guard** | Query validation, India bounding box (`6.5–37.5°N, 68.0–97.5°E`), SSRF allowlisting, `0.05°` cache quantization, rate limiting | `server/middleware/locationGuard.ts` & `server/services/openMeteoClient.ts` reject array parameters (`?q[]=`), URLs, and out-of-bounds coordinates with HTTP `400` |
| **Prompt Flow & Isolation** | Bilingual advisory, what-if narrative, and grounded Q&A (`POST /api/plan`, `/api/what-if`, `/api/ai/ask`) | User text is NFKC-normalized, stripped of spoofed `[CALC:*]`/`[AQ:*]`/`[SCI:*]` tags, XML-escaped inside `<user_query>`, and LLM responses are filtered to verified `allowedKeys` |
| **Tier 2: Grounded GenAI** | Selection of server-rendered Tier 1 facts and locally executed tool results (`gemini-3.5-flash-lite` -> `gemini-4-hydrogen`) | Server-only `@google/genai` client with Zod validation for structured briefing JSON, output leak scanning, and deterministic bilingual fallback |

---

## How the Solution Works

- **End-to-End Flow:** Users select a preset city, search any Indian town/city, or use browser geolocation, then configure household profile, budget, commute, cooking fuel, and IAQ interventions. Tier 1 updates the dashboard instantaneously in the browser, while the Express/Vercel backend serves cached live AQ, full localized plans, what-if comparisons, and grounded Q&A.
- **API Endpoints:**
  - `GET /api/health` — liveness and status.
  - `GET /api/locations/search?q=<query>` — Pan-India city/town search with strict query and SSRF guards.
  - `GET /api/aqi?city=<id>` or `GET /api/aqi?lat=<lat>&lon=<lon>` — SSRF-safe Open-Meteo AQ fetch (3.5s `AbortController` timeout, `0.05°` quantized coordinate fetch + SHA-256 LRU cache), CPCB sub-index calculation across available pollutants (`PM2.5`, `PM10`, `NO2`), a live observation timestamp when supplied, an observation ID, an AQ status, and a 50 km preset fallback.
  - `POST /api/plan` — full localized (`en`/`hi`) daily routine, ranked IAQ hacks, citations, and copyable RWA notice (strict `UserProfile` or `{ profile, useLiveAq? }` validation).
  - `POST /api/plan/briefing` — `AiPlanBriefingCard` requests server-rendered claims and household action selections from `gemini-3.5-flash-lite`, with a budgeted `gemini-4-hydrogen` fallback, bounded LRU caching, and deterministic bilingual guidance. The community plan calculates RWA totals.
  - `POST /api/what-if` — side-by-side comparison of two household choices with quantitative deltas and location-specific AQ sources.
  - `POST /api/ai/ask` — grounded bilingual Q&A with prompt-injection sanitization, XML delimiters, and output leak checks.
- **Security & Accessibility:** Helmet CSP (including `font-src 'self' data:`)/`nosniff`/`X-Frame-Options`, `Permissions-Policy: geolocation=(self)`, `Referrer-Policy: no-referrer`, COOP/CORP headers, strict CORS + CSRF Origin/`Sec-Fetch-Site` mutation guard, `bodyGuard` own-property prototype-pollution and nesting depth-8 guard, 16 KB JSON body limit, `Cache-Control` `public, s-maxage=300, stale-while-revalidate=600` vs `private, no-store` split, bounded singleflight deduplication, isolated route-group rate limiting (with Vercel serverless per-instance ephemeral cold-start caveat), sanitized Zod validation (no stack traces), production dependency audits, `>=92%` stmts/funcs/lines and `>=85%` branches coverage gates, `ErrorBoundary`, `sr-only` `ImpactDashboard` chart table, WCAG 2.1 AA contrast, semantic landmarks, skip link, `aria-live` alerts, keyboard navigation, and non-color-only CPCB AQI labels.

---

## Assumptions Made

- **Single-Zone Well-Mixed Box:** Indoor air is modeled as a uniform volume $V$ clamped to $[12, 500]\,\text{m}^3$ with a 2-pass transient 24-hour exponential mass-balance model and selective sealing/ventilation.
- **Diurnal Profile:** Winter boundary-layer multipliers reflect typical Indo-Gangetic Plain inversion cycles. The model checks 13:00–16:00 for hours suitable for ventilation.
- **Inhalation Rates:** Standard adult resting/sleep/commute ventilation rates ($\text{m}^3/\text{h}$) with a conservative multiplier when vulnerable members (children, elderly, asthma) are present.
- **CPCB Thresholds & GRAP:** Severity bands (`Good` through `Severe`) follow CPCB NAQI sub-index breakpoints and GRAP advisory severity tiers derived from winter $\text{PM}_{2.5}$ thresholds.
- **INR Tariffs & Fuels:** Monthly operating costs and savings use representative Indian urban petrol, metro/bus, LPG, electricity, and DIY/HEPA filter maintenance costs across 22 commute days and 30 household days per month.

---

## Evaluator Test Credentials & Authentication

SmogWise Virtual protects the personalized household & RWA workspace behind a server-verified authentication gateway (`LoginGate`) with 1-click evaluator sign-in and manual credential login:

| Persona | Email | Public Sandbox Password | Default City & Language |
| :--- | :--- | :--- | :--- |
| **Delhi Family** (`young_family`) | `family.eval@smogwise.in` | `SmogWise#Eval2026` | Delhi (Anand Vihar) · English (`en`) |
| **Lucknow Senior** (`sensitive_household`) | `senior.eval@smogwise.in` | `SmogWise#Eval2026` | Lucknow (Gomti Nagar) · हिन्दी (`hi`) |
| **Gurugram RWA** (`rwa_coordinator`) | `rwa.eval@smogwise.in` | `SmogWise#Eval2026` | Gurugram (DLF) · English (`en`) |
| **Office Commuter** (`office_commuter`) | `commuter.eval@smogwise.in` | `SmogWise#Eval2026` | Delhi Commuter · English (`en`) |
| **Outdoor Student** (`outdoor_student`) | `student.eval@smogwise.in` | `SmogWise#Eval2026` | Kanpur Student · English (`en`) |

- **Cryptographic Password & Session Security:** Passwords are verified non-blockingly on login routes using salted async `crypto.scrypt` and constant-time `crypto.timingSafeEqual`. Successful authentication issues a 24-hour `HMAC-SHA256` signed `HttpOnly`, `SameSite=Lax` (`Secure` in production) session cookie carrying a unique `jti` token ID signed with `AUTH_SECRET`. Production sign-in and preferences require a stable secret of at least 32 characters. Development can use a per-process CSPRNG key.
- **Dedicated Brute-Force Protection & Zero Bypasses:** Login uses `authLimiter` (20 requests per 15 minutes per IP). Logout, session lookup, and preferences share `sessionLimiter` (120 requests per 15 minutes per IP). The workspace requires a server-verified session.
- **Auth & Preference Endpoints:**
  - `POST /api/auth/login` — verifies email/password via async `crypto.scrypt` + `timingSafeEqual` and sets the `HttpOnly` session cookie.
  - `POST /api/auth/logout` — revokes active session `jti` in memory and clears the session cookie (`Max-Age=0`).
  - `GET /api/auth/session` — validates the `HMAC-SHA256` session cookie and returns `{ authenticated: true, user }` when signed in, or `{ authenticated: false, user: null }` otherwise.
  - `GET /api/user/preferences` & `PUT /api/user/preferences` — reads and writes session-scoped demo preferences. GET returns a strong revision ETag. PUT accepts that ETag in `If-Match` and returns 409 on a stale revision.

- **Single-instance deployment:** Signed preference cookies carry a session-scoped revision between instances. In-memory preferences, comparison-and-set checks, rate limits, and logout revocations are instance-local. Concurrent writes on different instances can diverge, and copied tokens can remain valid on other instances until expiry. Within an instance, a stale validator receives a conflict and the workspace offers an explicit reload. Failed pre-sign-out saves leave the session open.

---

## Setup, Environment & Verification

```bash
npm install
cp .env.example .env
# Optional: set GEMINI_API_KEY= in .env for live Tier 2 Gemini responses
# Set AUTH_SECRET in production to a stable high-entropy value of at least 32 characters
# Optional: set TRUST_PROXY=1 in .env only when deployed behind a trusted reverse proxy
```

### Run Locally
```bash
npm run dev
```

### Typecheck, Lint, Tests & Coverage
```bash
npm run typecheck
npm run lint
npm run test:coverage
```

### Run the 100-Point Hybrid Evaluator
```bash
npm run evaluate
```
