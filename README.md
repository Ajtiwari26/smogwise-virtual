# SmogWise Virtual

## Chosen Vertical
**Urban Families & Neighborhood Communities Navigating Severe Winter Smog** — a bilingual (English / हिन्दी) decision-support assistant that helps Indian households and Resident Welfare Associations (RWAs) cut daily inhaled $\text{PM}_{2.5}$ dose, reduce household emissions, and stay within realistic monthly ₹ budgets during winter inversion episodes and GRAP stages.

---

## Approach and Logic

SmogWise Virtual uses a **Two-Tier Hybrid Architecture** so every number is auditable, fast, and resilient even when upstream APIs are offline:

1. **Tier 1 — Deterministic Physics, Exposure & Emissions Engine (`src/domain/`)**
   - Pure TypeScript with zero React, DOM, Node, or network dependencies.
   - **Diurnal Winter Inversion Curve:** Scales baseline city $\text{PM}_{2.5}$ across 24 hours with morning (06:00–09:00) and evening (19:00–23:00) boundary-layer peaks and a midday trough (13:00–16:00) for optimal ventilation.
   - **Single-Zone Indoor Mass Balance:**
     $$C_{\text{in}}(h) = \frac{P \cdot \text{ACH}(h) \cdot C_{\text{out}}(h) + E_{\text{cook}}(h)/V}{\text{ACH}(h) + k_{\text{dep}} + \text{CADR}/V}$$
     where $P$ is penetration factor, $\text{ACH}$ is air changes per hour, $k_{\text{dep}}$ is deposition rate (enhanced by wet mopping), $\text{CADR}$ is clean air delivery rate (HEPA / Corsi-Rosenthal box), and $V \in [12, 500]\,\text{m}^3$ is clamped room volume.
   - **Daily Inhaled Dose:** Integrates hourly outdoor/indoor concentration $\times$ activity-specific inhalation rate (sleep, resting, commute), scaled for vulnerable members and N95 filtration efficiency.
   - **Emissions, Budget Ranking & RWA Multiplier:** Computes $\text{CO}_2\text{e}$ (g/day), $\text{PM}_{2.5}$ (mg/day), and net monthly ₹ savings across commute and cooking choices, sorts IAQ interventions so ₹0–₹500 hacks surface first, and scales community impact linearly across participating RWA households.

2. **Tier 2 — Grounded GenAI Advisory (`server/services/genaiService.ts`)**
   - Uses `@google/genai` (Gemini 4 Interactions API) strictly on the server, grounded on Tier 1 citation tokens (`[CALC:DOSE_BEFORE]`, `[CALC:DOSE_AFTER]`, `[CALC:INDOOR_PM25]`, `[CALC:INDOOR_TARGET]`, `[CALC:CO2E_SAVED]`, `[CALC:INR_DELTA]`, `[SCI:PLANTS_VS_HEPA]`, `[AQ:SOURCE]`).
   - Validates outputs with Zod and falls back to a deterministic bilingual synthesizer when `GEMINI_API_KEY` is absent or upstream calls fail.

---

## Pan-India Location Search & Browser Geolocation

- **Pan-India Geocoding (`GET /api/locations/search?q=<query>`):** Combines instant matching across the 12 curated Indian winter presets with SSRF-guarded Open-Meteo Geocoding filtered strictly to India (`countryCode=IN`) and bounded coordinates (`lat` $\in [6.5, 37.5]$, `lon` $\in [68.0, 97.5]$).
- **Browser Geolocation & `0.05°` Coordinate Grid (`GET /api/aqi?lat=<lat>&lon=<lon>`):** Quantizes coordinates to a `0.05°` (~5.5 km) SHA-256 LRU cache key so nearby requests share cached live readings without leaking exact GPS precision.
- **50 km Nearest-Station Fallback vs Honest `503 LIVE_AQ_UNAVAILABLE`:** When Open-Meteo Air Quality is unreachable or times out (3.5s `AbortController`), custom coordinates within **50 km** of a curated Indian preset fall back transparently to that station (`dataSource: "city_preset"`, `fallbackStationName`), while remote coordinates beyond 50 km return an explicit `503 LIVE_AQ_UNAVAILABLE` error instead of fabricating air-quality numbers.

