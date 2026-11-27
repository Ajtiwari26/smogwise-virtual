/**
 * Bilingual persona daily routine generator for SmogWise Virtual.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import { INDOOR_PRACTICAL_TARGET_UG_M3 } from './constants.js';
import { round2 } from './domainUtils.js';
import {
  type LocalizedCopy,
  PERSONA_ROUTINE_COPY,
  type PersonaRoutineCopy,
} from './routineCopy.js';
import type {
  DailyRoutineBlock,
  DeterministicReport,
  HourlyExposurePoint,
  PersonaType,
  UserProfile,
} from './types.js';
import { getAfternoonVentilation, isAfternoonOutdoorPm25High } from './ventilation.js';

const INDOOR_AIR_CARE_TITLE = {
  en: 'Afternoon Indoor Air Care',
  hi: 'दोपहर में घर की हवा की देखभाल',
};

function pickText(copy: LocalizedCopy, isHi: boolean): string {
  return isHi ? copy.hi : copy.en;
}

function getPersonaCopy(persona: PersonaType): PersonaRoutineCopy {
  return Object.hasOwn(PERSONA_ROUTINE_COPY, persona)
    ? PERSONA_ROUTINE_COPY[persona]
    : PERSONA_ROUTINE_COPY.young_family;
}

function pickHourStats(
  hourlySeries: readonly HourlyExposurePoint[] | undefined,
  hour: number,
  fallback: { readonly outdoor: number; readonly indoor: number },
): { readonly outdoor: number; readonly indoor: number } {
  const point = hourlySeries?.[hour];
  if (point === undefined) {
    return fallback;
  }
  return { outdoor: point.outdoorPm25, indoor: point.optimizedIndoorPm25 };
}

function buildMorningDescription(profile: UserProfile, isHi: boolean): string {
  const base = pickText(getPersonaCopy(profile.persona).morningDesc, isHi);
  if (!profile.hasVulnerableMember || profile.persona === 'sensitive_household') {
    return base;
  }
  return isHi
    ? `${base} वरिष्ठ व बच्चों को घर के अंदर ही रखें।`
    : `${base} Keep seniors & infants indoors.`;
}

function buildStudentActivityAdvice(isHi: boolean, outdoorIsHigh: boolean): string {
  if (outdoorIsHigh) {
    return isHi
      ? 'बाहर PM2.5 अधिक है, इनडोर खेल चुनें।'
      : 'Outdoor PM2.5 is high, so shift sports indoors.';
  }
  return isHi
    ? 'हल्का बाहरी खेल संक्षिप्त रखें और वापसी पर हाथ-मुंह धोएं।'
    : 'For sports, keep afternoon outdoor sports brief and wash up after.';
}

function buildAfternoonDescription(
  persona: PersonaType,
  isHi: boolean,
  canVentilate: boolean,
  outdoorIsHigh: boolean,
): string {
  const airAdvice = canVentilate
    ? pickText({
      en: 'Cross-ventilate for 20-30 minutes while outdoor PM2.5 stays lower and at or below 120 ug/m3. Wet-mop afterward.',
      hi: 'जब बाहर PM2.5 अंदर से कम और 120 ug/m3 या उससे कम हो, तब 20-30 मिनट हवा बदलें। फिर गीला पोंछा लगाएं।',
    }, isHi)
    : pickText({
      en: 'Keep windows closed and wet-mop.',
      hi: 'खिड़कियां बंद रखें और गीला पोंछा लगाएं।',
    }, isHi);
  if (persona === 'outdoor_student') {
    return `${airAdvice} ${buildStudentActivityAdvice(isHi, outdoorIsHigh)}`;
  }
  if (outdoorIsHigh) {
    const indoorAdvice = isHi
      ? 'बाहर PM2.5 अधिक है, गतिविधियों को अंदर रखें।'
      : 'Outdoor PM2.5 is high, so move activities indoors.';
    return `${airAdvice} ${indoorAdvice}`;
  }
  return airAdvice;
}

function buildEveningDescription(
  profile: UserProfile,
  isHi: boolean,
  indoorPm25: number,
  outdoorPm25: number,
): string {
  const base = pickText(getPersonaCopy(profile.persona).eveningDesc, isHi);
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
  const target = String(INDOOR_PRACTICAL_TARGET_UG_M3);
  if (indoorPm25 <= INDOOR_PRACTICAL_TARGET_UG_M3) {
    return isHi
      ? `इनडोर PM2.5 व्यावहारिक लक्ष्य (<= ${target} ug/m3) पर है। बेडरूम के दरवाजे बंद रखें।`
      : `Indoor PM2.5 meets the <= ${target} ug/m3 target. Keep bedroom doors shut overnight.`;
  }
  const gap = String(round2(indoorPm25 - INDOOR_PRACTICAL_TARGET_UG_M3));
  return isHi
    ? `इनडोर लक्ष्य (${target} ug/m3) से ${gap} ug/m3 ऊपर। रात भर HEPA/CR-बॉक्स चलाएं।`
    : `${gap} ug/m3 above the ${target} ug/m3 indoor target. Run HEPA or CR-box overnight.`;
}

/**
 * Generates a localized morning-to-night low-emission daily routine.
 */
export function generateDailyRoutine(
  profile: UserProfile,
  report: DeterministicReport,
): readonly DailyRoutineBlock[] {
  const isHi = profile.language === 'hi';
  const copy = getPersonaCopy(profile.persona);
  const { hourlySeries: series, optimizedIndoorPm25 } = report.exposure;
  const fallback = { outdoor: report.city.baselinePm25, indoor: optimizedIndoorPm25 };
  const h7 = pickHourStats(series, 7, fallback);
  const h14 = pickHourStats(series, 14, fallback);
  const outdoorIsHigh = isAfternoonOutdoorPm25High(h14.outdoor);
  const { canVentilate, eligibleHour } = getAfternoonVentilation(report);
  const h19 = pickHourStats(series, 19, fallback);
  const h22 = pickHourStats(series, 22, fallback);

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
      title: pickText(canVentilate ? copy.afternoonTitle : INDOOR_AIR_CARE_TITLE, isHi),
      description: buildAfternoonDescription(profile.persona, isHi, canVentilate, outdoorIsHigh),
      outdoorPm25: eligibleHour?.outdoorPm25 ?? h14.outdoor,
      indoorPm25: eligibleHour?.optimizedIndoorPm25 ?? h14.indoor,
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
