# SmogWise Virtual — System Design & Architecture

## 1. Vertical, Scope & Persona Logic

**Chosen Vertical:** Urban Families & Neighborhood Communities Navigating Severe Winter Smog (India-first: Delhi NCR, Indo-Gangetic Plain, and Tier-1/Tier-2 winter inversion zones).

### Target Personas
| Persona | Context | Primary Pain Points | Key Outputs |
| :--- | :--- | :--- | :--- |
| **Young Family** | Parents + school-going child (5–12 yrs), 2BHK apartment, mixed commute | School drop-off during morning inversion, indoor cooking PM spikes, high HEPA filter cost | Low-emission daily schedule, Corsi-Rosenthal / sealed-room IAQ hacks, child inhaled $\mu\text{g/day}$ reduction |
| **Sensitive Household** | Elderly (65+) or asthmatic/COPD member, limited mobility, ₹1,500–₹3,000 monthly budget | Severe breathlessness during GRAP-III/IV, conflicting advice, medication/exposure timing | Zero/low-cost sealing & ventilation windows, N95 fit & filtration impact, plain-language Hindi/English alerts |
| **RWA / Community Coordinator** | Resident Welfare Association managing 50–250 flats | Resident apathy, basement DG set exhaust, guardroom biomass burning, uncoordinated school runs | Quantified community multiplier ($\text{kg CO}_2\text{e}$ & $\text{g PM}_{2.5}$ avoided), actionable RWA notice template |

### Design Principles
- **Determinism before Generation:** Every number (inhaled dose, indoor $\text{PM}_{2.5}$, $\text{CO}_2\text{e}$ avoided, ₹ saved) is computed by a pure TypeScript physics/emissions engine (Tier 1). The LLM (Tier 2) never invents statistics; it explains, personalizes, and cites Tier 1 outputs.
- **Offline-Resilient & Free-Tier Safe:** Works identically with live Open-Meteo Air Quality API data + Gemini API, or with curated city presets + deterministic grounded fallback when keys or network are unavailable.
- **Zero-Bloat Footprint:** Monorepo strictly `< 10 MB` (excluding `node_modules`), single `main` branch, minimal vetted dependencies.

---

