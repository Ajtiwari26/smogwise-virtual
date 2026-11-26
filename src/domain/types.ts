/**
 * Core domain contracts for SmogWise Virtual Tier 1 deterministic engine.
 * Zero React, DOM, Node, or network dependencies.
 */

/** Supported UI and advisory output languages. */
export type LanguageCode = 'en' | 'hi';

/** Target user persona archetypes. */
export type PersonaType =
  | 'young_family'
  | 'sensitive_household'
  | 'rwa_coordinator'
  | 'office_commuter'
  | 'outdoor_student';

/** Daily commute mode options. */
export type CommuteMode =
  | 'petrol_car'
  | 'two_wheeler'
  | 'metro_bus'
  | 'carpool'
  | 'wfh_walk';

/** Primary household cooking fuel types. */
export type CookingFuel = 'lpg' | 'induction' | 'biomass_chulha';

/** Supported indoor air quality and personal protection interventions. */
export type IAQHackId =
  | 'window_sealing'
  | 'wet_mopping'
  | 'ventilation_window'
  | 'corsi_rosenthal_box'
  | 'hepa_purifier'
  | 'n95_mask';

/** Graded Response Action Plan (GRAP) winter smog severity stage. */
export type GRAPStage = 'NONE' | 'GRAP_I' | 'GRAP_II' | 'GRAP_III' | 'GRAP_IV';

/** CPCB Air Quality Index category band. */
export type AqiBandId = 'good' | 'satisfactory' | 'moderate' | 'poor' | 'very_poor' | 'severe';

/** Dominant CPCB NAQI sub-index pollutant. */
export type DominantPollutant = 'PM2.5' | 'PM10' | 'NO2';

/** User-selected custom Indian city or GPS coordinate location. */
export interface CustomLocation {
  readonly name: string;
  readonly state?: string;
  readonly lat: number;
  readonly lon: number;
}

/** Geocoded Indian location candidate returned by /api/locations/search. */
export interface LocationSearchItem {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly lat: number;
  readonly lon: number;
}

/** Curated city air-quality preset for offline-resilient winter smog modeling. */
export interface CityPreset {
  readonly id: string;
  readonly name: string;
  readonly nameHi: string;
  readonly state: string;
  readonly lat: number;
  readonly lon: number;
  readonly baselinePm25: number;
  readonly baselinePm10: number;
  readonly baselineNo2: number;
  readonly grapStage: GRAPStage;
}

/** Optional live air-quality override fetched from Open-Meteo or equivalent API. */
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

/** Household profile input for deterministic exposure and emissions calculations. */
export interface UserProfile {
  readonly persona: PersonaType;
  readonly cityId: string;
  readonly customLocation?: CustomLocation;
  readonly language: LanguageCode;
  readonly householdSize: number;
  readonly hasVulnerableMember: boolean;
  readonly monthlyBudgetInr: number;
  readonly roomVolumeM3: number;
  readonly commuteMode: CommuteMode;
  readonly commuteDistanceKm: number;
  readonly cookingFuel: CookingFuel;
  readonly activeHacks: readonly IAQHackId[];
  readonly rwaHouseholds?: number;
  readonly rwaAdoptionRate?: number;
}

/** Single hourly point in the 24-hour diurnal inversion and indoor exposure curve. */
export interface HourlyExposurePoint {
  readonly hour: number;
  readonly label: string;
  readonly outdoorPm25: number;
  readonly baselineIndoorPm25: number;
  readonly optimizedIndoorPm25: number;
  readonly baselineDoseUg: number;
  readonly optimizedDoseUg: number;
  readonly isOptimalVentilation: boolean;
}

/** Aggregated daily exposure and indoor PM2.5 metrics. */
export interface ExposureMetrics {
  readonly baselineInhaledUgPerDay: number;
  readonly optimizedInhaledUgPerDay: number;
  readonly doseReductionUgPerDay: number;
  readonly doseReductionPercent: number;
  readonly baselineIndoorPm25: number;
  readonly optimizedIndoorPm25: number;
  readonly optimalVentilationWindow: string;
  readonly hourlySeries?: readonly HourlyExposurePoint[];
}

/** Household and RWA community emissions avoidance and monthly INR savings. */
export interface EmissionsMetrics {
  readonly co2eAvoidedGramsPerDay: number;
  readonly pm25AvoidedMgPerDay: number;
  readonly monthlyNetSavingsInr: number;
  readonly communityCo2eAvoidedKgPerMonth: number;
  readonly communityPm25AvoidedGramsPerMonth: number;
}

/** Deterministic Tier 1 report with stable citation keys. */
export interface DeterministicReport {
  readonly city: CityPreset;
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly cpcbAqi: number;
  readonly aqiBand: AqiBandId;
  readonly dominantPollutant: DominantPollutant;
  readonly livePm10?: number;
  readonly liveNo2?: number;
  readonly observedAt?: string;
  readonly fallbackStationName?: string;
  readonly fallbackDistanceKm?: number;
  readonly exposure: ExposureMetrics;
  readonly emissions: EmissionsMetrics;
  readonly recommendedHacks: readonly IAQHackId[];
  readonly citations: Readonly<Record<string, string>>;
}

/** Actionable time-of-day block in the low-emission daily routine. */
export interface DailyRoutineBlock {
  readonly id: string;
  readonly timeRange: string;
  readonly title: string;
  readonly description: string;
  readonly outdoorPm25: number;
  readonly indoorPm25: number;
  readonly category: 'commute' | 'ventilation' | 'cooking' | 'sleep' | 'protection';
}

/** Localized detail card for an IAQ intervention ranked by budget. */
export interface IAQHackDetail {
  readonly id: IAQHackId;
  readonly name: string;
  readonly nameHi: string;
  readonly instructions: string;
  readonly instructionsHi: string;
  readonly monthlyCostInr: number;
  readonly doseImpactLabel: string;
  readonly withinBudget: boolean;
  readonly isActive: boolean;
}

/** Quantitative delta between baseline and alternative what-if scenarios. */
export interface WhatIfDelta {
  readonly doseReductionUgPerDay: number;
  readonly co2eAvoidedGramsPerDay: number;
  readonly pm25AvoidedMgPerDay: number;
  readonly monthlyNetSavingsInr: number;
}

/** Complete result for a two-choice what-if comparison. */
export interface WhatIfComparisonResult {
  readonly baseline: DeterministicReport;
  readonly alternative: DeterministicReport;
  readonly delta: WhatIfDelta;
  readonly explanation: { readonly en: string; readonly hi: string };
  readonly citations: Readonly<Record<string, string>>;
}

/** Full localized plan returned by computeFullPlan and POST /api/plan. */
export interface FullPlanOutput {
  readonly report: DeterministicReport;
  readonly routine: readonly DailyRoutineBlock[];
  readonly iaqHacks: readonly IAQHackDetail[];
  readonly localizedSummary: string;
  readonly rwaNotice: string;
  readonly citations: Readonly<Record<string, string>>;
}
