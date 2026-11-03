import { type Deck, type Localized } from '../core/model.js';

export interface TranslationProvider {
  name: string;
  translate(content: Localized, from: string, to: string, glossary: string[]): Promise<Localized>;
}
export function protectedTokens(text: string): string[] {
  return (text.match(/10\.\d{4,9}\/[^\s]+|\b\d+(?:[.,]\d+)?(?:\s?%|\s?(?:mg|kg|mL|µL|mm|µm|Hz|h|min|s)\b)?|\b(?:p|n)\s*[<=>≤≥]\s*\d+(?:[.,]\d+)?/g) ?? []).sort();
}
export function consistency(source: Localized, translated: Localized, glossary: string[]) {
  // Compare each field separately: a number moved from notes into a title still needs review.
  const issues: string[] = [];
  for (const key of ['title', 'message', 'body', 'notes', 'caption', 'alt', 'labels', 'seriesNames'] as const) {
    const original = Array.isArray(source[key]) ? source[key].join('\n') : source[key];
    const target = Array.isArray(translated[key]) ? translated[key].join('\n') : translated[key];
    if (JSON.stringify(protectedTokens(original)) !== JSON.stringify(protectedTokens(target))) issues.push(`${key}: numbers, units, DOI or statistical notation differ`);
    for (const term of glossary) if (original.includes(term) && !target.includes(term)) issues.push(`${key}: protected term missing: ${term}`);
    if (original.trim() && !target.trim()) issues.push(`${key}: translation omitted source content`);
  }
  return issues;
}
export function translationRequest(deck: Deck, from: string, to: string, glossary: string[]) {
  return {
    version: 1, from, to, glossary,
    instructions: 'Supply a complete localized object per slide. Preserve stable IDs, numbers, units, references and protected terms. No network request has been made. Import via translate --file FILE.',
    slides: deck.slides.filter(s => !s.content[to]).map(s => ({ id: s.id, source: s.content[from], translation: null }))
  };
}