## 2. Two-Tier Hybrid Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        React 19 + Tailwind CSS UI                       │
│  (WCAG 2.1 AA · Hindi/English Toggle · Preset Profiles · Live Sliders)  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼ (Client-side instant recalculation)           ▼ (POST /api/plan, /api/plan/briefing, /api/what-if, /api/ai/ask)
┌───────────────────────────────────┐   ┌─────────────────────────────────┐
│  Tier 1: Deterministic Engine     │   │  Express 5 + Helmet + Zod API   │
│  (src/domain/* — pure TS)         │   │  (server/ & api/index.ts)       │
│  • Diurnal Inversion C_out(h)     │   └───────────────┬─────────────────┘
│  • Single-Zone Mass Balance C_in  │                   │
│  • Activity Inhaled Dose D_day    │         ┌─────────┴─────────┐
│  • Commute/Cooking/RWA Savings    │         ▼                   ▼
└───────────────────────────────────┘   ┌───────────┐       ┌───────────┐
                                        │ Tier 2 AI │       │ Offline   │
                                        │ @google/  │──────▶│ Grounded  │
                                        │ genai     │(fall- │ Fallback  │
                                        │ gemini-4- │ back) │ Engine    │
                                        │ hydrogen  │       └───────────┘
                                        └───────────┘
```

### Tier 1: Deterministic Physics & Emissions Engine (`src/domain/*`)
All domain modules are pure TypeScript functions with zero React, DOM, Node, or network dependencies:

1. **Diurnal Boundary-Layer Inversion Model $C_{\text{out}}(h)$:**
   - Models winter radiative cooling and shallow morning boundary layer across 24 hours ($h \in [0, 23]$).
   - Early-morning inversion peak ($06:00\text{–}09:00$) elevates ambient $\text{PM}_{2.5}$ up to $1.35 \times C_{\text{base}}$, while afternoon convective mixing ($13:00\text{–}16:00$) depresses ambient levels to $0.68 \times C_{\text{base}}$, identifying the optimal daily natural ventilation window.
2. **Single-Zone Indoor Mass-Balance Model $C_{\text{in}}(h)$:**
   $$C_{\text{in}}(h) = \frac{P \cdot \text{ACH}(h) \cdot C_{\text{out}}(h) + \frac{E_{\text{cook}}(h)}{V}}{\text{ACH}(h) + k_{\text{dep}} + \frac{\text{CADR}_{\text{eff}}}{V}}$$
   - $P$: penetration factor ($0.85$ unsealed, reduced to $0.55$ with `window_sealing`).
   - $\text{ACH}(h)$: air changes per hour ($1.2\,\text{h}^{-1}$ baseline; drops to $0.45\,\text{h}^{-1}$ when sealed; spikes to $3.0\,\text{h}^{-1}$ during scheduled afternoon `ventilation_window`).
   - $E_{\text{cook}}(h)$: indoor cooking emission rate ($\mu\text{g/h}$) during morning ($07:00\text{–}08:00$) and evening ($19:00\text{–}20:00$) meal windows (`biomass_chulha` $\gg$ `lpg` $>$ `induction`).
   - $V$: room volume ($\text{m}^3$).
   - $k_{\text{dep}}$: gravitational surface deposition rate ($0.25\,\text{h}^{-1}$ baseline; $0.40\,\text{h}^{-1}$ with daily `wet_mopping`).
   - $\text{CADR}_{\text{eff}}$: clean air delivery rate ($300\,\text{m}^3/\text{h}$ for DIY `corsi_rosenthal_box`; $350\,\text{m}^3/\text{h}$ for `hepa_purifier`).
3. **Activity-Weighted Inhaled Dose $D_{\text{day}}$ ($\mu\text{g/day}$):**
   $$D_{\text{day}} = \sum_{h=0}^{23} C_{\text{loc}}(h) \cdot (1 - \eta_{\text{mask}}(h)) \cdot \text{IR}(h)$$
   - Combines hourly microenvironment concentration $C_{\text{loc}}(h)$ (indoor $C_{\text{in}}(h)$ vs. outdoor $C_{\text{out}}(h)$ during commute/school run), fitted N95 filtration efficiency ($\eta_{\text{mask}} = 0.85$ outdoors when `n95_mask` is active), and activity-adjusted inhalation rates $\text{IR}(h)$ (sleep $0.45\,\text{m}^3/\text{h}$, resting indoor $0.65\,\text{m}^3/\text{h}$, active commute $1.40\,\text{m}^3/\text{h}$).
4. **Commute, Cooking & RWA Emissions + INR Savings:**
   - Computes daily $\text{CO}_2\text{e}$ avoided ($\text{g/day}$) and tailpipe/cookstove $\text{PM}_{2.5}$ avoided ($\text{mg/day}$) against high-emission baselines (`petrol_car` and `lpg` / `biomass_chulha`), plus monthly net INR savings (`monthlyNetSavingsInr`) subtracting amortized intervention costs.
   - Scales household impact across `rwaHouseholds` $\times$ `rwaAdoptionRate` for community-wide $\text{kg CO}_2\text{e/month}$ and $\text{g PM}_{2.5}/\text{month}$ avoided.

### Tier 2: Grounded `@google/genai` Interactions API & Offline Fallback
- **Primary LLM Integration:** Uses `@google/genai` (`>=3.5.0`) `ai.interactions.create({ model: 'gemini-4-hydrogen', ... })` with strict system instructions binding the model exclusively to the verified `DeterministicReport` JSON payload.
- **Prompt Injection Defense:** User questions are sanitized and wrapped inside structural `<user_query>` delimiters while system rules explicitly prohibit overriding deterministic metrics or emitting ungrounded health/emission numbers.
- **Deterministic Offline Fallback & Briefing (`POST /api/plan/briefing`):** Whenever `GEMINI_API_KEY` is absent, empty, or an upstream call times out/fails, `server/services/genaiService.ts` deterministically synthesizes localized English (`en`) or Hindi (`hi`) guidance and `AiPlanBriefingCard` briefings citing exact Tier 1 metrics (`doseReductionUgPerDay`, `optimalVentilationWindow`, `monthlyNetSavingsInr`, `communityCo2eAvoidedKgPerMonth`), backed by a bounded LRU cache.

---

## 3. Security, Privacy & Accessibility (WCAG 2.1 AA)

### Security & API Hardening
- **HTTP Headers & CORS:** `helmet` (`^8.1.0`) sets strict CSP, `X-Content-Type-Options: nosniff`, `Permissions-Policy: geolocation=(self)`, `Referrer-Policy: no-referrer`, COOP/CORP headers, and frame protections; `cors` restricts origins to `ALLOWED_ORIGIN`.
- **Payload & Prototype-Pollution Guard (`bodyGuard`):** Enforces a 16 KB JSON body limit alongside own-property prototype-pollution checks (`__proto__`, `constructor`, `prototype`) and a maximum nesting depth of 8.
- **Caching & Upstream Coalescing:** Applies a `Cache-Control` split (`public, max-age=300` for preset city AQ vs `private, no-store` for coordinate queries, plans, briefings, and Q&A) and bounded singleflight deduplication (`MAX_INFLIGHT = 100`) to prevent upstream stampedes.
- **Rate Limiting:** Isolated route-group rate limiting caps `/api/*` requests (`60 req / 15 min` per IP) to prevent abuse and protect free-tier quotas (note: on Vercel serverless deployments, in-memory rate-limit counters are per-instance and reset across cold starts).
- **Strict Input Validation & Dependency Hygiene:** All incoming payloads are validated with `zod` (`^4.6.7`) returning sanitized errors before reaching domain or AI handlers, paired with 0-CVE npm dependencies.
- **Zero Secret Exposure:** API keys live strictly in server environment variables (`.env`), never bundled into `VITE_*` client assets.
- **Zero PII Storage:** Stateless architecture with no database or user tracking.

### Accessibility & Quality Gates (WCAG 2.1 AA)
- Semantic landmarks (`<header>`, `<main>`, `<nav>`, `<section>`, `<footer>`), skip-to-content link, and a bilingual `ErrorBoundary` fallback.
- Screen-reader-accessible `sr-only` semantic `<table>` inside `ImpactDashboard` mirroring the SVG chart metrics, plus `<fieldset>`/`<legend>` groupings and `aria-invalid`/`aria-describedby` wiring.
- Full keyboard navigability with visible focus rings (`focus-visible:ring-2`) and `aria-live="polite"` announcements for live metric updates and advisor responses.
- Minimum `4.5:1` foreground/background contrast across air-quality severity badges and interactive controls, with `prefers-reduced-motion` support.
- Native `<label htmlFor>` associations on all form inputs, sliders, and language/persona toggles.
- Automated Vitest coverage gates enforcing `>=85%` statements, functions, and lines, and `>=75%` branches.