---

## CPCB NAQI Sub-Index Engine

- **0–500 Piecewise Linear Calculation (`src/domain/cpcbAqi.ts`):** Computes official Central Pollution Control Board National Air Quality Index sub-indices for $\text{PM}_{2.5}$, $\text{PM}_{10}$, and $\text{NO}_2$ using:
  $$I_p = \frac{I_{\text{HI}} - I_{\text{LO}}}{B_{\text{HI}} - B_{\text{LO}}} (C_p - B_{\text{LO}}) + I_{\text{LO}}$$
  clamped to `[0, 500]` across all six CPCB severity bands (`Good` 0–50, `Satisfactory` 51–100, `Moderate` 101–200, `Poor` 201–300, `Very Poor` 301–400, `Severe` 401–500), reporting the governing `dominantPollutant`.
- **IST (`+05:30`) Observation Timestamp Badge:** Normalizes upstream UTC or preset timestamps into Indian Standard Time (`YYYY-MM-DDTHH:mm:ss+05:30`) surfaced alongside the live/preset provenance badge in the header.

---

## Sample Evaluator Scenarios

| Scenario ID | Preset Household | City / Grid | Language | Key Verification Focus |
| :--- | :--- | :--- | :--- | :--- |
| `delhi_young_family` | Delhi Family (4 members, vulnerable child, ₹2,500/mo, `metro_bus`) | Delhi (Anand Vihar) | English (`en`) | Before/after inhaled $\text{PM}_{2.5}$ dose drop, midday ventilation window, `[CALC:INDOOR_TARGET]` & `[SCI:PLANTS_VS_HEPA]` citations |
| `lucknow_senior_hindi` | Lucknow Senior Citizen Home (3 members, vulnerable senior, ₹1,800/mo, `induction`) | Lucknow (Gomti Nagar) | हिन्दी (`hi`) | Low-cost hacks + DIY Corsi-Rosenthal Box ranking + Devanagari localized advice |
| `gurugram_rwa_180` | Gurugram RWA Coordinator (180 flats, 65% adoption, ₹4,500/mo) | Gurugram (DLF Phase 3) | English (`en`) | Linear RWA community $\text{CO}_2\text{e}$ & $\text{PM}_{2.5}$ scaling + copyable RWA notice |
| `patna_clean_cooking` | Patna Chulha Transition (5 members, ₹900/mo, `biomass_chulha`) | Patna (Boring Road) | English (`en`) | Clean-cooking transition impact + budget-first low-cost hacks |
| `delhi_office_commuter` | Delhi Office Commuter (`office_commuter` persona contrasting `delhi_young_family`) | Delhi (Anand Vihar) | English (`en`) | High-exposure daily commute dose reduction, N95 mask impact, and transit mode deltas |

---

## Architecture, Prompt Flow & GenAI vs Deterministic Engineering Split

| Layer | Responsibility | Implementation & Safeguards |
| :--- | :--- | :--- |
| **Tier 1: Deterministic Engine** | Diurnal inversion profile, indoor mass balance, inhaled dose, CPCB NAQI sub-indices, emissions, budget ranking, RWA scaling | Pure TypeScript in `src/domain/`; zero network/DOM calls; sub-millisecond client & server execution; emits `[CALC:*]`, `[SCI:*]`, and `[AQ:*]` ground-truth tokens |
| **Edge & Location Guard** | Query validation, India bounding box (`6.5–37.5°N, 68.0–97.5°E`), SSRF allowlisting, `0.05°` cache quantization, rate limiting | `server/middleware/locationGuard.ts` & `server/services/openMeteoClient.ts` reject array parameters (`?q[]=`), URLs, and out-of-bounds coordinates with HTTP `400` |
| **Prompt Flow & Isolation** | Bilingual advisory, what-if narrative, and grounded Q&A (`POST /api/plan`, `/api/what-if`, `/api/ai/ask`) | User text is NFKC-normalized, stripped of spoofed `[CALC:*]`/`[AQ:*]` tags, XML-escaped, and isolated inside `<user_query>` tags alongside read-only Tier 1 facts |
| **Tier 2: Gemini 4 Advisory** | Natural-language synthesis grounded strictly in Tier 1 citation tokens | `@google/genai` server-only client (`server/services/genaiService.ts`) with Zod schema validation, output leak scanning, and deterministic bilingual fallback |

