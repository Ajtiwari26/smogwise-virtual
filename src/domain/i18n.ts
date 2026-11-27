/**
 * Bilingual English ('en') and Hindi Devanagari ('hi') summary, RWA notice,
 * and what-if explanation formatters. Pure TypeScript with zero Node/DOM dependencies.
 */

import { AQI_BAND_LABELS, MAX_RWA_HOUSEHOLDS } from './constants.js';
import { clampFinite, clampHouseholds } from './domainUtils.js';
import type {
  AqiBandId,
  DeterministicReport,
  LanguageCode,
  UserProfile,
  WhatIfDelta,
} from './types.js';
import { formatAfternoonVentilation, getAfternoonVentilation } from './ventilation.js';

/** Re-exports the localized daily routine generator. */
export { generateDailyRoutine } from './routineBuilder.js';

function getVentilationAdvice(report: DeterministicReport, language: LanguageCode): string {
  return formatAfternoonVentilation(
    getAfternoonVentilation(report).canVentilate,
    report.exposure.optimalVentilationWindow,
    language,
  );
}

function getBandLabel(bandId: AqiBandId, language: LanguageCode): string {
  const entry = Object.hasOwn(AQI_BAND_LABELS, bandId)
    ? AQI_BAND_LABELS[bandId]
    : AQI_BAND_LABELS.good;
  return language === 'hi' ? entry.hi : entry.en;
}

/**
 * Formats a plain-language localized summary explaining direct household impact.
 */
export function formatLocalizedSummary(
  report: DeterministicReport,
  language: LanguageCode,
): string {
  const { city, exposure, emissions, cpcbAqi, aqiBand, dominantPollutant } = report;
  const aqiLabel = getBandLabel(aqiBand, language);

  if (language === 'hi') {
    return (
      `${city.nameHi} में हवा की स्थिति ${aqiLabel} ` +
      `(CPCB AQI ${String(cpcbAqi)}, प्रमुख प्रदूषक ${dominantPollutant}, PM2.5: ${String(city.baselinePm25)} ug/m3) है। ` +
      `आपके चुने उपायों से दैनिक PM2.5 खुराक ${String(exposure.baselineInhaledUgPerDay)} से घटकर ` +
      `${String(exposure.optimizedInhaledUgPerDay)} ug/दिन (${String(exposure.doseReductionPercent)}% कमी) ` +
      `होती है और इनडोर PM2.5 ${String(exposure.optimizedIndoorPm25)} ug/m3 रहता है। ` +
      `${getVentilationAdvice(report, language)} ` +
      `प्रतिदिन ${String(emissions.co2eAvoidedGramsPerDay)}g CO2e और ` +
      `मासिक ₹${String(emissions.monthlyNetSavingsInr)} की बचत होती है।`
    );
  }

  return (
    `In ${city.name}, ambient air is ${aqiLabel} ` +
    `(CPCB AQI ${String(cpcbAqi)}, dominant ${dominantPollutant}, PM2.5: ${String(city.baselinePm25)} ug/m3). ` +
    `Your selected actions cut daily inhaled PM2.5 from ${String(exposure.baselineInhaledUgPerDay)} ` +
    `to ${String(exposure.optimizedInhaledUgPerDay)} ug/day (${String(exposure.doseReductionPercent)}% drop) ` +
    `and lower indoor PM2.5 to ${String(exposure.optimizedIndoorPm25)} ug/m3. ` +
    `${getVentilationAdvice(report, language)} ` +
    `You avoid ${String(emissions.co2eAvoidedGramsPerDay)}g CO2e/day with ` +
    `INR ${String(emissions.monthlyNetSavingsInr)}/month net savings.`
  );
}

function clampAdoptionPercent(rate: number | undefined): number {
  if (rate === undefined) {
    return 0;
  }
  return Math.round(clampFinite(rate, 0, 1, 0) * 100);
}

function buildUnconfiguredRwaNotice(report: DeterministicReport, language: LanguageCode): string {
  if (language === 'hi') {
    return (
      `RWA सामुदायिक प्रभाव (${report.city.nameHi}): अभी कोई सक्रिय RWA फ्लैट या भागीदारी दर दर्ज नहीं है। ` +
      'कृपया RWA कम्युनिटी पैनल में कुल फ्लैट्स और भागीदारी प्रतिशत चुनें ताकि मासिक बचत दिख सके।'
    );
  }
  return (
    `RWA Community Notice (${report.city.name}): Configure participating flats and adoption ` +
    'rate in the RWA Community panel to generate a verified monthly society notice.'
  );
}

