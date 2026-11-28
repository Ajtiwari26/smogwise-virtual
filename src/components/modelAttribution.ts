/** Labels Gemini provenance without inventing a model family for missing metadata. */
export function formatGeminiLabel(model: string | undefined, isHi: boolean): string {
  const label = model === undefined ? 'Gemini' : ({
    'gemini-3.5-flash-lite': 'Gemini 3.5',
    'gemini-4-hydrogen': 'Gemini 4',
  }[model] ?? model);
  return isHi ? `${label} ग्राउंडेड` : `${label} Grounded`;
}
