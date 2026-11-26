import React from 'react';
import type { LanguageCode, PersonaType } from '../domain/types.js';

/** Public Evaluator Sandbox Test Password matching server/config/authAccounts.ts. */
export const SANDBOX_DEMO_PASSCODE = 'SmogWise#Eval2026';

/** Evaluator sandbox account entry for 1-click sign-in and credential reference. */
export interface EvaluatorSandboxAccount {
  readonly email: string;
  readonly personaId: PersonaType;
  readonly labelEn: string;
  readonly labelHi: string;
  readonly cityEn: string;
}

/** Exact 5 pre-seeded evaluator accounts matching server/config/authAccounts.ts. */
export const EVALUATOR_SANDBOX_ACCOUNTS: readonly EvaluatorSandboxAccount[] = [
  {
    email: 'family.eval@smogwise.in',
    personaId: 'young_family',
    labelEn: 'Delhi Family',
    labelHi: 'दिल्ली परिवार',
    cityEn: 'Delhi (Anand Vihar)',
  },
  {
    email: 'senior.eval@smogwise.in',
    personaId: 'sensitive_household',
    labelEn: 'Lucknow Senior (HI)',
    labelHi: 'लखनऊ वरिष्ठ (हिन्दी)',
    cityEn: 'Lucknow (Gomti Nagar)',
  },
  {
    email: 'rwa.eval@smogwise.in',
    personaId: 'rwa_coordinator',
    labelEn: 'Gurugram RWA',
    labelHi: 'गुरुग्राम RWA',
    cityEn: 'Gurugram (DLF)',
  },
  {
    email: 'commuter.eval@smogwise.in',
    personaId: 'office_commuter',
    labelEn: 'Office Commuter',
    labelHi: 'ऑफिस यात्री',
    cityEn: 'Delhi Commuter',
  },
  {
    email: 'student.eval@smogwise.in',
    personaId: 'outdoor_student',
    labelEn: 'Outdoor Student',
    labelHi: 'बाहरी छात्र',
    cityEn: 'Kanpur Student',
  },
];

/** Props for EvaluatorSandboxCard. */
export interface EvaluatorSandboxCardProps {
  readonly language: LanguageCode;
  readonly isSubmitting: boolean;
  readonly onQuickLogin: (email: string, password: string) => void;
}

/** Renders 1-click evaluator login buttons and public sandbox credentials. */
export const EvaluatorSandboxCard: React.FC<EvaluatorSandboxCardProps> = React.memo(
  function EvaluatorSandboxCard({ language, isSubmitting, onQuickLogin }) {
    const isHi = language === 'hi';
    return (
      <section
        id="evaluator-access"
        aria-labelledby="evaluator-access-heading"
        className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm"
      >
        <h2 id="evaluator-access-heading" className="text-lg font-bold text-slate-900">
          {isHi
            ? '1-क्लिक मूल्यांकनकर्ता प्रवेश और परीक्षण विवरण'
            : '1-Click Evaluator Access & Test Credentials'}
        </h2>
        <p className="mt-1 text-sm text-slate-700">
          {isHi
            ? 'किसी भी सत्यापित डेमो प्रोफ़ाइल से सीधे डैशबोर्ड खोलें:'
            : 'Launch any pre-seeded persona workspace directly via the auth API:'}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {EVALUATOR_SANDBOX_ACCOUNTS.map((acc) => (
            <button
              key={acc.email}
              type="button"
              disabled={isSubmitting}
              onClick={() => onQuickLogin(acc.email, SANDBOX_DEMO_PASSCODE)}
              className="flex flex-col items-start rounded-lg border border-slate-400 bg-slate-50 px-3.5 py-2.5 text-left transition hover:border-teal-800 hover:bg-teal-50 focus-visible:ring-2 focus-visible:ring-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="text-sm font-bold text-slate-900">
                {isHi ? acc.labelHi : acc.labelEn}
              </span>
              <span className="text-xs font-medium text-slate-700">{acc.cityEn}</span>
              <span className="mt-0.5 font-mono text-xs text-teal-900">{acc.email}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-slate-400 bg-slate-100 p-3.5 text-xs text-slate-900">
          <p className="font-bold text-slate-900">
            {isHi ? 'सार्वजनिक मूल्यांकन सैंडबॉक्स पासवर्ड:' : 'Public Evaluator Sandbox Test Password:'}{' '}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold text-teal-900">
              {SANDBOX_DEMO_PASSCODE}
            </code>
          </p>
          <p className="mt-1.5 text-slate-700">
            {isHi ? 'उपलब्ध खाते:' : 'Available emails:'}{' '}
            {EVALUATOR_SANDBOX_ACCOUNTS.map((acc) => acc.email).join(' · ')}
          </p>
        </div>
      </section>
    );
  },
);

/** Props for SecurityHighlightsStrip. */
export interface SecurityHighlightsStripProps {
  readonly language: LanguageCode;
}

/** Renders gateway security architecture and CPCB GRAP readiness summary. */
export const SecurityHighlightsStrip: React.FC<SecurityHighlightsStripProps> = React.memo(
  function SecurityHighlightsStrip({ language }) {
    const isHi = language === 'hi';
    const items = [
      {
        title: isHi ? 'साल्टेड scrypt प्रमाणीकरण' : 'Salted scrypt Authentication',
        detail: isHi
          ? 'crypto.scryptSync और timingSafeEqual द्वारा सुरक्षित पासवर्ड सत्यापन।'
          : 'Constant-time password verification using salted scrypt and timingSafeEqual.',
      },
      {
        title: isHi ? 'HMAC-SHA256 HttpOnly सत्र' : 'HMAC-SHA256 HttpOnly Session',
        detail: isHi
          ? 'SameSite=Lax हस्ताक्षरित कुकी सत्र और सर्वर-साइड वरीयता सिंक।'
          : 'Signed HttpOnly SameSite=Lax cookie sessions with protected preference storage.',
      },
      {
        title: isHi
          ? 'CPCB AQI Very Poor / Severe GRAP गेटवे'
          : 'CPCB AQI Very Poor / Severe GRAP Gateway',
        detail: isHi
          ? 'CPCB Very Poor (301–400) और Severe (401+) स्तरों के लिए तत्परता व प्रॉम्प्ट-इंजेक्शन सुरक्षा।'
          : 'Winter smog protection for CPCB Very Poor and Severe AQI bands with prompt-injection defense.',
      },
    ] as const;

    return (
      <section
        id="security-features"
        aria-labelledby="security-features-heading"
        className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm"
      >
        <h2 id="security-features-heading" className="text-base font-bold text-slate-900">
          {isHi ? 'गेटवे सुरक्षा और CPCB तत्परता' : 'Gateway Security & CPCB Readiness'}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-slate-300 bg-slate-50 p-3.5 text-slate-900"
            >
              <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-700">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>
    );
  },
);
