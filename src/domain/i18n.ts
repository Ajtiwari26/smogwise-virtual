/**
 * Bilingual English ('en') and Hindi Devanagari ('hi') dictionary and formatters.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import { getAqiBand } from './constants.js';
import type {
  DailyRoutineBlock,
  DeterministicReport,
  HourlyExposurePoint,
  LanguageCode,
  UserProfile,
  WhatIfDelta,
} from './types.js';

/** Localized UI copy dictionary for SmogWise Virtual. */
export interface TranslationBundle {
  readonly appTitle: string;
  readonly subtitle: string;
  readonly skipToContent: string;
  readonly liveAqLabel: string;
  readonly presetAqLabel: string;
  readonly ventilationWindowLabel: string;
  readonly inhaledDoseLabel: string;
  readonly indoorPm25Label: string;
  readonly co2eAvoidedLabel: string;
  readonly monthlySavingsLabel: string;
  readonly rwaImpactLabel: string;
  readonly routineHeading: string;
  readonly whatIfHeading: string;
  readonly assistantHeading: string;
}

/** Complete English and Hindi Devanagari UI strings. */
export const I18N_DICTIONARY: Readonly<Record<LanguageCode, TranslationBundle>> = {
  en: {
    appTitle: 'SmogWise Virtual',
    subtitle: 'Deterministic Winter Smog Exposure & Low-Emission Action Planner',
    skipToContent: 'Skip to main content',
    liveAqLabel: 'Live Open-Meteo AQ',
    presetAqLabel: 'Offline City Preset',
    ventilationWindowLabel: 'Optimal Ventilation Window',
    inhaledDoseLabel: 'Daily Inhaled PM2.5 Dose',
    indoorPm25Label: 'Average Indoor PM2.5',
    co2eAvoidedLabel: 'Daily CO2e Avoided',
    monthlySavingsLabel: 'Monthly Net Savings',
    rwaImpactLabel: 'RWA Community Monthly Impact',
    routineHeading: 'Low-Emission Daily Routine',
    whatIfHeading: 'What-If Choice Comparator',
    assistantHeading: 'Grounded Smog Advisor',
  },
  hi: {
    appTitle: 'स्मॉगवाइज़ वर्चुअल',
    subtitle: 'सर्दियों के स्मॉग से बचाव और कम-उत्सर्जन दैनिक कार्य योजना',
    skipToContent: 'मुख्य सामग्री पर जाएं',
    liveAqLabel: 'लाइव ओपन-मेटियो AQI',
    presetAqLabel: 'ऑफ़लाइन शहर प्रीसेट',
    ventilationWindowLabel: 'सर्वोत्तम वेंटिलेशन समय',
    inhaledDoseLabel: 'दैनिक साँस द्वारा PM2.5 खुराक',
    indoorPm25Label: 'औसत इनडोर PM2.5',
    co2eAvoidedLabel: 'दैनिक बचाया गया CO2e',
    monthlySavingsLabel: 'मासिक शुद्ध बचत',
    rwaImpactLabel: 'RWA समुदाय मासिक प्रभाव',
    routineHeading: 'कम-उत्सर्जन दैनिक दिनचर्या',
    whatIfHeading: 'विकल्प तुलना (क्या-अगर)',
    assistantHeading: 'प्रमाणित स्मॉग सलाहकार',
  },
};

/**
 * Returns the translation dictionary for the requested language.
 */
export function getTranslations(language: LanguageCode): TranslationBundle {
  return I18N_DICTIONARY[language];
}

/**
 * Returns the localized CPCB AQI category label for a PM2.5 concentration.
 */
export function getLocalizedAqiLabel(pm25: number, language: LanguageCode): string {
  const band = getAqiBand(pm25);
  return language === 'hi' ? band.labelHi : band.labelEn;
}

/**
 * Formats a plain-language localized summary explaining direct household impact.
 */
