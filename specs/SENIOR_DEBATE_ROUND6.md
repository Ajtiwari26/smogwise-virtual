# Senior Debate Round 6 — Locked Reconciliation & Worker Specs (Gemini 4 Neon × Etta Carbon)

Status: **LOCKED FOR EXECUTION** | Constraints: Strict TypeScript (`exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, zero `any`), ESLint (`complexity <= 10`, `max-len <= 100`, `max-lines-per-function <= 80`), WCAG 2.1 AA, repo `< 10 MB`, zero new npm packages.

---

## 1. Point-by-Point Reconciliation of All 9 Carbon Findings

### Finding 1 (BLOCKER): Express Query-Array Crash, `z.coerce` Bugs & Mutual Exclusivity
- **Resolution:** Validate all `req.query` fields with strict primitive `z.string()` schemas *before* calling `.normalize()`, `.trim()`, or numeric transforms—rejecting Express `qs` arrays (`?q[]=a&q[]=b`, `?lat=1&lat=2`) and nested objects with HTTP `400`.
- **No bare `z.coerce.number()`:** Use:
  ```ts
  const StrictCoordSchema = z
    .string()
    .trim()
    .regex(/^-?\d{1,3}(?:\.\d{1,6})?$/)
    .transform(Number)
    .pipe(z.number().finite());
  ```
- **Mutual Exclusivity on `GET /api/aqi`:**
  - If `city` is present AND (`lat` or `lon` is present) -> HTTP `400` `{ error: 'INVALID_QUERY', message: 'Provide either city or lat/lon, not both.' }`.
  - If only one of `lat` or `lon` is present -> HTTP `400` `{ error: 'INVALID_QUERY', message: 'Both lat and lon are required for coordinate lookup.' }`.
  - If `lat` and `lon` are present -> enforce India bounds `lat ∈ [6.5, 37.5]`, `lon ∈ [68.0, 97.5]`, else HTTP `400`.

### Finding 2 (BLOCKER): Indirect Prompt Injection & Citation Key Sync
- **Resolution:**
  - Lock `SAFE_CITY_RE = /^[\p{L}\p{N} .\-()]{1,64}$/u` evaluated *after* `input.normalize('NFKC').trim()`.
  - Strip any embedded citation-like tags `\[(?:CALC|SCI|AQ|POLICY|PRESET):[^\]]*\]` from external `name`, `state`, and `admin1` strings.
  - Add `escapeXml(value: string): string` in `server/middleware/promptGuard.ts` escaping `&`, `<`, `>`, `"`, `'`.
  - In `server/services/genaiService.ts`, never interpolate `customLocation.name` or `state` into system instructions; pass only escaped values inside `<location_context name="..." state="..." />`.
  - Sync allowed citation keys in `genaiService.ts` with `impactService.ts`: `CALC:DOSE_BEFORE`, `CALC:DOSE_AFTER`, `CALC:INDOOR_PM25`, `CALC:INDOOR_TARGET`, `CALC:CO2E_SAVED`, `CALC:INR_DELTA`, `AQ:SOURCE`, `SCI:PLANTS_VS_HEPA`.

