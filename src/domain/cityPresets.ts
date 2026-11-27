/**
 * Curated winter smog city presets for offline-resilient air quality modeling.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import type { CityPreset } from './types.js';

/** Geographic bounding box covering mainland and island India coordinates. */
export const INDIA_BOUNDS = {
  latMin: 6.5,
  latMax: 37.5,
  lonMin: 68.0,
  lonMax: 97.5,
} as const;

/** Returns true when finite latitude and longitude lie inside INDIA_BOUNDS. */
export function isWithinIndiaCoords(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= INDIA_BOUNDS.latMin &&
    lat <= INDIA_BOUNDS.latMax &&
    lon >= INDIA_BOUNDS.lonMin &&
    lon <= INDIA_BOUNDS.lonMax
  );
}

const DEFAULT_CITY_PRESET: CityPreset = {
  id: 'delhi_anand_vihar',
  name: 'Delhi (Anand Vihar)',
  nameHi: 'दिल्ली (आनंद विहार)',
  state: 'Delhi NCR',
  lat: 28.6469,
  lon: 77.316,
  baselinePm25: 315,
  baselinePm10: 460,
  baselineNo2: 92,
  grapStage: 'GRAP_IV',
};

/** Curated list of 12 winter inversion and urban smog city presets. */
export const CITY_PRESETS: readonly CityPreset[] = [
  DEFAULT_CITY_PRESET,
  {
    id: 'delhi_rohini',
    name: 'Delhi (Rohini)',
    nameHi: 'दिल्ली (रोहिणी)',
    state: 'Delhi NCR',
    lat: 28.7325,
    lon: 77.1199,
    baselinePm25: 285,
    baselinePm10: 420,
    baselineNo2: 84,
    grapStage: 'GRAP_IV',
  },
  {
    id: 'gurugram_dlf',
    name: 'Gurugram (DLF Phase 3)',
    nameHi: 'गुरुग्राम (डीएलएफ फेज 3)',
    state: 'Haryana',
    lat: 28.4946,
    lon: 77.0895,
    baselinePm25: 255,
    baselinePm10: 380,
    baselineNo2: 78,
    grapStage: 'GRAP_IV',
  },
  {
    id: 'noida_sec62',
    name: 'Noida (Sector 62)',
    nameHi: 'नोएडा (सेक्टर 62)',
    state: 'Uttar Pradesh',
    lat: 28.6279,
    lon: 77.3649,
    baselinePm25: 268,
    baselinePm10: 395,
    baselineNo2: 80,
    grapStage: 'GRAP_IV',
  },
  {
    id: 'lucknow_gomtinagar',
    name: 'Lucknow (Gomti Nagar)',
    nameHi: 'लखनऊ (गोमती नगर)',
    state: 'Uttar Pradesh',
    lat: 26.8467,
    lon: 80.9462,
    baselinePm25: 210,
    baselinePm10: 315,
    baselineNo2: 64,
    grapStage: 'GRAP_III',
  },
  {
    id: 'patna_boring_road',
    name: 'Patna (Boring Road)',
    nameHi: 'पटना (बोरिंग रोड)',
    state: 'Bihar',
    lat: 25.6154,
    lon: 85.118,
    baselinePm25: 235,
    baselinePm10: 345,
    baselineNo2: 68,
    grapStage: 'GRAP_III',
  },
  {
    id: 'kanpur_nehru_nagar',
    name: 'Kanpur (Nehru Nagar)',
    nameHi: 'कानपुर (नेहरू नगर)',
    state: 'Uttar Pradesh',
    lat: 26.4699,
    lon: 80.3218,
    baselinePm25: 228,
    baselinePm10: 335,
    baselineNo2: 70,
    grapStage: 'GRAP_III',
  },
  {
    id: 'kolkata_ballygunge',
    name: 'Kolkata (Ballygunge)',
    nameHi: 'कोलकाता (बालीगंज)',
    state: 'West Bengal',
    lat: 22.528,
    lon: 88.3659,
    baselinePm25: 168,
    baselinePm10: 255,
    baselineNo2: 58,
    grapStage: 'GRAP_II',
  },
  {
    id: 'mumbai_bandra',
    name: 'Mumbai (Bandra)',
    nameHi: 'मुंबई (बांद्रा)',
    state: 'Maharashtra',
    lat: 19.0596,
    lon: 72.8295,
    baselinePm25: 112,
    baselinePm10: 195,
    baselineNo2: 52,
    grapStage: 'GRAP_I',
  },
  {
    id: 'bengaluru_silk_board',
    name: 'Bengaluru (Silk Board)',
    nameHi: 'बेंगलुरु (सिल्क बोर्ड)',
    state: 'Karnataka',
    lat: 12.9177,
    lon: 77.6238,
    baselinePm25: 74,
    baselinePm10: 132,
    baselineNo2: 46,
    grapStage: 'NONE',
  },
  {
    id: 'ghaziabad_vasundhara',
    name: 'Ghaziabad (Vasundhara)',
    nameHi: 'गाजियाबाद (वसुंधरा)',
    state: 'Uttar Pradesh',
    lat: 28.661,
    lon: 77.372,
    baselinePm25: 278,
    baselinePm10: 410,
    baselineNo2: 83,
    grapStage: 'GRAP_IV',
  },
  {
    id: 'jaipur_adarsh_nagar',
    name: 'Jaipur (Adarsh Nagar)',
    nameHi: 'जयपुर (आदर्श नगर)',
    state: 'Rajasthan',
    lat: 26.898,
    lon: 75.826,
    baselinePm25: 185,
    baselinePm10: 290,
    baselineNo2: 58,
    grapStage: 'GRAP_II',
  },
];

