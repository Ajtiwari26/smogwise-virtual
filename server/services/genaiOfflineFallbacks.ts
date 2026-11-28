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
const DASH = '\\p{Pd}\\u2212';
const COMPOUND_GAP = `\\s*(?:[${DASH}]\\s*)?`;
const TWO_WHEELERS = `two${COMPOUND_GAP}wheelers?`;
const HI_PRE = '(?<![\\p{L}\\p{M}])';
const HI_END = '(?![\\p{L}\\p{M}])';
const HI_BUS_SEPARATOR = `(?:\\s*[\\p{Pi}\\p{Pf}\\p{Pe}"'\`*_,${DASH}]+\\s*|\\s+)`;
const HI_TAKE_AUX =
  '(?:ल(?:ू[ँं]|ें|े|ो)|सक(?:[ाी]|त[ाीे]|ू[ँं](?:ग[ाीे])?|े[ँं]?(?:ग[ाीे])?)|' +
  'पा(?:य[ाीे]|त[ाीे]|ऊ[ँं](?:ग[ाीे])?|ए[ँं]?(?:ग[ाीे])?))';
const HI_BUS_POST =
  '(?:से|में|पर|द्वारा|वाला|वाली|वाले|यात्रा|सफर|पास|कम्यूट|स्टॉप|' +
  `क(?:ा\\s+(?:इस्तेमाल|उपयोग|प्रयोग|सफर|सफ़र|विकल्प)|ी\\s+सवारी)|` +
  `ले(?:न[ाीे]|कर|\\s+${HI_TAKE_AUX})|ल(?:ू[ँं]|ें)|` +
  'पकड़(?:न[ाीे]|कर|ूँ|ूं|ें)?|चढ़(?:न[ाीे]|कर|ूँ|ूं|ें)?|' +
  'चला(?:न[ाीे]|ऊँ|ऊं|एं|एँ)?|बदल(?:न[ाीे]|ूँ|ूं|ें)?|चुन(?:न[ाीे]|ूँ|ूं|ें)?)';
const HI_BUS_TERM =
  `${HI_PRE}(?:(?:सिटी|पब्लिक|सरकारी|इलेक्ट्रिक)\\s+बस|` +
  `मेट्रो(?:\\s*[/,]\\s*|\\s+(?:या|व|और)\\s+)बस|बस${HI_BUS_SEPARATOR}${HI_BUS_POST})${HI_END}`;
const EV_NOUNS =
  '(?:bus(?:es)?|cars?|vehicles?|bikes?|scooters?|cycles?|autos?|' +
  `rickshaws?|metros?|trains?|${TWO_WHEELERS})\\b`;
const ELECTRIC_COOK_TERM = `\\belectric\\b(?![${DASH}\\s]+${EV_NOUNS})`;
const EN_COMMUTE =
  '\\b(?:commut(?:e|ing|er)|carpool(?:ing|s)?|metro|bus(?:es)?|' +
  `petrol|wfh|walk(?:ing|s)?|${TWO_WHEELERS})\\b`;
const COMMUTE_WHAT_IF_RE = new RegExp(
  `${EN_COMMUTE}|${HI_PRE}(?:आवागमन|यातायात|पैदल|मेट्रो|कारपूल)${HI_END}|${HI_BUS_TERM}`,
  'iu',
);
const FUEL_WHAT_IF_RE = new RegExp(
  `\\b(?:cook(?:ing|s)?|fuels?|stoves?|chulhas?|induction|lpg|biomass)\\b|` +
  `${ELECTRIC_COOK_TERM}|${HI_PRE}(?:ईंधन|चूल्ह[ाे]|रसोई|इंडक्शन|एलपीजी|स्टोव)${HI_END}`,
  'iu',
);
const GENERIC_WHAT_IF_RE = new RegExp(`\\bwhat${COMPOUND_GAP}if\\b|तुलना`, 'iu');

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
  { value: 'wfh_walk', re: new RegExp(`\\b(?:wfh|walk(?:ing|s)?)\\b|${HI_PRE}पैदल${HI_END}`, 'iu') },
  {
    value: 'metro_bus',
    re: new RegExp(`\\b(?:metro|bus(?:es)?)\\b|${HI_PRE}मेट्रो${HI_END}|${HI_BUS_TERM}`, 'iu'),
  },
  { value: 'carpool', re: new RegExp(`\\bcarpool(?:ing|s)?\\b|${HI_PRE}कारपूल${HI_END}`, 'iu') },
  { value: 'two_wheeler', re: new RegExp(`\\b${TWO_WHEELERS}\\b`, 'iu') },
  { value: 'petrol_car', re: /\bpetrol\b/iu },
];

const FUEL_MATCHERS: readonly { readonly value: CookingFuel; readonly re: RegExp }[] = [
  {
    value: 'induction',
    re: new RegExp(`\\binduction\\b|${ELECTRIC_COOK_TERM}|${HI_PRE}इंडक्शन${HI_END}`, 'iu'),
  },
  { value: 'lpg', re: new RegExp(`\\blpg\\b|${HI_PRE}एलपीजी${HI_END}`, 'iu') },
  {
    value: 'biomass_chulha',
    re: new RegExp(`\\b(?:biomass|chulhas?)\\b|${HI_PRE}चूल्ह[ाे]${HI_END}`, 'iu'),
  },
];

const EXCLUSION_CLAUSE_RE = /\b(?:instead\s+of|rather\s+than)\s+[^,;.?!\n]+/giu;

function findFirstOption<T>(
  text: string,
  matchers: readonly { readonly value: T; readonly re: RegExp }[],
  current: T,
  preferDiff: boolean,
): T | undefined {
  const hits = matchers
    .map((m) => ({ value: m.value, idx: m.re.exec(text)?.index ?? -1 }))
    .filter((h) => h.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  const picked = preferDiff ? hits.find((h) => h.value !== current) : hits[0];
  return picked?.value;
}

function pickAlternativeOption<T>(
  current: T,
  question: string,
  matchers: readonly { readonly value: T; readonly re: RegExp }[],
  fallback: T,
): T {
  const positive = question.replace(EXCLUSION_CLAUSE_RE, ' ');
  const destination = /\b(?:to|into)\s+([^\n]+)/iu.exec(positive)?.[1];
  const scope = destination ?? positive;
  return (
    findFirstOption(scope, matchers, current, true) ??
    findFirstOption(scope, matchers, current, false) ??
    fallback
  );
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
