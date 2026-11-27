/** Shared afternoon PM2.5 decision and bilingual advice. */

import type { DeterministicReport, LanguageCode } from './types.js';

const AFTERNOON_OUTDOOR_PM25_LIMIT = 120;

/** Tests whether afternoon outdoor PM2.5 exceeds the plan's ventilation limit. */
export function isAfternoonOutdoorPm25High(outdoorPm25: number): boolean {
  return outdoorPm25 > AFTERNOON_OUTDOOR_PM25_LIMIT;
}

/** Allows opening windows when outdoor PM2.5 is lower and within the afternoon limit. */
export function canVentilateAfternoon(outdoorPm25: number, indoorPm25: number): boolean {
  return !isAfternoonOutdoorPm25High(outdoorPm25) && outdoorPm25 < indoorPm25;
}

/** Reads the modeled afternoon decision, with an estimate for older reports without a series. */
export function getAfternoonVentilation(report: Pick<DeterministicReport, 'city' | 'exposure'>) {
  const { city, exposure } = report;
  const eligibleHour = exposure.hourlySeries?.find((point) => point.isOptimalVentilation);
  return {
    eligibleHour,
    canVentilate: exposure.hourlySeries === undefined
      ? canVentilateAfternoon(city.baselinePm25, exposure.optimizedIndoorPm25)
      : eligibleHour !== undefined,
  };
}

/** Formats the same modeled window recommendation for summaries and advisories. */
export function formatAfternoonVentilation(
  canVentilate: boolean,
  windowText: string,
  language: LanguageCode,
): string {
  if (language === 'hi') {
    return canVentilate
      ? `${windowText} के बीच खिड़कियां तभी खोलें जब बाहर PM2.5 अंदर से कम और 120 ug/m3 या उससे कम हो।`
      : 'दोपहर में खिड़कियां बंद रखें।';
  }
  return canVentilate
    ? `During ${windowText}, ventilate only while outdoor PM2.5 is below indoor PM2.5 and at or below 120 ug/m3.`
    : 'Keep windows closed in the afternoon.';
}