const CITY_PRESET_MAP = new Map<string, CityPreset>(
  CITY_PRESETS.map((preset) => [preset.id, preset]),
);

const CITY_ALIAS_MAP: Readonly<Record<string, string>> = {
  anand_vihar: 'delhi_anand_vihar',
  delhi: 'delhi_anand_vihar',
  rohini: 'delhi_rohini',
  gurugram: 'gurugram_dlf',
  gurgaon: 'gurugram_dlf',
  noida: 'noida_sec62',
  lucknow: 'lucknow_gomtinagar',
  patna: 'patna_boring_road',
  kanpur: 'kanpur_nehru_nagar',
  kolkata: 'kolkata_ballygunge',
  mumbai: 'mumbai_bandra',
  bengaluru: 'bengaluru_silk_board',
  bangalore: 'bengaluru_silk_board',
  ghaziabad: 'ghaziabad_vasundhara',
  jaipur: 'jaipur_adarsh_nagar',
};

/**
 * Resolves a canonical city ID or shorthand alias to its matching CityPreset.
 * Falls back to Delhi (Anand Vihar) when an unknown ID is supplied.
 */
export function resolveCityPreset(cityId: string): CityPreset {
  const normalized = cityId.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const targetId = Object.hasOwn(CITY_ALIAS_MAP, normalized)
    ? (CITY_ALIAS_MAP[normalized] ?? normalized)
    : normalized;
  return CITY_PRESET_MAP.get(targetId) ?? DEFAULT_CITY_PRESET;
}

/**
 * Finds the nearest curated CityPreset for given coordinates using Euclidean degree distance.
 * Falls back to DEFAULT_CITY_PRESET when coordinates are non-finite.
 */
export function findNearestCityPreset(lat: number, lon: number): CityPreset {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return DEFAULT_CITY_PRESET;
  }
  let best = DEFAULT_CITY_PRESET;
  let minDistSq = Number.POSITIVE_INFINITY;
  for (const preset of CITY_PRESETS) {
    const dLat = preset.lat - lat;
    const dLon = preset.lon - lon;
    const distSq = dLat * dLat + dLon * dLon;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      best = preset;
    }
  }
  return best;
}