export function formatLocalizedSummary(
  report: DeterministicReport,
  language: LanguageCode,
): string {
  const { city, exposure, emissions } = report;
  const aqiLabel = getLocalizedAqiLabel(city.baselinePm25, language);

  if (language === 'hi') {
    return (
      `${city.nameHi} में हवा की स्थिति ${aqiLabel} (PM2.5: ${String(city.baselinePm25)} ug/m3) है। ` +
      `आपके चुने उपायों से दैनिक PM2.5 खुराक ${String(exposure.baselineInhaledUgPerDay)} से घटकर ` +
      `${String(exposure.optimizedInhaledUgPerDay)} ug/दिन (${String(exposure.doseReductionPercent)}% कमी) ` +
      `होती है। दोपहर ${exposure.optimalVentilationWindow} बजे खिड़कियां खोलें। ` +
      `प्रतिदिन ${String(emissions.co2eAvoidedGramsPerDay)}g CO2e और ` +
      `मासिक ₹${String(emissions.monthlyNetSavingsInr)} की बचत होती है।`
    );
  }

  return (
    `In ${city.name}, ambient air is ${aqiLabel} (PM2.5: ${String(city.baselinePm25)} ug/m3). ` +
    `Your selected actions cut daily inhaled PM2.5 from ${String(exposure.baselineInhaledUgPerDay)} ` +
    `to ${String(exposure.optimizedInhaledUgPerDay)} ug/day (${String(exposure.doseReductionPercent)}% drop) ` +
    `and lower indoor PM2.5 to ${String(exposure.optimizedIndoorPm25)} ug/m3. ` +
    `Ventilate during ${exposure.optimalVentilationWindow}. ` +
    `You avoid ${String(emissions.co2eAvoidedGramsPerDay)}g CO2e/day with ` +
    `INR ${String(emissions.monthlyNetSavingsInr)}/month net savings.`
  );
}

function pickHourStats(
  hourlySeries: readonly HourlyExposurePoint[] | undefined,
  hour: number,
  fallbackOut: number,
  fallbackIn: number,
): { readonly outdoor: number; readonly indoor: number } {
  const point = hourlySeries?.[hour];
  if (point === undefined) {
    return { outdoor: fallbackOut, indoor: fallbackIn };
  }
  return { outdoor: point.outdoorPm25, indoor: point.optimizedIndoorPm25 };
}

function buildMorningDescription(isHi: boolean, hasVulnerable: boolean): string {
  if (isHi) {
    return hasVulnerable
      ? 'वरिष्ठ/बच्चे सुबह बाहर न निकलें; खिड़कियां सील रखें और यात्रा में N95 पहनें।'
      : 'सुबह स्मॉग चरम पर है; खिड़कियां बंद रखें और बाहर निकलते समय N95 पहनें।';
  }
  return hasVulnerable
    ? 'Keep seniors & kids indoors; seal windows and wear fitted N95 on commutes.'
    : 'Peak morning inversion: keep windows sealed and wear a fitted N95 outdoors.';
}

function buildAfternoonDescription(isHi: boolean, outdoorPm25: number): string {
  const playSafe = outdoorPm25 <= 120;
  if (isHi) {
    return playSafe
      ? '20-30 मिनट क्रॉस-वेंटिलेशन व गीला पोंछा करें; बच्चों के लिए हल्का बाहरी खेल सुरक्षित।'
      : '20 मिनट वेंटिलेशन व गीला पोंछा करें; बाहर हवा खराब है, बच्चों को अंदर ही खिलाएं।';
  }
  return playSafe
    ? 'Cross-ventilate 20-30 mins & wet-mop; brief supervised kids outdoor play is okay.'
    : 'Ventilate 20 mins & wet-mop; PM2.5 remains high, so keep kids outdoor play indoors.';
}

function buildEveningDescription(isHi: boolean): string {
  return isHi
    ? 'सभी काम एक ही यात्रा में निपटाएं; एग्जॉस्ट व ढक्कन संग पकाएं (पौधे नहीं, HEPA चलाएं)।'
    : 'Chain errands into one trip; cook covered with exhaust and run HEPA/CR-box, not plants.';
}

function buildNightDescription(isHi: boolean, indoorPm25: number): string {
  const gap = Math.max(0, Math.round((indoorPm25 - 30) * 10) / 10);
  if (isHi) {
    return gap === 0
      ? 'इनडोर PM2.5 < 30 ug/m3 सुरक्षित लक्ष्य पर है; बेडरूम दरवाजे बंद रखें।'
      : `इनडोर लक्ष्य (< 30 ug/m3) से ${String(gap)} ug/m3 ऊपर; रात भर HEPA/CR-बॉक्स चलाएं।`;
  }
  return gap === 0
    ? 'Indoor PM2.5 meets the < 30 ug/m3 target; keep bedroom doors shut overnight.'
    : `${String(gap)} ug/m3 above < 30 ug/m3 indoor target; run HEPA or CR-box overnight.`;
}

/**
 * Generates a localized morning-to-night low-emission daily routine.
 */
