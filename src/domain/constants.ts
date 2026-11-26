/**
 * Physical, emissions, CPCB AQI, and IAQ intervention constants for SmogWise Virtual.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import type { AqiBandId, CommuteMode, CookingFuel, IAQHackId } from './types.js';

/** Hourly diurnal winter boundary-layer inversion multipliers (00:00 to 23:00). */
export const DIURNAL_INVERSION_FACTORS: readonly number[] = [
  1.12, 1.15, 1.18, 1.22, 1.25, 1.3, 1.35, 1.35, 1.32, 1.24, 1.08, 0.92,
  0.78, 0.68, 0.68, 0.7, 0.74, 0.88, 1.04, 1.16, 1.22, 1.2, 1.16, 1.14,
];

/** Indoor particle penetration factor for unsealed apartments. */
export const PENETRATION_UNSEALED = 0.85;

/** Indoor particle penetration factor with window and door draught sealing. */
export const PENETRATION_SEALED = 0.55;

/** Baseline air changes per hour (h^-1) for typical urban Indian housing. */
export const ACH_BASELINE = 1.2;

/** Reduced air changes per hour (h^-1) when window sealing is active. */
export const ACH_SEALED = 0.45;

/** Elevated air changes per hour (h^-1) during scheduled afternoon ventilation. */
export const ACH_VENTILATION = 3.0;

/** Baseline gravitational surface deposition rate k_dep (h^-1). */
export const DEPOSITION_BASELINE = 0.25;

/** Enhanced deposition rate k_dep (h^-1) with daily wet mopping. */
export const DEPOSITION_WET_MOPPING = 0.4;

/** Clean air delivery rate (m^3/h) for a DIY Corsi-Rosenthal box. */
export const CADR_CORSI_ROSENTHAL_M3H = 300;

/** Clean air delivery rate (m^3/h) for a commercial HEPA purifier. */
export const CADR_HEPA_PURIFIER_M3H = 350;

/** Fitted N95 mask outdoor filtration efficiency (85%). */
export const N95_FILTRATION_EFFICIENCY = 0.85;

/** Sleep inhalation rate (m^3/h). */
export const INHALATION_SLEEP_M3H = 0.45;

/** Resting indoor inhalation rate (m^3/h). */
export const INHALATION_RESTING_M3H = 0.65;

/** Active outdoor commute inhalation rate (m^3/h). */
export const INHALATION_COMMUTE_M3H = 1.4;

/** Sensitivity multiplier for households with vulnerable members. */
export const VULNERABLE_INHALATION_MULTIPLIER = 1.15;

/** Minimum clamped room volume in cubic meters. */
export const MIN_ROOM_VOLUME_M3 = 12;

/** Maximum clamped room volume in cubic meters. */
export const MAX_ROOM_VOLUME_M3 = 500;

/** Hours of the day when morning and evening cooking typically occur. */
export const COOKING_HOURS: readonly number[] = [7, 8, 19, 20];

/** Hours of the day representing morning and evening commute peaks. */
export const COMMUTE_HOURS: readonly number[] = [8, 18];

/** Optimal afternoon convective mixing hours for natural ventilation. */
export const OPTIMAL_VENTILATION_HOURS: readonly number[] = [13, 14, 15];

/** Indoor cooking PM2.5 emission rates (ug/h) by fuel type. */
export const COOKING_EMISSION_UG_PER_HOUR: Readonly<Record<CookingFuel, number>> = {
  biomass_chulha: 18000,
  lpg: 2400,
  induction: 450,
};

/** Per-kilometer commute emission and operating cost factors. */
export interface CommuteEmissionFactor {
  readonly co2eGramsPerKm: number;
  readonly pm25MgPerKm: number;
  readonly costInrPerKm: number;
}

/** Commute emission factors (g CO2e/km, mg PM2.5/km, INR/km) by mode. */
export const COMMUTE_EMISSION_FACTORS: Readonly<Record<CommuteMode, CommuteEmissionFactor>> = {
  petrol_car: { co2eGramsPerKm: 192, pm25MgPerKm: 28, costInrPerKm: 9.5 },
  two_wheeler: { co2eGramsPerKm: 72, pm25MgPerKm: 18, costInrPerKm: 3.2 },
  carpool: { co2eGramsPerKm: 64, pm25MgPerKm: 9.5, costInrPerKm: 3.5 },
  metro_bus: { co2eGramsPerKm: 32, pm25MgPerKm: 4.5, costInrPerKm: 2.0 },
  wfh_walk: { co2eGramsPerKm: 0, pm25MgPerKm: 0, costInrPerKm: 0 },
};

/** Daily household cooking emissions and monthly fuel cost factors. */
export interface CookingEmissionFactor {
  readonly co2eGramsPerDay: number;
  readonly pm25MgPerDay: number;
  readonly monthlyCostInr: number;
}

/** Daily cooking emission and cost factors by fuel type. */
export const COOKING_DAILY_FACTORS: Readonly<Record<CookingFuel, CookingEmissionFactor>> = {
  biomass_chulha: { co2eGramsPerDay: 4200, pm25MgPerDay: 1200, monthlyCostInr: 450 },
  lpg: { co2eGramsPerDay: 1650, pm25MgPerDay: 45, monthlyCostInr: 1100 },
  induction: { co2eGramsPerDay: 920, pm25MgPerDay: 8, monthlyCostInr: 780 },
};

/** CPCB PM2.5 AQI band specification with bilingual labels. */
export interface AqiBandSpec {
  readonly id: AqiBandId;
  readonly maxPm25: number;
  readonly labelEn: string;
  readonly labelHi: string;
}

