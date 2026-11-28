/** Server-owned claim renderers for Gemini-selected, snapshot-bound facts. */

import { sumActiveHacksCostInr } from '../../src/domain/emissionsEngine.js';
import type { DeterministicReport, UserProfile } from '../../src/domain/types.js';
import { formatAfternoonVentilation, getAfternoonVentilation } from '../../src/domain/ventilation.js';

/** Maps a provider-selectable ID to its canonical localized text and citations. */
export type GroundedClaims = ReadonlyMap<string, string>;

function buildBudgetClaim(profile: UserProfile): string {
  const spend = sumActiveHacksCostInr(profile.activeHacks);
  const budget = profile.monthlyBudgetInr;
  const over = spend > budget;
  if (profile.language === 'hi') {
    return `चयनित उपायों का कुल खर्च ₹${spend}/माह है। यह ₹${budget}/माह के बजट ${over ? 'से अधिक है' : 'के भीतर है'}।`;
  }
  return `Selected measures cost ₹${spend}/month in total, ${over ? 'above' : 'within'} the ₹${budget}/month budget.`;
}

function buildLocalClaims(profile: UserProfile, report: DeterministicReport): GroundedClaims {
  const hi = profile.language === 'hi';
  const exp = report.exposure;
  const vent = getAfternoonVentilation(report);
  const hours = exp.hourlySeries?.filter((hour) => hour.isOptimalVentilation).map((hour) =>
    `${String(hour.hour).padStart(2, '0')}:00`,
  ) ?? [];
  const window = hours.join(', ');
  return new Map([
    ['DOSE_BEFORE', hi
      ? `बेसलाइन दैनिक PM2.5 खुराक ${exp.baselineInhaledUgPerDay} µg/day है। [CALC:DOSE_BEFORE]`
      : `Modeled baseline inhaled PM2.5 dose is ${exp.baselineInhaledUgPerDay} µg/day. [CALC:DOSE_BEFORE]`],
    ['DOSE_AFTER', hi
      ? `चयनित उपायों के साथ दैनिक PM2.5 खुराक ${exp.optimizedInhaledUgPerDay} µg/day है। [CALC:DOSE_AFTER]`
      : `Modeled daily inhaled PM2.5 dose with selected measures is ${exp.optimizedInhaledUgPerDay} µg/day. [CALC:DOSE_AFTER]`],
    ['INDOOR_PM25', hi
      ? `चयनित उपायों के साथ इनडोर PM2.5 ${exp.optimizedIndoorPm25} µg/m³ है। [CALC:INDOOR_PM25]`
      : `Modeled indoor PM2.5 with selected measures is ${exp.optimizedIndoorPm25} µg/m³. [CALC:INDOOR_PM25]`],
    ['INDOOR_TARGET', cite(report, 'CALC:INDOOR_TARGET')],
    ['VENTILATION', formatAfternoonVentilation(vent.canVentilate && hours.length > 0, window,
      profile.language)],
  ]);
}

function cite(report: DeterministicReport, key: string): string {
  const value = report.citations[key];
  return value === undefined ? '' : `${value} [${key}]`;
}

/** Registers facts separately so a value or unit cannot be transferred to another metric. */
export function buildGroundedClaims(
  profile: UserProfile,
  report: DeterministicReport,
): GroundedClaims {
  const local = report.aqStatus === 'unavailable' || report.aqStatus === 'pending'
    ? [] : buildLocalClaims(profile, report);
  return new Map([
    ...local,
    ['CO2E_SAVED', cite(report, 'CALC:CO2E_SAVED')],
    ['INR_DELTA', cite(report, 'CALC:INR_DELTA')],
    ['AQ_SOURCE', cite(report, 'AQ:SOURCE')],
    ['BUDGET', buildBudgetClaim(profile)],
    ['PLANTS_VS_HEPA', profile.language === 'hi'
      ? 'HEPA या CR-बॉक्स PM2.5 घटाते हैं। गमले के पौधे बहुत कम PM2.5 हटाते हैं। [SCI:PLANTS_VS_HEPA]'
      : cite(report, 'SCI:PLANTS_VS_HEPA')],
  ]);
}

/** Resolves only exact, unique claim IDs from the active snapshot or executed tool result. */
export function renderGroundedClaims(
  ids: readonly string[],
  claims: GroundedClaims,
): readonly string[] | undefined {
  if (new Set(ids).size !== ids.length) return undefined;
  const rendered: string[] = [];
  for (const id of ids) {
    const text = claims.get(id);
    if (!text) return undefined;
    rendered.push(text);
  }
  return rendered;
}
