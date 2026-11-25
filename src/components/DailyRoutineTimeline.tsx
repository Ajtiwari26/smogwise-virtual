import React from 'react';
import type { DailyRoutineBlock, LanguageCode } from '../domain/types.js';

/** Props for the DailyRoutineTimeline component. */
export interface DailyRoutineTimelineProps {
  readonly routine: readonly DailyRoutineBlock[];
  readonly optimalVentilationWindow: string;
  readonly language: LanguageCode;
  readonly indoorTargetCitation?: string;
  readonly plantsVsHepaCitation?: string;
}

/** Displays low-emission morning/afternoon/evening/night routine cards. */
export const DailyRoutineTimeline: React.FC<DailyRoutineTimelineProps> = React.memo(
  function DailyRoutineTimeline({
    routine,
    optimalVentilationWindow,
    language,
    indoorTargetCitation,
    plantsVsHepaCitation,
  }) {
    const isHi = language === 'hi';

    return (
      <section
        id="routine"
        aria-labelledby="routine-heading"
        className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="routine-heading" className="text-base font-bold text-slate-900">
            {isHi ? 'कम-उत्सर्जन दैनिक दिनचर्या' : 'Low-Emission Daily Routine'}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-xs font-semibold text-white">
              {isHi ? 'इनडोर लक्ष्य: < 30 ug/m3' : 'Indoor Target: < 30 ug/m3'}
              {indoorTargetCitation !== undefined ? ` [${indoorTargetCitation}]` : ''}
            </span>
            <span className="rounded-full bg-teal-800 px-2.5 py-0.5 text-xs font-semibold text-white">
              {isHi ? 'सर्वोत्तम वेंटिलेशन' : 'Best Ventilation'}: {optimalVentilationWindow}
            </span>
          </div>
        </div>

        <ol className="mt-3 space-y-2.5">
          {routine.map((block) => (
            <li
              key={block.id}
              className="rounded-md border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-teal-800">{block.timeRange}</span>
                <span className="text-xs font-medium text-slate-700">
                  {isHi ? 'बाहरी' : 'Out'}: {block.outdoorPm25} · {isHi ? 'इनडोर' : 'In'}:{' '}
                  {block.indoorPm25} ug/m3
                </span>
              </div>
              <h3 className="mt-1 text-sm font-bold text-slate-900">{block.title}</h3>
              <p className="mt-0.5 text-xs text-slate-800">{block.description}</p>
            </li>
          ))}
        </ol>

        <aside
          aria-label={isHi ? 'एयर प्यूरीफायर बनाम इनडोर पौधे विज्ञान नोट' : 'Purifier vs. Houseplants Advisory'}
          className="mt-3 rounded-md border border-slate-300 bg-slate-100 p-3 text-xs text-slate-900"
        >
          <p className="font-bold">
            {isHi
              ? 'वैज्ञानिक सलाह: HEPA / CR बॉक्स बनाम इनडोर पौधे'
              : 'Air Cleaning Reality Check: HEPA / CR Box vs. Houseplants'}
            {plantsVsHepaCitation !== undefined ? ` [${plantsVsHepaCitation}]` : ''}
          </p>
          <p className="mt-1 text-slate-800">
            {isHi
              ? 'गंभीर सर्दियों के स्मॉग में सामान्य इनडोर पौधे नगण्य PM2.5 घटाते हैं (CADR < 1 m³/घंटा); कमरे को < 30 ug/m3 पर रखने के लिए H13 HEPA प्यूरीफायर या DIY कोर्सी-रोसेंथल बॉक्स (CADR > 250 m³/घंटा) का उपयोग करें।'
              : 'Houseplants remove negligible PM2.5 during severe winter smog (CADR < 1 m³/h). Rely on a true H13 HEPA purifier or DIY Corsi-Rosenthal box (CADR > 250 m³/h) plus window sealing to hold indoor PM2.5 < 30 ug/m3.'}
          </p>
        </aside>
      </section>
    );
  },
);