export function generateDailyRoutine(
  profile: UserProfile,
  report: DeterministicReport,
): readonly DailyRoutineBlock[] {
  const isHi = profile.language === 'hi';
  const series = report.exposure.hourlySeries;
  const baseOut = report.city.baselinePm25;
  const baseIn = report.exposure.optimizedIndoorPm25;
  const h7 = pickHourStats(series, 7, baseOut, baseIn);
  const h14 = pickHourStats(series, 14, baseOut, baseIn);
  const h19 = pickHourStats(series, 19, baseOut, baseIn);
  const h22 = pickHourStats(series, 22, baseOut, baseIn);

  return [
    {
      id: 'morning_inversion',
      timeRange: '06:00 - 09:30',
      title: isHi ? 'सुबह का स्मॉग बचाव और यात्रा' : 'Morning Inversion Shield & Commute',
      description: buildMorningDescription(isHi, profile.hasVulnerableMember),
      outdoorPm25: h7.outdoor,
      indoorPm25: h7.indoor,
      category: 'commute',
    },
    {
      id: 'afternoon_ventilation',
      timeRange: report.exposure.optimalVentilationWindow,
      title: isHi ? 'दोपहर वेंटिलेशन विंडो' : 'Afternoon Ventilation Window',
      description: buildAfternoonDescription(isHi, h14.outdoor),
      outdoorPm25: h14.outdoor,
      indoorPm25: h14.indoor,
      category: 'ventilation',
    },
    {
      id: 'evening_cooking',
      timeRange: '18:30 - 21:00',
      title: isHi ? 'शाम का स्वच्छ खाना पकाना' : 'Low-Smoke Evening Cooking & Trip Chaining',
      description: buildEveningDescription(isHi),
      outdoorPm25: h19.outdoor,
      indoorPm25: h19.indoor,
      category: 'cooking',
    },
    {
      id: 'night_recovery',
      timeRange: '22:00 - 06:00',
      title: isHi ? 'रात का सुरक्षित शयनकक्ष' : 'Protected Night Recovery (< 30 ug/m3 Target)',
      description: buildNightDescription(isHi, h22.indoor),
      outdoorPm25: h22.outdoor,
      indoorPm25: h22.indoor,
      category: 'sleep',
    },
  ];
}

/**
 * Builds a shareable WhatsApp/notice-board RWA community advisory.
 */
export function buildRwaNotice(
  profile: UserProfile,
  report: DeterministicReport,
): string {
  const households = profile.rwaHouseholds ?? 50;
  const adoptionPct = Math.round((profile.rwaAdoptionRate ?? 0.5) * 100);
  const { communityCo2eAvoidedKgPerMonth, communityPm25AvoidedGramsPerMonth } = report.emissions;

  if (profile.language === 'hi') {
    return (
      `RWA स्मॉग अलर्ट (${report.city.nameHi}): ${String(households)} फ्लैट्स में ` +
      `${String(adoptionPct)}% भागीदारी से हर महीने ${String(communityCo2eAvoidedKgPerMonth)} kg CO2e ` +
      `और ${String(communityPm25AvoidedGramsPerMonth)} g PM2.5 कम होगा। ` +
      `कृपया ${report.exposure.optimalVentilationWindow} के बीच वेंटिलेशन करें और कारपूल अपनाएं।`
    );
  }

  return (
    `RWA Smog Action Notice (${report.city.name}): With ${String(adoptionPct)}% adoption across ` +
    `${String(households)} flats, our society avoids ${String(communityCo2eAvoidedKgPerMonth)} kg ` +
    `CO2e and ${String(communityPm25AvoidedGramsPerMonth)} g PM2.5 every month. ` +
    `Ventilate between ${report.exposure.optimalVentilationWindow}, ban guardroom biomass burning, ` +
    `and coordinate school carpools.`
  );
}

/**
 * Formats bilingual plain-language explanations for a two-choice what-if delta.
 */
export function formatWhatIfExplanation(
  delta: WhatIfDelta,
  baseline: DeterministicReport,
  alternative: DeterministicReport,
): { readonly en: string; readonly hi: string } {
  const en = (
    `Switching choices in ${alternative.city.name} changes daily inhaled PM2.5 by ` +
    `${String(delta.doseReductionUgPerDay)} ug/day (from ` +
    `${String(baseline.exposure.optimizedInhaledUgPerDay)} to ` +
    `${String(alternative.exposure.optimizedInhaledUgPerDay)} ug/day), avoids ` +
    `${String(delta.co2eAvoidedGramsPerDay)} g CO2e/day and ` +
    `${String(delta.pm25AvoidedMgPerDay)} mg PM2.5/day, with a monthly net INR delta of ` +
    `INR ${String(delta.monthlyNetSavingsInr)}.`
  );

  const hi = (
    `${alternative.city.nameHi} में विकल्प बदलने से दैनिक PM2.5 खुराक में ` +
    `${String(delta.doseReductionUgPerDay)} ug/दिन का अंतर आता है, ` +
    `प्रतिदिन ${String(delta.co2eAvoidedGramsPerDay)} g CO2e और ` +
    `${String(delta.pm25AvoidedMgPerDay)} mg PM2.5 उत्सर्जन कम होता है, ` +
    `और मासिक शुद्ध बचत में ₹${String(delta.monthlyNetSavingsInr)} का बदलाव होता है।`
  );

  return { en, hi };
}