### Finding 3 (HIGH): Open-Meteo Timezone & `observedAt` IST Normalization
- **Resolution:**
  - Hardcode `timezone=Asia%2FKolkata` in `buildOpenMeteoUrl()`.
  - Add `normalizeObservedAt(raw?: string): string | undefined` in `server/services/openMeteoClient.ts`: if `raw` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/`, append `:00+05:30`; if it lacks `Z` or `[+-]\d{2}:\d{2}`, append `+05:30`; validate with `Number.isFinite(Date.parse(normalized))`, returning `undefined` on invalid timestamps.
  - Format in `SmogAlertBanner.tsx` deterministically with `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })` + `' IST'`.

### Finding 4 (HIGH): `<= 50 km` Haversine Fallback Cap & Clean `503 LIVE_AQ_UNAVAILABLE`
- **Resolution:**
  - On custom-coordinate Open-Meteo failure/timeout, compute Haversine distance to curated Indian `CITY_PRESETS` (excluding non-Indian presets like `lahore_gulberg`, `salt_lake_city`).
  - If `nearest.distanceKm <= 50`: return `dataSource: 'city_preset'` with explicit proxy disclosure `sourceLabel: "Nearest station fallback: ${nearest.preset.name} (${Math.round(nearest.distanceKm)} km away)"`, `fallbackStationName: nearest.preset.name`, and `fallbackDistanceKm: Math.round(nearest.distanceKm * 10) / 10`.
  - If `nearest.distanceKm > 50`: throw `LiveAqUnavailableError` mapped in `apiRoutes.ts` to HTTP `503` `{ error: 'LIVE_AQ_UNAVAILABLE', message: 'Live air quality data is temporarily unavailable for this location. Select a major city preset or retry.' }`.
  - `apiClient.ts` throws a typed `ApiError` carrying `status` and `code` (`'LIVE_AQ_UNAVAILABLE'`); `useSmogPlan.ts` catches it cleanly, preserves the last valid plan, and surfaces an accessible inline banner without crashing.

### Finding 5 (HIGH): Partitioned Caches (`0.05°` Grid) & No Error Caching
- **Resolution:**
  - Partition `openMeteoClient.ts` caches:
    - `presetAqCache = createLruCache<AirQualityLookupResult>(32, 15 * 60 * 1000)` (curated presets only; never evicted by custom coords).
    - `customAqCache = createLruCache<AirQualityLookupResult>(128, 15 * 60 * 1000)` keyed on `0.05°` quantized coordinates (`Math.round(val * 20) / 20`, ~5.5 km grid).
  - Never write fallback/error/timeout results into `customAqCache` or `geoCache`.
  - Key `geoCache` (`maxSize: 200`, 24 h TTL) on `q.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')`.

### Finding 6 (HIGH): CPCB NAQI Breakpoint Continuity & Null/NaN Pollutant Guard
- **Resolution:**
  - Use continuous `BP_LO` (`0, 30, 60, 90, 120, 250` for PM2.5; `0, 50, 100, 250, 350, 430` for PM10; `0, 40, 80, 180, 280, 400` for NO2) with `I_LO = 0, 51, 101, 201, 301, 401` and clamp each band to `Math.max(band.iLo, Math.min(band.iHi, Math.round(raw)))`.
  - Compute sub-indices only for finite non-negative pollutants (`Number.isFinite(v) && v >= 0`); require finite `pm25`; clamp aggregate to `[0, 500]`.

### Finding 7 (MED): `redirect: 'error'` & Zero-Result Geocoding Schema
- **Resolution:**
  - Pass `redirect: 'error'` on all `fetch()` calls in `openMeteoClient.ts` and `geocodingClient.ts`.
  - Parse geocoding payloads with `z.object({ results: z.array(GeocodingRawItemSchema).optional().default([]) })` and return HTTP `200 { results: [] }` on zero matches.

### Finding 8 (MED): WAI-ARIA 1.2 Combobox & Geolocation Focus Safety
- **Resolution:**
  - Implement `src/components/LocationSearchCombobox.tsx` with `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `role="listbox"`, `role="option"`, `aria-selected`, and keyboard handlers (`ArrowDown`, `ArrowUp`, `Enter`, `Escape`).
  - Keep geolocation button mounted with `aria-busy={isLocating}` and announce status/errors in `role="status" aria-live="polite"`.

### Finding 9 (MED): ESLint Decomposition & `exactOptionalPropertyTypes: true`
- **Resolution:**
  - Extract `LocationSearchCombobox.tsx` and `ScenarioPresetBar.tsx` from `PersonaForm.tsx` so every function stays `<= 80` lines, `complexity <= 10`, `max-len <= 100`.
  - Use conditional spreads `...(x !== undefined ? { x } : {})` everywhere optional properties are constructed.

---

## 2. Locked TypeScript Signatures & API Contracts

### 2.1 Domain Contracts (`src/domain/types.ts`)
```ts
export type DominantPollutant = 'PM2.5' | 'PM10' | 'NO2';

export interface CustomLocation {
  readonly name: string;
  readonly state?: string;
  readonly lat: number;
  readonly lon: number;
}

export interface LocationSearchItem {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly lat: number;
  readonly lon: number;
}

export interface LiveAqOverride {
  readonly pm25: number;
  readonly pm10?: number;
  readonly no2?: number;
  readonly sourceLabel?: string;
  readonly observedAt?: string;
  readonly cpcbAqi?: number;
  readonly dominantPollutant?: DominantPollutant;
  readonly fallbackStationName?: string;
  readonly fallbackDistanceKm?: number;
}

