/**
 * Deterministic EN/HI offline fallbacks for grounded household briefings and Q&A.
 */

import { rankIAQHacksByBudget } from '../../src/domain/emissionsEngine.js';
import {
  compareWhatIfFromBaseline,
  extractReportLiveAq,
} from '../../src/domain/impactService.js';
import { buildGroundedClaims } from './genaiVerifier.js';
import { formatBudgetOptions, isBudgetQuestion, readBudgetCap } from './genaiBudget.js';
import type {
  CommuteMode,
  CookingFuel,
  DeterministicReport,
  FullPlanOutput,
  LanguageCode,
  UserProfile,
} from '../../src/domain/types.js';

const PLANTS_QUESTION_RE = /\bplants?\b|houseplant|indoor\s*plant|areca|spider\s*plant|पौध|गमल/iu;
const COMMUTE_WHAT_IF_RE =
  /commute|carpool|metro|bus|petrol|wfh|walk|two[- ]?wheeler|आवागमन|यातायात|पैदल|मेट्रो/iu;
const FUEL_WHAT_IF_RE =
  /cooking|fuel|chulha|induction|lpg|biomass|ईंधन|चूल्हा|रसोई|इंडक्शन/iu;
const GENERIC_WHAT_IF_RE = /what[- ]?if|तुलना/iu;

/** Returns true for site-independent houseplant-vs-HEPA questions. */
export function isPlantsQuestion(question: string): boolean {
  return PLANTS_QUESTION_RE.test(question);
}

function isWhatIfQuestion(question: string): boolean {
  return (
    COMMUTE_WHAT_IF_RE.test(question) ||
    FUEL_WHAT_IF_RE.test(question) ||
    GENERIC_WHAT_IF_RE.test(question)
  );
}

function isAqMissing(report: DeterministicReport): boolean {
  return report.aqStatus === 'unavailable' || report.aqStatus === 'pending';
}

const COMMUTE_MATCHERS: readonly { readonly value: CommuteMode; readonly re: RegExp }[] = [
  { value: 'wfh_walk', re: /wfh|walk|पैदल/iu },
  { value: 'metro_bus', re: /metro|bus|मेट्रो|बस/iu },
  { value: 'carpool', re: /carpool|कारपूल/iu },
  { value: 'two_wheeler', re: /two[- ]?wheeler/iu },
  { value: 'petrol_car', re: /petrol/iu },
];

const FUEL_MATCHERS: readonly { readonly value: CookingFuel; readonly re: RegExp }[] = [
  { value: 'induction', re: /induction|electric|इंडक्शन/iu },
  { value: 'lpg', re: /lpg|एलपीजी/iu },
  { value: 'biomass_chulha', re: /biomass|chulha|चूल्हा/iu },
];

function pickAlternativeOption<T>(
  current: T,
  question: string,
  matchers: readonly { readonly value: T; readonly re: RegExp }[],
  fallback: T,
): T {
  const destination = /\b(?:to|into)\s+([^\n]+)/iu.exec(question)?.[1];
  if (destination !== undefined) {
    const destDiff = matchers.find((m) => m.value !== current && m.re.test(destination));
    if (destDiff !== undefined) return destDiff.value;
    const destSame = matchers.find((m) => m.re.test(destination));
    if (destSame !== undefined) return destSame.value;
  }
  const matched = matchers.filter((m) => m.re.test(question));
  const diffMatch = matched.find((m) => m.value !== current);
  if (diffMatch !== undefined) return diffMatch.value;
  return matched[0] === undefined ? fallback : matched[0].value;
}

function pickOfflineCommute(current: CommuteMode, question: string): CommuteMode {
  const fallback = current === 'metro_bus' || current === 'wfh_walk' ? 'wfh_walk' : 'metro_bus';
  return pickAlternativeOption(current, question, COMMUTE_MATCHERS, fallback);
}

function pickOfflineFuel(current: CookingFuel, question: string): CookingFuel {
  return pickAlternativeOption(
    current,
    question,
    FUEL_MATCHERS,
    current === 'induction' ? 'lpg' : 'induction',
  );
}

function buildOfflineAlternative(profile: UserProfile, question: string): UserProfile {
  const asksCommute = COMMUTE_WHAT_IF_RE.test(question);
  const asksFuel = FUEL_WHAT_IF_RE.test(question);
  const switchBoth = !asksCommute && !asksFuel;
  const commuteMode = asksCommute || switchBoth
    ? pickOfflineCommute(profile.commuteMode, question)
    : profile.commuteMode;
  const cookingFuel = asksFuel || switchBoth
    ? pickOfflineFuel(profile.cookingFuel, question)
    : profile.cookingFuel;
  return { ...profile, commuteMode, cookingFuel };
}

