/**
 * Localized bilingual routine templates per persona for SmogWise Virtual.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import type { PersonaType } from './types.js';

/** Bilingual English/Hindi string pair. */
export interface LocalizedCopy {
  readonly en: string;
  readonly hi: string;
}

/** Routine headline and slot copy for a single user persona. */
export interface PersonaRoutineCopy {
  readonly morningTitle: LocalizedCopy;
  readonly morningDesc: LocalizedCopy;
  readonly afternoonTitle: LocalizedCopy;
  readonly eveningTitle: LocalizedCopy;
  readonly eveningDesc: LocalizedCopy;
  readonly nightTitle: LocalizedCopy;
}

/** Bilingual morning-to-night copy keyed by persona ID. */
export const PERSONA_ROUTINE_COPY: Readonly<Record<PersonaType, PersonaRoutineCopy>> = {
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
      en: 'Kids Bedroom Night Recovery (<= 30 ug/m3)',
      hi: 'बच्चों के बेडरूम की रात की सुरक्षा (<= 30 ug/m3)',
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
      en: 'Clean-Air Sleep Sanctuary (<= 30 ug/m3)',
      hi: 'स्वच्छ हवा शयनकक्ष (<= 30 ug/m3 लक्ष्य)',
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
      en: 'Overnight Apartment Filtration (<= 30 ug/m3)',
      hi: 'रात भर फ्लैट इनडोर सुरक्षा (<= 30 ug/m3)',
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
      en: 'Post-Commute Bedroom Recovery (<= 30 ug/m3)',
      hi: 'यात्रा के बाद बेडरूम रिकवरी (<= 30 ug/m3)',
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
      en: 'Student Sleep Recovery (<= 30 ug/m3 Target)',
      hi: 'छात्र रात्रि विश्राम सुरक्षा (<= 30 ug/m3)',
    },
  },
};