// Added to UserProfile:
// readonly customLocation?: CustomLocation;

// Added to DeterministicReport:
// readonly cpcbAqi: number;
// readonly aqiBand: AqiBandId;
// readonly dominantPollutant: DominantPollutant;
// readonly observedAt?: string;
// readonly fallbackStationName?: string;
// readonly fallbackDistanceKm?: number;
```

### 2.2 CPCB Engine (`src/domain/cpcbAqi.ts`)
```ts
export interface CpcbAqiResult {
  readonly aqi: number;
  readonly band: AqiBandId;
  readonly dominantPollutant: DominantPollutant;
}

export function computeCpcbAqi(
  pm25: number,
  pm10?: number,
  no2?: number,
): CpcbAqiResult;

export function mapCpcbAqiToBand(aqi: number): AqiBandId;
```

### 2.3 Sample Scenarios (`src/domain/sampleScenarios.ts`)
```ts
export interface SampleScenario {
  readonly id: string;
  readonly labelEn: string;
  readonly labelHi: string;
  readonly profile: UserProfile;
}

export const SAMPLE_SCENARIOS: readonly SampleScenario[];
```

### 2.4 Server & HTTP Contracts
- `GET /api/locations/search?q=<2..64 chars>` -> `200 { results: readonly LocationSearchItem[] }` | `400 { error: 'INVALID_QUERY', message: string }`
- `GET /api/aqi?city=<id>` OR `GET /api/aqi?lat=<6.5..37.5>&lon=<68.0..97.5>&name=<opt>&state=<opt>` ->
  - `200 AirQualityLookupResult` (includes `city`, `dataSource`, `cpcbAqi`, `aqiBand`, `dominantPollutant`, `fetchedAt`, `cached`, plus optional `liveAq`, `observedAt`, `fallbackStationName`, `fallbackDistanceKm`)
  - `400 { error: 'INVALID_QUERY', message: string }`
  - `503 { error: 'LIVE_AQ_UNAVAILABLE', message: string }`
- `POST /api/plan`, `POST /api/what-if`, `POST /api/ai/ask`: accept optional `customLocation` on `UserProfile`; when `customLocation` is provided, resolve live AQ via `fetchAirQualityForCoords()` and propagate `503 LIVE_AQ_UNAVAILABLE` if outside 50 km fallback radius while offline.

---

## 3. Non-Overlapping Worker Specs

### W6-1 — Tier 1 Domain (`src/domain/*`)
- **Owned Files:** `src/domain/types.ts`, `src/domain/cpcbAqi.ts` (new), `src/domain/sampleScenarios.ts` (new), `src/domain/impactService.ts`, `src/domain/i18n.ts`.
- **Deliverables:**
  1. Extend `types.ts` with `DominantPollutant`, `CustomLocation`, `LocationSearchItem`, and optional fields on `LiveAqOverride`, `UserProfile`, `DeterministicReport`.
  2. Implement `cpcbAqi.ts` per Finding 6 (continuous `BP_LO`, finite non-negative filter, `[0, 500]` clamp).
  3. Implement `sampleScenarios.ts` with 4 scenarios (`delhi_anand_vihar`, `lucknow_gomtinagar` HI, `gurugram_dlf` RWA 180 flats, `patna_boring_road` biomass chulha).
  4. Update `impactService.ts` to populate `cpcbAqi`, `aqiBand`, `dominantPollutant`, optional `observedAt`/`fallbackStationName`/`fallbackDistanceKm`, `CALC:INDOOR_TARGET` (`< 30 ug/m3`), and `SCI:PLANTS_VS_HEPA`.
  5. Sharpen `i18n.ts` daily routine blocks (indoor `< 30 ug/m3` target gap, kids outdoor play gate, senior morning caution, trip chaining, honest purifier vs. plants advisory) in EN & HI.

### W6-2 — Tier 2 Server (`server/*`)
- **Owned Files:** `server/middleware/promptGuard.ts`, `server/middleware/security.ts`, `server/services/geocodingClient.ts` (new), `server/services/openMeteoClient.ts`, `server/services/genaiService.ts`, `server/routes/apiRoutes.ts`.
- **Deliverables:**
  1. `promptGuard.ts`: strict primitive `LocationSearchQuerySchema`, `AqiQuerySchema` (mutual exclusivity + `StrictCoordSchema` + India bounds), `CustomLocationSchema` on `UserProfileSchema`, `SAFE_CITY_RE`, `sanitizeLocationText()`, and `escapeXml()`.
  2. `security.ts`: add `geoLimiter` (`60 req / 15 min`).
  3. `geocodingClient.ts`: allowlisted Open-Meteo Geocoding (`redirect: 'error'`, `3500 ms` timeout, optional `results` default `[]`, canonicalized `geoCache`, no error caching, curated `CITY_PRESETS` fallback on offline).
  4. `openMeteoClient.ts`: partitioned `presetAqCache` (32) vs `customAqCache` (128, `0.05°` grid), `timezone=Asia%2FKolkata`, `normalizeObservedAt()`, `redirect: 'error'`, `<= 50 km` Haversine fallback cap + `LiveAqUnavailableError`, `computeCpcbAqi()` integration.
  5. `genaiService.ts`: XML-escaped `<location_context>` and synced citation key allowlist (`CALC:INDOOR_TARGET`, `SCI:PLANTS_VS_HEPA`).
  6. `apiRoutes.ts`: wire `GET /api/locations/search`, upgraded `GET /api/aqi`, and `customLocation` support on `/api/plan`, `/api/what-if`, `/api/ai/ask` with clean `503 LIVE_AQ_UNAVAILABLE` handling.

### W6-3 — Frontend UI (`src/components/*`, `src/services/apiClient.ts`, `src/hooks/useSmogPlan.ts`)
- **Owned Files:** `src/services/apiClient.ts`, `src/hooks/useSmogPlan.ts`, `src/components/LocationSearchCombobox.tsx` (new), `src/components/ScenarioPresetBar.tsx` (new), `src/components/SmogAlertBanner.tsx`, `src/components/DailyRoutineTimeline.tsx`, `src/components/PersonaForm.tsx`.
- **Deliverables:**
  1. `apiClient.ts`: add `searchLocations(q, signal)` and `fetchAqiByCoords(lat, lon, name?, state?, signal?)`; throw typed `ApiError` preserving HTTP `503` + `LIVE_AQ_UNAVAILABLE`.
  2. `useSmogPlan.ts`: support `customLocation`, scenario preset selection, and non-crashing `503` error banner state.
  3. `LocationSearchCombobox.tsx`: WAI-ARIA 1.2 combobox (`350 ms` debounce, `AbortController`, keyboard nav) + `"Use My Location"` button (`aria-busy`, polite `role="status"`).
  4. `ScenarioPresetBar.tsx`: 4 accessible `<button type="button">` scenario chips.
  5. `SmogAlertBanner.tsx`: display CPCB AQI pill (`0–500`), dominant pollutant, `Live Open-Meteo` vs `Curated Winter Preset` badge, proxy station disclosure if present, and IST-formatted `observedAt`.
  6. `DailyRoutineTimeline.tsx` & `PersonaForm.tsx`: render `< 30 ug/m3` indoor target status, honest purifier vs. plants note, and compose extracted components under ESLint limits.

### W6-4 — Tests, README & Evaluator (`tests/*`, `README.md`, `testscript/evaluator/analyzers/*`)
- **Owned Files:** `tests/cpcbAqi.test.ts` (new), `tests/apiLocations.test.ts` (new), `README.md`, `testscript/evaluator/analyzers/alignmentRuntimeAnalyzer.ts`, `testscript/evaluator/analyzers/securityAnalyzer.ts`.
- **Deliverables:**
  1. Unit tests for CPCB breakpoints, `NaN`/null pollutant handling, `<= 50 km` Haversine fallback vs `503`, query-array rejection, mutual exclusivity, and XML escaping.
  2. Update `README.md` with Pan-India search, geolocation, CPCB NAQI formula, 4 scenarios, and security architecture.
  3. Update `alignmentRuntimeAnalyzer.ts` & `securityAnalyzer.ts` (helpers `<= 35` lines, complexity `<= 6`, `<= 95` chars/line) to verify `/api/locations/search`, `/api/aqi` India bounds & `cpcbAqi`, and `CALC:INDOOR_TARGET` / `SCI:PLANTS_VS_HEPA` citations.
  4. Final gate: `npm run typecheck && npm run lint && npm test && npm run build`.
