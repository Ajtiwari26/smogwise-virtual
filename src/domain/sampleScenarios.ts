/**
 * Curated realistic household and RWA sample scenarios for one-click exploration.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import type { UserProfile } from './types.js';

/** Named bilingual preset profile for rapid demo and scenario testing. */
export interface SampleScenario {
  readonly id: string;
  readonly labelEn: string;
  readonly labelHi: string;
  readonly profile: UserProfile;
}

/** Five curated Indian winter smog scenarios mapped to verified city preset IDs. */
export const SAMPLE_SCENARIOS: readonly SampleScenario[] = [
  {
    id: 'delhi_young_family',
    labelEn: 'Delhi Family (Anand Vihar)',
    labelHi: 'दिल्ली परिवार (आनंद विहार)',
    profile: {
      persona: 'young_family',
      cityId: 'delhi_anand_vihar',
      language: 'en',
      householdSize: 4,
      hasVulnerableMember: true,
      monthlyBudgetInr: 2500,
      roomVolumeM3: 110,
      commuteMode: 'metro_bus',
      commuteDistanceKm: 18,
      cookingFuel: 'lpg',
      activeHacks: ['window_sealing', 'wet_mopping', 'ventilation_window', 'n95_mask'],
    },
  },
  {
    id: 'lucknow_senior_hindi',
    labelEn: 'Lucknow Senior Citizen Home',
    labelHi: 'लखनऊ वरिष्ठ देखभाल (हिंदी)',
    profile: {
      persona: 'sensitive_household',
      cityId: 'lucknow_gomtinagar',
      language: 'hi',
      householdSize: 3,
      hasVulnerableMember: true,
      monthlyBudgetInr: 1800,
      roomVolumeM3: 95,
      commuteMode: 'wfh_walk',
      commuteDistanceKm: 4,
      cookingFuel: 'induction',
      activeHacks: [
        'window_sealing',
        'wet_mopping',
        'ventilation_window',
        'corsi_rosenthal_box',
      ],
    },
  },
  {
    id: 'gurugram_rwa_180',
    labelEn: 'Gurugram RWA (180 Flats)',
    labelHi: 'गुरुग्राम RWA (180 फ्लैट)',
    profile: {
      persona: 'rwa_coordinator',
      cityId: 'gurugram_dlf',
      language: 'en',
      householdSize: 4,
      hasVulnerableMember: false,
      monthlyBudgetInr: 4500,
      roomVolumeM3: 130,
      commuteMode: 'carpool',
      commuteDistanceKm: 22,
      cookingFuel: 'induction',
      activeHacks: ['window_sealing', 'ventilation_window', 'hepa_purifier', 'n95_mask'],
      rwaHouseholds: 180,
      rwaAdoptionRate: 0.65,
    },
  },
  {
    id: 'patna_clean_cooking',
    labelEn: 'Patna Chulha Transition',
    labelHi: 'पटना चूल्हा सुधार योजना',
    profile: {
      persona: 'young_family',
      cityId: 'patna_boring_road',
      language: 'en',
      householdSize: 5,
      hasVulnerableMember: true,
      monthlyBudgetInr: 900,
      roomVolumeM3: 85,
      commuteMode: 'two_wheeler',
      commuteDistanceKm: 12,
      cookingFuel: 'biomass_chulha',
      activeHacks: ['wet_mopping', 'ventilation_window', 'n95_mask'],
    },
  },
  {
    id: 'delhi_office_commuter',
    labelEn: 'Delhi Office Commuter (Anand Vihar)',
    labelHi: 'दिल्ली ऑफिस यात्री (आनंद विहार)',
    profile: {
      persona: 'office_commuter',
      cityId: 'delhi_anand_vihar',
      language: 'en',
      householdSize: 2,
      hasVulnerableMember: false,
      monthlyBudgetInr: 3000,
      roomVolumeM3: 80,
      commuteMode: 'two_wheeler',
      commuteDistanceKm: 24,
      cookingFuel: 'induction',
      activeHacks: ['window_sealing', 'ventilation_window', 'n95_mask', 'corsi_rosenthal_box'],
    },
  },
];
