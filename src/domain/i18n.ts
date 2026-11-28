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
  if (report.aqStatus === 'unavailable' || report.aqStatus === 'pending') return '';
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

function formatHouseholdEmissionsSummary(
  co2eAvoidedGramsPerDay: number,
  monthlyNetSavingsInr: number,
  language: LanguageCode,
): string {
  if (language === 'hi') {
    const co2ePart = co2eAvoidedGramsPerDay >= 0
      ? `प्रतिदिन ${String(co2eAvoidedGramsPerDay)}g CO2e बचत`
      : `बेसलाइन से +${String(Math.abs(co2eAvoidedGramsPerDay))}g CO2e/दिन अधिक उत्सर्जन`;
    const inrPart = monthlyNetSavingsInr >= 0
      ? `मासिक ₹${String(monthlyNetSavingsInr)} बचत होती है।`
      : `मासिक ₹${String(Math.abs(monthlyNetSavingsInr))} अतिरिक्त खर्च है।`;
    return `${co2ePart} और ${inrPart}`;
  }
  const co2ePart = co2eAvoidedGramsPerDay >= 0
    ? `You avoid ${String(co2eAvoidedGramsPerDay)}g CO2e/day`
    : `Current fuel/travel emits +${String(Math.abs(co2eAvoidedGramsPerDay))}g CO2e/day above baseline`;
  const inrPart = monthlyNetSavingsInr >= 0
    ? `with INR ${String(monthlyNetSavingsInr)}/month net savings.`
    : `with +INR ${String(Math.abs(monthlyNetSavingsInr))}/month net spend.`;
  return `${co2ePart} ${inrPart}`;
}

function joinUnavailableSummary(language: LanguageCode, emissions: string): string {
  const status = language === 'hi'
    ? 'स्थानीय वायु गुणवत्ता उपलब्ध नहीं है।'
    : 'Representative local air quality is unavailable.';
  return `${status} ${emissions}`;
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
  const emissionsSentence = formatHouseholdEmissionsSummary(
    emissions.co2eAvoidedGramsPerDay,
    emissions.monthlyNetSavingsInr,
    language,
  );

  if (report.aqStatus === 'unavailable' || report.aqStatus === 'pending') {
    return joinUnavailableSummary(language, emissionsSentence);
  }

  if (language === 'hi') {
    return (
      `${city.nameHi} में हवा की स्थिति ${aqiLabel} ` +
      `(CPCB AQI ${String(cpcbAqi)}, प्रमुख प्रदूषक ${dominantPollutant}, PM2.5: ${String(city.baselinePm25)} ug/m3) है। ` +
      `आपके चुने उपायों से दैनिक PM2.5 खुराक ${String(exposure.baselineInhaledUgPerDay)} से घटकर ` +
      `${String(exposure.optimizedInhaledUgPerDay)} ug/दिन (${String(exposure.doseReductionPercent)}% कमी) ` +
      `होती है और इनडोर PM2.5 ${String(exposure.optimizedIndoorPm25)} ug/m3 रहता है। ` +
      `${getVentilationAdvice(report, language)} ${emissionsSentence}`
    );
  }

  return (
    `In ${city.name}, ambient air is ${aqiLabel} ` +
    `(CPCB AQI ${String(cpcbAqi)}, dominant ${dominantPollutant}, PM2.5: ${String(city.baselinePm25)} ug/m3). ` +
    `Your selected actions cut daily inhaled PM2.5 from ${String(exposure.baselineInhaledUgPerDay)} ` +
    `to ${String(exposure.optimizedInhaledUgPerDay)} ug/day (${String(exposure.doseReductionPercent)}% drop) ` +
    `and lower indoor PM2.5 to ${String(exposure.optimizedIndoorPm25)} ug/m3. ` +
    `${getVentilationAdvice(report, language)} ${emissionsSentence}`
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

function formatMonthlyChange(value: number, unit: string, hi: boolean): string {
  const amount = `${Math.abs(value)} ${unit}`;
  if (value === 0) return hi ? `${amount} बदलाव` : `${amount} change`;
  if (hi) return value > 0 ? `${amount} कम` : `${amount} अधिक`;
  return value > 0 ? `+${amount} avoided` : `+${amount} added`;
}

function buildMixedEmissionsRwaNotice(
  report: DeterministicReport,
  language: LanguageCode,
  households: number,
  adoptionPct: number,
): string {
  const hi = language === 'hi';
  const em = report.emissions;
  const co2 = formatMonthlyChange(em.communityCo2eAvoidedKgPerMonth, 'kg CO2e', hi);
  const pm = formatMonthlyChange(em.communityPm25AvoidedGramsPerMonth, 'g PM2.5', hi);
  return hi
    ? `RWA सामुदायिक सूचना (${report.city.nameHi}): ${households} फ्लैट्स (${adoptionPct}% भागीदारी) में पेट्रोल/एलपीजी की तुलना में हर माह ${co2} और ${pm}।`
    : `RWA Community Notice (${report.city.name}): Across ${households} flats (${adoptionPct}% adoption), the monthly change from the petrol/LPG baseline is ${co2} and ${pm}.`;
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
  if (communityCo2eAvoidedKgPerMonth < 0 || communityPm25AvoidedGramsPerMonth < 0) {
    return buildMixedEmissionsRwaNotice(report, profile.language, households, adoptionPct);
  }
  if (communityCo2eAvoidedKgPerMonth === 0 && communityPm25AvoidedGramsPerMonth === 0) {
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
