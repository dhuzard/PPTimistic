import { type Deck, type Localized } from '../core/model.js';

export interface TranslationProvider {
  name: string;
  translate(content: Localized, from: string, to: string, glossary: string[]): Promise<Localized>;
}
export function protectedTokens(text: string): string[] {
  // Keep signs (including scientific notation) attached to their values. Normalize
  // the typographic minus so a harmless typography change does not change meaning.
  return (text.match(/10\.\d{4,9}\/[^\s]+|\b(?:p|n)\s*[<=>≤≥]\s*[+\-−]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+\-−]?\d+)?|(?<![\p{L}\p{N}_])[+\-−]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+\-−]?\d+)?(?:\s?%|\s?(?:mg|kg|mL|µL|mm|µm|Hz|h|min|s)\b)?/gu) ?? []).map(token => token.replaceAll('−', '-')).sort();
}

/** Mandatory visible safety text, independent of author-editable chart prose. */
export function fictionalDataDisclosure(locale: string, custom?: string): string | undefined {
  const language = new Intl.Locale(locale).language;
  return ({ en: 'Fictional data — demonstration only', fr: 'Données fictives — démonstration uniquement' } as Record<string, string>)[language] ?? (custom?.trim() || undefined);
}

export function consistency(source: Localized, translated: Localized, glossary: string[]) {
  // Compare each field separately: a number moved from notes into a title still needs review.
  const issues: string[] = [];
  for (const key of ['title', 'message', 'body', 'notes', 'caption', 'alt', 'labels', 'seriesNames', 'fictionalNotice'] as const) {
    // Built-in notices need no duplicate YAML text. Locale-aware content validation
    // requires a custom notice where no built-in exists; compare supplied notices.
    if (key === 'fictionalNotice' && (!source[key]?.trim() || !translated[key]?.trim())) continue;
    if (key === 'labels' || key === 'seriesNames') {
      if (source[key].length !== translated[key].length) issues.push(`${key}: translation must retain every array element (${source[key].length} expected, ${translated[key].length} supplied)`);
      if (source[key].some((entry, index) => Boolean(entry.trim()) !== Boolean(translated[key][index]?.trim()))) issues.push(`${key}: translation must preserve nonempty array elements`);
      // Chart labels and series names refer to values by position. Preserve their
      // scientific tokens in place even if the same tokens occur elsewhere.
      source[key].forEach((entry, index) => {
        if (JSON.stringify(protectedTokens(entry)) !== JSON.stringify(protectedTokens(translated[key][index] ?? ''))) issues.push(`${key}[${index}]: numbers, units, DOI or statistical notation differ`);
      });
    }
    // Ordinary wording may be translated or reordered without a vocabulary lock.
    const original = Array.isArray(source[key]) ? source[key].join('\n') : source[key] ?? '';
    const target = Array.isArray(translated[key]) ? translated[key].join('\n') : translated[key] ?? '';
    if (JSON.stringify(protectedTokens(original)) !== JSON.stringify(protectedTokens(target))) issues.push(`${key}: numbers, units, DOI or statistical notation differ`);
    for (const term of glossary) if (original.includes(term) && !target.includes(term)) issues.push(`${key}: protected term missing: ${term}`);
    if (original.trim() && !target.trim()) issues.push(`${key}: translation omitted source content`);
  }
  return issues;
}
export function translationRequest(deck: Deck, from: string, to: string, glossary: string[]) {
  return {
    version: 1, from, to, glossary,
    instructions: 'Supply a complete localized object per slide. Preserve stable IDs, numbers, units, references and protected terms. For fictional charts outside English/French, supply fictionalNotice with a reviewed localized fictional-data disclosure. No network request has been made. Import via translate --file FILE.',
    slides: deck.slides.filter(s => !s.content[to]).map(s => ({ id: s.id, source: s.content[from], translation: null,
      ...(s.chart?.fictional && !fictionalDataDisclosure(to) ? { required_localized_fields: ['fictionalNotice'] } : {}) }))
  };
}