/** Official CPCB PM2.5 breakpoints and category labels. */
export const CPCB_AQI_BANDS: readonly AqiBandSpec[] = [
  { id: 'good', maxPm25: 30, labelEn: 'Good', labelHi: 'अच्छा' },
  { id: 'satisfactory', maxPm25: 60, labelEn: 'Satisfactory', labelHi: 'संतोषजनक' },
  { id: 'moderate', maxPm25: 90, labelEn: 'Moderate', labelHi: 'मध्यम' },
  { id: 'poor', maxPm25: 120, labelEn: 'Poor', labelHi: 'खराब' },
  { id: 'very_poor', maxPm25: 250, labelEn: 'Very Poor', labelHi: 'बहुत खराब' },
  { id: 'severe', maxPm25: Number.POSITIVE_INFINITY, labelEn: 'Severe', labelHi: 'गंभीर' },
];

/** Specification for a household IAQ or personal protection intervention. */
export interface IAQHackSpec {
  readonly id: IAQHackId;
  readonly monthlyCostInr: number;
  readonly doseImpactLabel: string;
  readonly doseImpactLabelHi: string;
  readonly name: string;
  readonly nameHi: string;
  readonly instructions: string;
  readonly instructionsHi: string;
}

/** Catalog of indoor air quality and personal protection interventions. */
export const IAQ_HACK_SPECS: Readonly<Record<IAQHackId, IAQHackSpec>> = {
  ventilation_window: {
    id: 'ventilation_window',
    monthlyCostInr: 0,
    doseImpactLabel: '10-18% lower indoor peak',
    doseImpactLabelHi: 'इनडोर पीक 10-18% कम',
    name: 'Afternoon Ventilation Window',
    nameHi: 'दोपहर वेंटिलेशन विंडो',
    instructions: 'Open cross-ventilation windows only between 1:00 PM and 4:00 PM.',
    instructionsHi: 'केवल दोपहर 1:00 से 4:00 बजे के बीच खिड़कियां खोलकर हवा बदलें।',
  },
  wet_mopping: {
    id: 'wet_mopping',
    monthlyCostInr: 0,
    doseImpactLabel: '8-15% less resuspended dust',
    doseImpactLabelHi: 'उड़ती धूल 8-15% कम',
    name: 'Daily Wet Mopping',
    nameHi: 'रोज़ गीला पोंछा',
    instructions: 'Replace dry sweeping with damp mopping to trap settled PM2.5.',
    instructionsHi: 'सूखी झाड़ू की जगह गीले पोंछे से धूल और PM2.5 को बैठने दें।',
  },
  window_sealing: {
    id: 'window_sealing',
    monthlyCostInr: 250,
    doseImpactLabel: '30-45% less smog infiltration',
    doseImpactLabelHi: 'स्मॉग प्रवेश 30-45% कम',
    name: 'Window & Door Draught Sealing',
    nameHi: 'खिड़की और दरवाज़े की सीलिंग',
    instructions: 'Apply foam weather-stripping tape around balcony doors and frames.',
    instructionsHi: 'बालकनी के दरवाज़ों और खिड़कियों की दरारों पर फोम टेप लगाएं।',
  },
  n95_mask: {
    id: 'n95_mask',
    monthlyCostInr: 450,
    doseImpactLabel: '85% outdoor commute filtration',
    doseImpactLabelHi: 'बाहरी यात्रा में 85% सुरक्षा',
    name: 'Fitted N95 Respirator',
    nameHi: 'फिटेड N95 मास्क',
    instructions: 'Wear a snug N95 mask during morning and evening outdoor travel.',
    instructionsHi: 'सुबह और शाम बाहर जाते समय चेहरे पर कसकर N95 मास्क पहनें।',
  },
  corsi_rosenthal_box: {
    id: 'corsi_rosenthal_box',
    monthlyCostInr: 950,
    doseImpactLabel: '55-70% indoor PM2.5 drop',
    doseImpactLabelHi: 'इनडोर PM2.5 55-70% कम',
    name: 'DIY Corsi-Rosenthal Box',
    nameHi: 'DIY कोर्सी-रोसेंथल एयर बॉक्स',
    instructions: 'Tape MERV-13 filters to a box fan for high-CADR low-cost filtration.',
    instructionsHi: 'बॉक्स फैन के साथ MERV-13 फ़िल्टर जोड़कर कम खर्च में हवा साफ करें।',
  },
  hepa_purifier: {
    id: 'hepa_purifier',
    monthlyCostInr: 2200,
    doseImpactLabel: '65-80% indoor PM2.5 drop',
    doseImpactLabelHi: 'इनडोर PM2.5 65-80% कम',
    name: 'True HEPA Air Purifier',
    nameHi: 'ट्रू HEPA एयर प्यूरीफायर',
    instructions: 'Run a true HEPA H13 purifier continuously in the main bedroom.',
    instructionsHi: 'मुख्य बेडरूम में लगातार ट्रू HEPA H13 एयर प्यूरीफायर चलाएं।',
  },
};

/**
 * Returns the CPCB AQI band matching a given PM2.5 concentration in ug/m^3.
 */
export function getAqiBand(pm25: number): AqiBandSpec {
  const safePm25 = Number.isFinite(pm25) ? Math.max(0, pm25) : 0;
  for (const band of CPCB_AQI_BANDS) {
    if (safePm25 <= band.maxPm25) {
      return band;
    }
  }
  return CPCB_AQI_BANDS[CPCB_AQI_BANDS.length - 1] as AqiBandSpec;
}
