/**
 * Bilingual English ('en') and Hindi Devanagari ('hi') dictionary and formatters.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import { CPCB_AQI_BANDS, getAqiBand } from './constants.js';
import type {
  AqiBandId,
  DailyRoutineBlock,
  DeterministicReport,
  HourlyExposurePoint,
  LanguageCode,
  PersonaType,
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

function getBandLabel(bandId: AqiBandId, language: LanguageCode): string {
  const matched = CPCB_AQI_BANDS.find((band) => band.id === bandId);
  if (matched !== undefined) {
    return language === 'hi' ? matched.labelHi : matched.labelEn;
  }
  const fallback = CPCB_AQI_BANDS[0];
  return language === 'hi' ? (fallback?.labelHi ?? 'अच्छा') : (fallback?.labelEn ?? 'Good');
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
      `दोपहर ${exposure.optimalVentilationWindow} बजे खिड़कियां खोलें। ` +
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

interface LocalizedCopy {
  readonly en: string;
  readonly hi: string;
}

interface PersonaRoutineCopy {
  readonly morningTitle: LocalizedCopy;
  readonly morningDesc: LocalizedCopy;
  readonly afternoonTitle: LocalizedCopy;
  readonly eveningTitle: LocalizedCopy;
  readonly eveningDesc: LocalizedCopy;
  readonly nightTitle: LocalizedCopy;
}

const PERSONA_ROUTINE_COPY: Readonly<Record<PersonaType, PersonaRoutineCopy>> = {
  young_family: {
    morningTitle: {
      en: 'Morning School Run & Inversion Shield',
      hi: 'सुबह स्कूल यात्रा और स्मॉग सुरक्षा',
    },
    morningDesc: {
      en: 'Seal balcony doors before 7 AM; fit kids with snug N95 masks on school drops.',
      hi: 'सुबह 7 बजे से पहले दरवाज़े सील करें; स्कूल छोड़ते समय बच्चों को फिटेड N95 पहनाएं।',
    },
    afternoonTitle: {
      en: 'Afternoon Cross-Ventilation & Play Check',
      hi: 'दोपहर वेंटिलेशन और बच्चों के खेल की जाँच',
    },
    eveningTitle: {
      en: 'Low-Smoke Family Dinner & Errand Chaining',
      hi: 'कम धुएं वाला रात का भोजन और एकल यात्रा',
    },
    eveningDesc: {
      en: 'Combine grocery runs into one trip; cook covered with exhaust and run HEPA/CR-box.',
      hi: 'बाज़ार के काम एक ही यात्रा में निपटाएं; ढक्कन व एग्जॉस्ट संग पकाएं और HEPA चलाएं।',
    },
    nightTitle: {
      en: 'Kids Bedroom Night Recovery (< 30 ug/m3)',
      hi: 'बच्चों के बेडरूम की रात की सुरक्षा (< 30 ug/m3)',
    },
  },
  sensitive_household: {
    morningTitle: {
      en: 'High-Risk Morning Indoor Quarantine',
      hi: 'संवेदनशील सदस्य सुबह घर के अंदर सुरक्षा',
    },
    morningDesc: {
      en: 'Avoid early outdoor walks; keep windows sealed and run continuous HEPA filtration.',
      hi: 'सुबह की सैर टालें; खिड़कियां सील रखें और लगातार HEPA प्यूरीफायर चलाएं।',
    },
    afternoonTitle: {
      en: 'Controlled 20-Min Afternoon Air Exchange',
      hi: 'नियंत्रित 20-मिनट दोपहर वायु परिवर्तन',
    },
    eveningTitle: {
      en: 'Zero-Smoke Kitchen & Respiratory Shield',
      hi: 'धुआं-मुक्त रसोई और श्वसन सुरक्षा',
    },
    eveningDesc: {
      en: 'Use induction/exhaust cooking only; avoid incense/smoke and keep rescue kit handy.',
      hi: 'केवल इंडक्शन/एग्जॉस्ट पर पकाएं; धूप-धुआं से बचें और ज़रूरी दवाएं पास रखें।',
    },
    nightTitle: {
      en: 'Clean-Air Sleep Sanctuary (< 30 ug/m3)',
      hi: 'स्वच्छ हवा शयनकक्ष (< 30 ug/m3 लक्ष्य)',
    },
  },
  rwa_coordinator: {
    morningTitle: {
      en: 'Society Gate Patrol & Carpool Dispatch',
      hi: 'सोसाइटी गेट जाँच और कारपूल समन्वय',
    },
    morningDesc: {
      en: 'Stop guardroom wood/trash burning; coordinate shared school & office carpool bays.',
      hi: 'गार्डरूम में लकड़ी/कचरा जलाना रोकें; साझा स्कूल और ऑफिस कारपूल शुरू करें।',
    },
    afternoonTitle: {
      en: 'RWA Ventilation Broadcast & Damp Sweeping',
      hi: 'RWA वेंटिलेशन सूचना और गीली सफाई',
    },
    eveningTitle: {
      en: 'DG Set Audit & Delivery Consolidation',
      hi: 'DG सेट जाँच और डिलीवरी समेकन',
    },
    eveningDesc: {
      en: 'Enforce no-idling at society gates, batch deliveries, and run community CR-boxes.',
      hi: 'गेट पर इंजन बंद रखें, डिलीवरी एक साथ लें और कॉमन हॉल में CR-बॉक्स चलाएं।',
    },
    nightTitle: {
      en: 'Overnight Apartment Filtration (< 30 ug/m3)',
      hi: 'रात भर फ्लैट इनडोर सुरक्षा (< 30 ug/m3)',
    },
  },
  office_commuter: {
    morningTitle: {
      en: 'Peak Rush-Hour Commute Shield (08:00-10:00)',
      hi: 'व्यस्त ऑफिस यात्रा स्मॉग सुरक्षा (08:00-10:00)',
    },
    morningDesc: {
      en: 'Wear a snug N95 during 8-10 AM transit, set car AC to recirculate, or prefer metro.',
      hi: 'सुबह 8-10 यात्रा में फिटेड N95 पहनें, कार AC रीसर्कुलेट पर रखें या मेट्रो चुनें।',
    },
    afternoonTitle: {
      en: 'Midday Home/Office Ventilation Window',
      hi: 'दोपहर घर/ऑफिस वेंटिलेशन विंडो',
    },
    eveningTitle: {
      en: 'Evening Traffic Peak & Fast Clean Dinner',
      hi: 'शाम ट्रैफिक स्मॉग बचाव और स्वच्छ भोजन',
    },
    eveningDesc: {
      en: 'Avoid unmasked 6-8 PM roadside walks; ventilate kitchen while cooking dinner.',
      hi: 'शाम 6-8 बिना मास्क सड़क पर न चलें; रात का खाना बनाते समय एग्जॉस्ट चलाएं।',
    },
    nightTitle: {
      en: 'Post-Commute Bedroom Recovery (< 30 ug/m3)',
      hi: 'यात्रा के बाद बेडरूम रिकवरी (< 30 ug/m3)',
    },
  },
  outdoor_student: {
    morningTitle: {
      en: 'Morning Assembly & Campus Transit Shield',
      hi: 'सुबह स्कूल/कैंपस यात्रा सुरक्षा',
    },
    morningDesc: {
      en: 'Wear a fitted N95 on 7-9 AM commute and skip vigorous outdoor drills during smog.',
      hi: 'सुबह 7-9 यात्रा में फिटेड N95 पहनें और भारी स्मॉग में सुबह की तेज़ दौड़ टालें।',
    },
    afternoonTitle: {
      en: 'Afternoon Dismissal & Sports AQI Check',
      hi: 'दोपहर छुट्टी और बाहरी खेल AQI जाँच',
    },
    eveningTitle: {
      en: 'Indoor Study Zone & Low-Smoke Dinner',
      hi: 'इनडोर पढ़ाई क्षेत्र और स्वच्छ भोजन',
    },
    eveningDesc: {
      en: 'Study in a sealed room with CR-box/HEPA running; avoid evening roadside snacks.',
      hi: 'CR-बॉक्स/HEPA वाले बंद कमरे में पढ़ाई करें; शाम को सड़क किनारे धुएं से बचें।',
    },
    nightTitle: {
      en: 'Student Sleep Recovery (< 30 ug/m3 Target)',
      hi: 'छात्र रात्रि विश्राम सुरक्षा (< 30 ug/m3)',
    },
  },
};

function pickText(copy: LocalizedCopy, isHi: boolean): string {
  return isHi ? copy.hi : copy.en;
}

function buildMorningDescription(
  profile: UserProfile,
  isHi: boolean,
): string {
  const base = pickText(PERSONA_ROUTINE_COPY[profile.persona].morningDesc, isHi);
  if (!profile.hasVulnerableMember || profile.persona === 'sensitive_household') {
    return base;
  }
  return isHi
    ? `${base} वरिष्ठ व बच्चों को घर के अंदर ही रखें।`
    : `${base} Keep seniors & infants indoors.`;
}

function buildAfternoonDescription(
  persona: PersonaType,
  isHi: boolean,
  outdoorPm25: number,
): string {
  const playSafe = outdoorPm25 <= 120;
  if (persona === 'outdoor_student') {
    if (isHi) {
      return playSafe
        ? '20-30 मिनट क्रॉस-वेंटिलेशन करें; हल्का बाहरी खेल संक्षिप्त रखें और वापसी पर हाथ-मुंह धोएं।'
        : '20 मिनट वेंटिलेशन व गीला पोंछा करें; बाहर AQI अधिक है, इनडोर खेल चुनें।';
    }
    return playSafe
      ? 'Cross-ventilate 20-30 mins; keep afternoon outdoor sports brief and wash up after.'
      : 'Ventilate 20 mins & wet-mop; ambient PM2.5 is high, so shift sports indoors.';
  }
  if (isHi) {
    return playSafe
      ? '20-30 मिनट क्रॉस-वेंटिलेशन व गीला पोंछा करें; संक्षिप्त बाहरी गतिविधि सुरक्षित।'
      : '20 मिनट वेंटिलेशन व गीला पोंछा करें; बाहर हवा खराब है, गतिविधियों को अंदर रखें।';
  }
  return playSafe
    ? 'Cross-ventilate 20-30 mins & wet-mop; brief supervised outdoor activity is safe.'
    : 'Ventilate 20 mins & wet-mop; PM2.5 remains high, so keep activities indoors.';
}

function buildEveningDescription(
  profile: UserProfile,
  isHi: boolean,
  indoorPm25: number,
  outdoorPm25: number,
): string {
  const base = pickText(PERSONA_ROUTINE_COPY[profile.persona].eveningDesc, isHi);
  if (profile.cookingFuel === 'biomass_chulha') {
    return isHi
      ? `${base} इनडोर रसोई PM2.5 घटाने हेतु LPG/इंडक्शन अपनाएं या क्रॉस-वेंटिलेशन व एग्जॉस्ट रखें।`
      : `${base} Switch to LPG/induction or use cross-ventilation/exhaust to cut indoor kitchen PM2.5.`;
  }
  if (indoorPm25 > outdoorPm25) {
    return isHi
      ? `${base} खाना बनाते समय रसोई एग्जॉस्ट और क्रॉस-वेंटिलेशन चालू रखें।`
      : `${base} Keep kitchen exhaust and cross-ventilation active while cooking.`;
  }
  return base;
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
  const copy = PERSONA_ROUTINE_COPY[profile.persona];
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
      title: pickText(copy.morningTitle, isHi),
      description: buildMorningDescription(profile, isHi),
      outdoorPm25: h7.outdoor,
      indoorPm25: h7.indoor,
      category: 'commute',
    },
    {
      id: 'afternoon_ventilation',
      timeRange: report.exposure.optimalVentilationWindow,
      title: pickText(copy.afternoonTitle, isHi),
      description: buildAfternoonDescription(profile.persona, isHi, h14.outdoor),
      outdoorPm25: h14.outdoor,
      indoorPm25: h14.indoor,
      category: 'ventilation',
    },
    {
      id: 'evening_cooking',
      timeRange: '18:30 - 21:00',
      title: pickText(copy.eveningTitle, isHi),
      description: buildEveningDescription(profile, isHi, h19.indoor, h19.outdoor),
      outdoorPm25: h19.outdoor,
      indoorPm25: h19.indoor,
      category: 'cooking',
    },
    {
      id: 'night_recovery',
      timeRange: '22:00 - 06:00',
      title: pickText(copy.nightTitle, isHi),
      description: buildNightDescription(isHi, h22.indoor),
      outdoorPm25: h22.outdoor,
      indoorPm25: h22.indoor,
      category: 'sleep',
    },
  ];
}

function clampHouseholdsCount(count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count)) {
    return 0;
  }
  return Math.min(5000, Math.max(0, Math.round(count)));
}

function clampAdoptionPercent(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) {
    return 0;
  }
  return Math.round(Math.min(1, Math.max(0, rate)) * 100);
}

/**
 * Builds a shareable WhatsApp/notice-board RWA community advisory.
 */
export function buildRwaNotice(
  profile: UserProfile,
  report: DeterministicReport,
): string {
  const households = clampHouseholdsCount(profile.rwaHouseholds);
  const adoptionPct = clampAdoptionPercent(profile.rwaAdoptionRate);
  const { communityCo2eAvoidedKgPerMonth, communityPm25AvoidedGramsPerMonth } = report.emissions;

  if (households <= 0 || communityCo2eAvoidedKgPerMonth <= 0) {
    if (profile.language === 'hi') {
      return (
        `RWA सामुदायिक प्रभाव (${report.city.nameHi}): अभी कोई सक्रिय RWA फ्लैट या भागीदारी दर दर्ज नहीं है। ` +
        `कृपया RWA कम्युनिटी पैनल में कुल फ्लैट्स और भागीदारी प्रतिशत चुनें ताकि मासिक बचत दिख सके।`
      );
    }
    return (
      `RWA Community Notice (${report.city.name}): Configure participating flats and adoption ` +
      `rate in the RWA Community panel to generate a verified monthly society notice.`
    );
  }

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