---

## How the Solution Works

- **End-to-End Flow:** Users select a preset city, search any Indian town/city, or use browser geolocation, then configure household profile, budget, commute, cooking fuel, and IAQ interventions. Tier 1 updates the dashboard instantaneously in the browser, while the Express/Vercel backend serves cached live AQ, full localized plans, what-if comparisons, and grounded Q&A.
- **API Endpoints:**
  - `GET /api/health` — liveness and status.
  - `GET /api/locations/search?q=<query>` — Pan-India city/town search with strict query and SSRF guards.
  - `GET /api/aqi?city=<id>` or `GET /api/aqi?lat=<lat>&lon=<lon>` — SSRF-safe Open-Meteo AQ fetch (3.5s `AbortController` timeout, `0.05°` SHA-256 LRU cache), CPCB NAQI sub-indices, `+05:30` IST timestamp, and 50 km preset fallback.
  - `POST /api/plan` — full localized (`en`/`hi`) daily routine, ranked IAQ hacks, citations, and copyable RWA notice.
  - `POST /api/plan/briefing` — `AiPlanBriefingCard` debounced Gemini 4 headline, summary, and grounded actions with bounded LRU caching and deterministic bilingual fallback.
  - `POST /api/what-if` — side-by-side comparison of two household choices with quantitative deltas.
  - `POST /api/ai/ask` — grounded bilingual Q&A with prompt-injection sanitization, XML delimiters, and output leak checks.
- **Security & Accessibility:** Helmet CSP (including `font-src 'self' data:`)/`nosniff`/`X-Frame-Options`, `Permissions-Policy: geolocation=(self)`, `Referrer-Policy: no-referrer`, COOP/CORP headers, strict CORS, `bodyGuard` own-property prototype-pollution and nesting depth-8 guard, 16 KB JSON body limit, `Cache-Control` `public, s-maxage=300, stale-while-revalidate=600` vs `private, no-store` split, bounded singleflight deduplication, isolated route-group rate limiting (with Vercel serverless per-instance ephemeral cold-start caveat), sanitized Zod validation (no stack traces), 0-CVE npm dependencies, `>=85%` stmts/funcs/lines and `>=75%` branches coverage gates, `ErrorBoundary`, `sr-only` `ImpactDashboard` chart table, WCAG 2.1 AA contrast, semantic landmarks, skip link, `aria-live` alerts, keyboard navigation, and non-color-only CPCB AQI labels.

---

## Assumptions Made

- **Single-Zone Well-Mixed Box:** Indoor air is modeled as a uniform volume $V$ clamped to $[12, 500]\,\text{m}^3$ with steady-state hourly mass balance.
- **Diurnal Profile:** Winter boundary-layer multipliers reflect typical Indo-Gangetic Plain inversion cycles with a 13:00–16:00 ventilation window.
- **Inhalation Rates:** Standard adult resting/sleep/commute ventilation rates ($\text{m}^3/\text{h}$) with a conservative multiplier when vulnerable members (children, elderly, asthma) are present.
- **CPCB Thresholds & GRAP:** Severity bands (`Good` through `Severe`) and GRAP stages follow Indian CPCB guidelines.
- **INR Tariffs & Fuels:** Monthly operating costs and savings use representative Indian urban petrol, metro/bus, LPG, electricity, and DIY/HEPA filter maintenance costs across 22 commute days and 30 household days per month.

---

## Setup, Environment & Verification

```bash
npm install
cp .env.example .env
# Optional: set GEMINI_API_KEY in .env for live Tier 2 Gemini 4 responses
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
