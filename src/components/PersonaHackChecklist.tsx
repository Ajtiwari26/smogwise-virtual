/**
 * Accessible budget-ranked indoor air quality intervention checklist for PersonaForm.
 */

import React from 'react';
import type { IAQHackDetail, IAQHackId, LanguageCode } from '../domain/types.js';

/** Budget-sorted indoor air quality intervention checkbox list inside a semantic fieldset. */
export const HackChecklist: React.FC<{
  readonly hacks: readonly IAQHackDetail[];
  readonly language: LanguageCode;
  readonly onToggle: (hackId: IAQHackId) => void;
}> = React.memo(function HackChecklist({ hacks, language, onToggle }) {
  const isHi = language === 'hi';
  return (
    <fieldset className="mt-4 border-t border-slate-300 pt-4">
      <legend className="text-sm font-bold text-slate-900">
        {isHi ? 'घर की हवा सुधारने के उपाय (IAQ Hacks)' : 'Active Indoor Air Quality (IAQ) Hacks'}
      </legend>
      <div className="mt-2 space-y-2">
        {hacks.map((hack) => {
          const inputId = `hack-${hack.id}`;
          return (
            <div
              key={hack.id}
              className="flex items-start gap-2.5 rounded-md border border-slate-400 bg-slate-50 p-2.5 hover:bg-slate-100"
            >
              <input
                id={inputId}
                type="checkbox"
                checked={hack.isActive}
                onChange={() => onToggle(hack.id)}
                className="mt-1 h-4 w-4 rounded border-slate-500 text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-700"
              />
              <label htmlFor={inputId} className="flex-1 cursor-pointer text-xs text-slate-900">
                <span className="block font-semibold">
                  {isHi ? hack.nameHi : hack.name} · ₹{hack.monthlyCostInr}/mo
                </span>
                <span className="block text-slate-700">
                  {isHi ? (hack.doseImpactLabelHi ?? hack.doseImpactLabel) : hack.doseImpactLabel}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
});
