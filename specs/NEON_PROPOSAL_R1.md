# Round 1 Architecture Proposal — SmogWise Virtual (Gemini 4 Neon)

Target: Challenge 6 (Urban Air Quality Assistant) — 4 concrete upgrades preserving strict TypeScript (`exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, zero `any`), ESLint (`complexity <= 10`, `max-len <= 100`), WCAG 2.1 AA, and repo size `< 10 MB`.

---

## Upgrade 1: Pan-India Location Search & Browser Geolocation

### 1.1 Allowlisted Open-Meteo Geocoding API (`GET /api/locations/search?q=<query>`)
- **Upstream endpoint (hardcoded allowlist):** `https://geocoding-api.open-meteo.com/v1/search`
- **Fixed query params:** `countryCode=IN`, `count=6`, `language=en`, `format=json`, `name=<validated q>`.
- **Timeout:** `3500 ms` via `AbortController`.
- **Input validation (Zod v4 in `server/middleware/promptGuard.ts`):**
  - `LocationSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(64) })`
  - Reject with `400` if `isUnsafeCityInput(q)` is true (blocks URLs, IP literals, `169.254.*`, `localhost`, brackets, control chars).
- **Response schema (`LocationSearchItem`):**
  ```ts
  export interface LocationSearchItem {
    readonly id: string;       // "in_<quantizedLat>_<quantizedLon>"
    readonly name: string;     // sanitized plain text, max 64 chars
    readonly state: string;    // admin1 ?? 'India', sanitized
    readonly lat: number;      // quantized to 2 decimals
    readonly lon: number;      // quantized to 2 decimals
  }
  ```
- **Caching:** `geoCache = createLruCache<readonly LocationSearchItem[]>(200, 24 * 60 * 60 * 1000)` keyed on `hashCacheKey({ service: 'open-meteo-geo', q: q.toLowerCase() })`. Offline/timeout fallback returns matching entries from curated `CITY_PRESETS`.
- **Rate limiting:** Add `geoLimiter` (`60 req / 15 min`) in `createRouteLimiters()` so search typing bursts do not starve `/api/plan` or `/api/ai/ask`.

### 1.2 Coordinate-Based AQI Lookup (`GET /api/aqi?lat=<num>&lon=<num>&name=<opt>&state=<opt>`)
- **India bounding box (hard fail `400` outside):**
  - `lat ∈ [6.5, 37.5]` (Indira Point to Ladakh)
  - `lon ∈ [68.0, 97.5]` (Kutch to Arunachal Pradesh)
- **Coordinate quantization (cache-busting DoS defense):**
  - Round both coordinates to `0.01°` (~1.1 km grid cell): `qLat = Math.round(lat * 100) / 100`, `qLon = Math.round(lon * 100) / 100`.
  - Both upstream Open-Meteo URL and `aqCache` key use `(qLat, qLon)` exclusively: `hashCacheKey({ service: 'open-meteo-coords', lat: qLat, lon: qLon })`.
- **Synthetic `CityPreset` for ad-hoc Indian locations:**
  - `id: "custom_${qLat}_${qLon}"`, `name` / `state` sanitized via `SAFE_CITY_RE` (fallback `'Selected Location'`, `'India'`).
  - `grapStage` derived deterministically from live `cpcbAqi` (`<=200: NONE`, `201-300: GRAP_I`, `301-400: GRAP_II`, `401-450: GRAP_III`, `>450: GRAP_IV`).
- **Plan / What-If / AI Ask integration:**
  - Add optional `customLocation?: { readonly name: string; readonly state?: string; readonly lat: number; readonly lon: number }` to `UserProfile` and `UserProfileSchema` (with India bounds + quantization). Preserve `exactOptionalPropertyTypes: true` by omitting undefined keys via conditional spread.
- **Frontend UX (`PersonaForm.tsx` + `useSmogPlan.ts`):**
  - Debounced (`350 ms`) Pan-India combobox/search input + "Use My Location" button (`navigator.geolocation.getCurrentPosition` with `timeout: 8000`, `enableHighAccuracy: false`).
  - Graceful fallback banner if permission is denied, unavailable, or outside India.

---

## Upgrade 2: Visible Live Data Source, Observation Timestamp & CPCB Sub-Index AQI (0–500)

### 2.1 Deterministic CPCB NAQI Sub-Index Engine (`src/domain/cpcbAqi.ts`)
- Linear piecewise interpolation per CPCB National Air Quality Index specification:
  $$I_p = \text{round}\left(\frac{I_{HI} - I_{LO}}{BP_{HI} - BP_{LO}} \cdot (C_p - BP_{LO}) + I_{LO}\right)$$
- **Breakpoints:**
  | Band | AQI (`I_LO–I_HI`) | PM2.5 (`ug/m3`) | PM10 (`ug/m3`) | NO2 (`ug/m3`) |
  | :--- | :--- | :--- | :--- | :--- |
  | Good | 0–50 | 0–30 | 0–50 | 0–40 |
  | Satisfactory | 51–100 | 31–60 | 51–100 | 41–80 |
  | Moderate | 101–200 | 61–90 | 101–250 | 81–180 |
  | Poor | 201–300 | 91–120 | 251–350 | 181–280 |
  | Very Poor | 301–400 | 121–250 | 351–430 | 281–400 |
  | Severe | 401–500 | 251–500+ | 431–600+ | 401–800+ |
- **Clamping & continuity:** Use continuous lower bounds (`0, 30, 60, 90, 120, 250` for PM2.5) so fractional values like `30.4` never fall into a gap; clamp output to `[0, 500]`.
- **Aggregate:** `cpcbAqi = Math.max(subPm25, subPm10, subNo2)`, `dominantPollutant: 'PM2.5' | 'PM10' | 'NO2'`, `aqiBand: AqiBandId`.

### 2.2 Contract Extensions
- **`OpenMeteoResponseSchema`:** Add `time: z.string().min(10).max(40).optional()` inside `current`.
- **`LiveAqOverride` (`src/domain/types.ts`):** Add `observedAt?: string`, `cpcbAqi?: number`, `dominantPollutant?: 'PM2.5' | 'PM10' | 'NO2'`.
- **`AirQualityLookupResult` (`server/services/openMeteoClient.ts`):** Add `cpcbAqi: number`, `aqiBand: AqiBandId`, `dominantPollutant: 'PM2.5' | 'PM10' | 'NO2'`, `observedAt?: string`.
- **`DeterministicReport` (`src/domain/types.ts`):** Add `cpcbAqi: number`, `aqiBand: AqiBandId`, `dominantPollutant: 'PM2.5' | 'PM10' | 'NO2'`, `observedAt?: string`.

### 2.3 `SmogAlertBanner.tsx` Upgrade
- Accept `dataSource`, `cpcbAqi`, `dominantPollutant`, and `observedAt` (optional) as props.
- Display:
  1. High-contrast CPCB AQI pill (`CPCB AQI 382 · Very Poor`, dominant pollutant `PM2.5`).
  2. Source badge: `Live Open-Meteo` vs `Curated Winter Preset` (bilingual EN/HI).
  3. Observation timestamp formatted cleanly (IST / local time) when `observedAt` is present.
- Maintain `role={isUrgent ? 'alert' : 'status'}` and `aria-live={isUrgent ? 'assertive' : 'polite'}` with WCAG 2.1 AA contrast (`>= 4.5:1`).

---

## Upgrade 3: 4 One-Click Sample Scenarios & Routine Sharpening

### 3.1 Four One-Click Sample Scenarios (`src/domain/sampleScenarios.ts`)
Rendered as accessible `<button type="button">` chips at the top of `PersonaForm.tsx`:
1. **Delhi NCR Young Family:** `delhi_anand_vihar`, `young_family`, 4 members, `hasVulnerableMember: true`, ₹3,000/mo, `petrol_car` 18 km, `lpg`, `['window_sealing', 'wet_mopping']`.
2. **Lucknow Senior Budget (HI):** `lucknow_gomti_nagar`, `sensitive_household`, 2 members, `hasVulnerableMember: true`, ₹1,200/mo, `wfh_walk` 2 km, `lpg`, `['wet_mopping']`, `language: 'hi'`.
3. **Gurugram RWA Coordinator:** `gurugram_dlf`, `rwa_coordinator`, 180 flats (`rwaAdoptionRate: 0.6`), ₹5,000/mo, `carpool` 20 km, `induction`, `['window_sealing', 'ventilation_window']`.
4. **Patna Clean-Cooking Transition:** `patna_kankarbagh`, `young_family`, 5 members, `hasVulnerableMember: true`, ₹1,800/mo, `two_wheeler` 12 km, `biomass_chulha`, `['wet_mopping']`.

### 3.2 Morning / Afternoon / Evening Routine Sharpening
- **Indoor PM2.5 Target `< 30 ug/m3`:** Explicitly state target status (`Target met` vs `Gap: X ug/m3`) in the routine and `citations['[CALC:INDOOR_TARGET]']`.
- **Kids Outdoor Play Gate (Afternoon block):**
  - `outdoorPm25 <= 60`: Safe for 45–60 min outdoor play.
  - `61–120`: Limit to 20 min in `optimalVentilationWindow`; avoid strenuous running.
  - `> 120`: Keep children indoors; switch to indoor activity.
- **Senior / Vulnerable Caution (Morning block):**
  - When `hasVulnerableMember` and morning PM2.5 `> 90 ug/m3`, explicitly advise deferring morning walks to the afternoon ventilation window and wearing a fitted N95 if stepping out.
- **Trip Chaining (Commute / Evening block):**
  - When `commuteMode` is `petrol_car` or `two_wheeler` and `commuteDistanceKm > 0`, recommend chaining school/grocery errands into a single off-peak trip to cut cold-start PM2.5 and NO2 spikes.
- **Honest Purifier vs. Indoor Plants Science (`[SCI:PLANTS_VS_HEPA]`):**
  - Deterministic advisory & citation clarifying that potted houseplants provide negligible PM2.5 removal (`~0.01–0.05 m3/h` CADR per plant vs `150–300 m3/h` for a HEPA purifier or DIY Corsi-Rosenthal box) and must not be relied upon for smog protection.

---

## Upgrade 4: README & Evaluator Updates

- **`README.md`:** Document Pan-India geocoding + geolocation endpoints, coordinate quantization, CPCB NAQI sub-index formula, 4 sample scenarios, security architecture, and `npm run typecheck && npm run lint && npm test && npm run build`.
- **`testscript/evaluator/analyzers/alignmentRuntimeAnalyzer.ts`:**
  - Keep every helper `<= 35` lines, cyclomatic complexity `<= 6`, line length `<= 95` chars, zero `any`.
  - Add runtime assertions for:
    1. `GET /api/locations/search?q=Jaipur` returns `200` with Indian coordinates.
    2. `GET /api/aqi?lat=26.9124&lon=75.7873` returns `200` with `cpcbAqi ∈ [0, 500]`, `dataSource`, and `fetchedAt`.
    3. `GET /api/aqi?lat=51.5&lon=-0.1` (outside India) returns `400`.
    4. `POST /api/plan` includes `< 30 ug/m3` indoor target citation and honest purifier-vs-plants science citation.
- **Repo Hygiene:** Zero new heavy dependencies (zero new npm packages required); total repo stays well under `10 MB`.

---

## Top Security & Edge-Case Risks for Etta Carbon to Stress-Test

1. **Cache-Busting DoS on `/api/aqi` & `/api/locations/search`:** Even with `0.01°` quantization, India spans `~31° × 29.5°` (~9.1M grid cells). An attacker sweeping coordinates could evict legitimate city entries from the 100-entry `aqCache`. Should we partition `aqCache` (curated presets vs. ad-hoc coordinates) or coarsen quantization to `0.05°` (~5.5 km)?
2. **Upstream Geocoding XSS / Injection:** Open-Meteo Geocoding returns free-text `name` and `admin1` fields. Although React escapes JSX text, raw strings echoed into `sourceLabel`, `rwaNotice`, or Gemini prompts could inject prompt-control tokens. Must strip control chars and enforce `SAFE_CITY_RE` on upstream geocoding responses.
3. **URL-Encoding / Unicode Homoglyph Bypass on `q`:** NFKC normalization must run *before* `URL_LIKE_RE` and `SAFE_CITY_RE` checks on `q` and custom location `name`.
4. **CPCB Breakpoint Edge Cases:** Fractional PM2.5 values (e.g., `30.5`, `250.4`), `NaN`/`Infinity`, or extreme dust storms (`PM10 > 600`) must never produce `NaN`, negative AQI, or values `> 500`.
5. **Offline Fallback for Custom Coordinates:** If Open-Meteo times out on `GET /api/aqi?lat=26.91&lon=75.79` (Jaipur), there is no curated preset for every town. Nearest-neighbor fallback to the closest `CityPreset` (Haversine distance) with `dataSource: 'city_preset'` is safer than returning `502` or hardcoded Delhi numbers.
6. **`exactOptionalPropertyTypes: true` Drift:** Adding optional fields (`observedAt`, `customLocation`, `cpcbAqi`) across Zod v4 schemas and TypeScript interfaces can easily trigger `TS2375` if `undefined` is passed explicitly. Every mapper must use conditional spread.
7. **Geolocation Privacy & Permission UX:** Browser coordinates must never be persisted to `localStorage` or logged on the server; `navigator.geolocation` failures on HTTP/headless browsers must degrade silently without breaking keyboard focus.