function buildPlantOfflineAnswer(
  claims: ReadonlyMap<string, string>,
  aqMissing: boolean,
  language: LanguageCode,
): string {
  if (aqMissing) {
    return `${claims.get('PLANTS_VS_HEPA') ?? ''} ${formatAqUnavailable(language)}`.trim();
  }
  return ['PLANTS_VS_HEPA', 'INDOOR_PM25', 'INDOOR_TARGET', 'AQ_SOURCE']
    .map((id) => claims.get(id))
    .filter(Boolean)
    .join(' ');
}

function buildDefaultOfflineAnswer(
  claims: ReadonlyMap<string, string>,
  question: string,
): string {
  const selected = /ventilat|window|वेंटिलेशन|खिड़की|खोल/u.test(question.toLowerCase())
    ? ['VENTILATION', 'INDOOR_PM25', 'DOSE_AFTER', 'AQ_SOURCE']
    : ['DOSE_BEFORE', 'DOSE_AFTER', 'INDOOR_PM25', 'VENTILATION', 'CO2E_SAVED', 'INR_DELTA', 'AQ_SOURCE'];
  return selected.map((id) => claims.get(id)).join(' ');
}

/** Question-aware deterministic offline Q&A synthesis when Gemini API is unavailable. */
export function buildOfflineAnswer(
  plan: FullPlanOutput,
  profile: UserProfile,
  question = '',
): string {
  const { language } = profile;
  const { report } = plan;
  const cap = readBudgetCap(question);
  if (cap !== undefined || isBudgetQuestion(question)) {
    return formatBudgetOptions(cap ?? profile.monthlyBudgetInr, language);
  }
  const claims = buildGroundedClaims(profile, report);
  const aqMissing = isAqMissing(report);
  if (PLANTS_QUESTION_RE.test(question)) {
    return buildPlantOfflineAnswer(claims, aqMissing, language);
  }
  if (aqMissing) return formatAqUnavailable(language);
  if (isWhatIfQuestion(question)) {
    const cmp = compareWhatIfFromBaseline(
      profile,
      report,
      buildOfflineAlternative(profile, question),
      extractReportLiveAq(report),
    );
    return `${cmp.explanation[language]} [AQ:SOURCE]`;
  }
  return buildDefaultOfflineAnswer(claims, question);
}

/** Explains why site-specific advice is withheld without a representative observation. */
export function formatAqUnavailable(language: LanguageCode): string {
  return language === 'hi'
    ? 'स्थानीय वायु गुणवत्ता उपलब्ध होने पर ही यहां के लिए खुराक और वेंटिलेशन सलाह दी जा सकती है। [AQ:SOURCE]'
    : 'Local air quality is unavailable. Local exposure and ventilation guidance require a representative observation. [AQ:SOURCE]';
}

/** Creates the localized, deterministic briefing heading. */
export function formatBriefingHeadline(profile: UserProfile, report: DeterministicReport): string {
  return profile.language === 'hi'
    ? `${report.city.nameHi} में घर की वायु सुरक्षा योजना`
    : `Household Air Protection Plan for ${report.city.name}`;
}

/** Builds action text without crediting unselected interventions with the current modeled dose. */
export function buildBriefingActions(profile: UserProfile, report: DeterministicReport) {
  const hi = profile.language === 'hi';
  const claims = buildGroundedClaims(profile, report);
  const ranked = rankIAQHacksByBudget(profile);
  const hacks = report.recommendedHacks.flatMap((id) => ranked.filter((hack) => hack.id === id));
  return new Map(hacks.map((hack) => {
    const title = hi ? hack.nameHi : hack.name;
    const guidance = hack.id === 'ventilation_window'
      ? claims.get('VENTILATION')
      : hi ? hack.instructionsHi : hack.instructions;
    return [hack.id, `${title}. ${guidance ?? ''}`];
  }));
}

/** Builds a deterministic EN/HI household action briefing. */
export function buildOfflineBriefing(profile: UserProfile, report: DeterministicReport) {
  const headline = formatBriefingHeadline(profile, report);
  const actions = buildBriefingActions(profile, report);
  const claims = buildGroundedClaims(profile, report);
  const summary = report.aqStatus === 'unavailable' || report.aqStatus === 'pending'
    ? formatAqUnavailable(profile.language)
    : ['DOSE_BEFORE', 'DOSE_AFTER', 'INDOOR_PM25', 'AQ_SOURCE']
      .map((id) => claims.get(id)).join(' ');
  return { headline, summary, whyActions: [...actions.values()].slice(0, 3) };
}