function buildZeroSavingsRwaNotice(
  report: DeterministicReport,
  language: LanguageCode,
  households: number,
  adoptionPct: number,
): string {
  if (language === 'hi') {
    return (
      `RWA सामुदायिक सूचना (${report.city.nameHi}): ${String(households)} फ्लैट्स (${String(adoptionPct)}% भागीदारी) ` +
      'वर्तमान में पेट्रोल/LPG बेसलाइन स्तर पर हैं (0 kg CO2e बचत)। सामुदायिक बचत शुरू करने हेतु ' +
      'मेट्रो/कारपूल या इंडक्शन अपनाने का प्रस्ताव साझा करें।'
    );
  }
  return (
    `RWA Community Notice (${report.city.name}): Across ${String(households)} flats (${String(adoptionPct)}% adoption), ` +
    'current petrol/LPG choices match baseline emissions (0 kg CO2e avoided). Promote society carpools, ' +
    'metro transit, or induction cooking to unlock verified monthly reductions.'
  );
}

/**
 * Builds a shareable WhatsApp/notice-board RWA community advisory.
 */
export function buildRwaNotice(
  profile: UserProfile,
  report: DeterministicReport,
): string {
  const households = clampHouseholds(profile.rwaHouseholds, MAX_RWA_HOUSEHOLDS);
  const adoptionPct = clampAdoptionPercent(profile.rwaAdoptionRate);
  const { communityCo2eAvoidedKgPerMonth, communityPm25AvoidedGramsPerMonth } = report.emissions;

  if (households <= 0 || adoptionPct <= 0) {
    return buildUnconfiguredRwaNotice(report, profile.language);
  }
  if (communityCo2eAvoidedKgPerMonth <= 0) {
    return buildZeroSavingsRwaNotice(report, profile.language, households, adoptionPct);
  }

  if (profile.language === 'hi') {
    return (
      `RWA स्मॉग अलर्ट (${report.city.nameHi}): ${String(households)} फ्लैट्स में ` +
      `${String(adoptionPct)}% भागीदारी से हर महीने ${String(communityCo2eAvoidedKgPerMonth)} kg CO2e ` +
      `और ${String(communityPm25AvoidedGramsPerMonth)} g PM2.5 कम होगा। ` +
      `${getVentilationAdvice(report, profile.language)} कारपूल अपनाएं।`
    );
  }

  return (
    `RWA Smog Action Notice (${report.city.name}): With ${String(adoptionPct)}% adoption across ` +
    `${String(households)} flats, our society avoids ${String(communityCo2eAvoidedKgPerMonth)} kg ` +
    `CO2e and ${String(communityPm25AvoidedGramsPerMonth)} g PM2.5 every month. ` +
    `${getVentilationAdvice(report, profile.language)} Ban guardroom biomass burning ` +
    'and coordinate school carpools.'
  );
}

function formatEnEmissionsClause(co2e: number, pm25: number): string {
  if (co2e >= 0 && pm25 >= 0) {
    return `avoids ${String(co2e)} g CO2e/day and ${String(pm25)} mg PM2.5/day`;
  }
  return `shifts daily emissions by ${String(-co2e)} g CO2e/day and ${String(-pm25)} mg PM2.5/day`;
}

function formatHiEmissionsClause(co2e: number, pm25: number): string {
  if (co2e >= 0 && pm25 >= 0) {
    return `प्रतिदिन ${String(co2e)} g CO2e और ${String(pm25)} mg PM2.5 उत्सर्जन कम होता है`;
  }
  return `प्रतिदिन ${String(-co2e)} g CO2e और ${String(-pm25)} mg PM2.5 उत्सर्जन में बदलाव होता है`;
}

/**
 * Formats bilingual plain-language explanations for a two-choice what-if delta.
 */
export function formatWhatIfExplanation(
  delta: WhatIfDelta,
  baseline: DeterministicReport,
  alternative: DeterministicReport,
): { readonly en: string; readonly hi: string } {
  const enEmissions = formatEnEmissionsClause(
    delta.co2eAvoidedGramsPerDay,
    delta.pm25AvoidedMgPerDay,
  );
  const hiEmissions = formatHiEmissionsClause(
    delta.co2eAvoidedGramsPerDay,
    delta.pm25AvoidedMgPerDay,
  );

  const en = (
    `Switching choices in ${alternative.city.name} changes daily inhaled PM2.5 by ` +
    `${String(delta.doseReductionUgPerDay)} ug/day (from ` +
    `${String(baseline.exposure.optimizedInhaledUgPerDay)} to ` +
    `${String(alternative.exposure.optimizedInhaledUgPerDay)} ug/day), ${enEmissions}, ` +
    `with a monthly net INR delta of INR ${String(delta.monthlyNetSavingsInr)}.`
  );

  const hi = (
    `${alternative.city.nameHi} में विकल्प बदलने से दैनिक PM2.5 खुराक में ` +
    `${String(delta.doseReductionUgPerDay)} ug/दिन का अंतर आता है, ` +
    `${hiEmissions}, ` +
    `और मासिक शुद्ध बचत में ₹${String(delta.monthlyNetSavingsInr)} का बदलाव होता है।`
  );

  return { en, hi };
}
