/**
 * Accessible one-click sample scenario preset bar in English and Hindi.
 */

import type { ReactElement } from 'react';
import { SAMPLE_SCENARIOS } from '../domain/sampleScenarios.js';
import type { LanguageCode, UserProfile } from '../domain/types.js';

/** Props for the ScenarioPresetBar component. */
export interface ScenarioPresetBarProps {
  readonly language: LanguageCode;
  readonly activeScenarioId: string | undefined;
  readonly onSelectScenario: (scenarioId: string, profile: UserProfile) => void;
}

/**
 * Renders curated Indian smog presets from SAMPLE_SCENARIOS.
 */
export function ScenarioPresetBar({
  language,
  activeScenarioId,
  onSelectScenario,
}: ScenarioPresetBarProps): ReactElement {
  const isHindi = language === 'hi';

  return (
    <div role="group" aria-label={isHindi ? 'त्वरित परिदृश्य नमूने' : 'Quick Sample Scenarios'}>
      <p className="mb-1.5 text-xs font-semibold text-slate-800">
        {isHindi ? 'त्वरित परिदृश्य चुनें:' : 'Try a Sample Household Scenario:'}
      </p>
      <div className="flex flex-wrap gap-2">
        {SAMPLE_SCENARIOS.map((scenario) => {
          const isPressed = activeScenarioId === scenario.id;
          const label = isHindi ? scenario.labelHi : scenario.labelEn;
          const btnClass = isPressed
            ? 'rounded-full border border-emerald-900 bg-emerald-900 px-3 py-1.5 ' +
              'text-xs font-semibold text-white shadow-sm focus-visible:outline-none ' +
              'focus-visible:ring-2 focus-visible:ring-teal-700'
            : 'rounded-full border border-slate-500 bg-white px-3 py-1.5 ' +
              'text-xs font-semibold text-slate-900 hover:bg-slate-100 ' +
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700';
          return (
            <button
              key={scenario.id}
              type="button"
              lang={isHindi ? 'hi' : undefined}
              aria-pressed={isPressed}
              onClick={() => onSelectScenario(scenario.id, scenario.profile)}
              className={btnClass}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
