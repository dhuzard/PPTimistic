import { createHash } from 'node:crypto';
import { deckSchema, localizedSchema, type Deck, type Localized, type Slide } from '../core/model.js';

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
/** Review metadata never participates in the wording that was reviewed. */
export function translationSourceFingerprint(slide: Slide, from: string): string {
  const source = slide.content[from];
  if (!source) throw new Error(`${slide.id}: missing source content for ${from}`);
  const { review: _review, source_fingerprint: _fingerprint, ...text } = source;
  // Use a fixed field order, independently of the order of keys in authored YAML.
  const wording = Object.fromEntries(Object.entries(text).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify({ version: 1, from, wording,
    chart: slide.chart ?? null, citations: slide.citations })).digest('hex');
}

export function translationFreshness(slide: Slide, from: string, to: string) {
  const source_fingerprint = translationSourceFingerprint(slide, from);
  const target = slide.content[to];
  const state = !target ? 'missing' : !target.source_fingerprint ? 'untracked'
    : target.source_fingerprint === source_fingerprint ? 'current' : 'stale';
  // A stored approval never represents approval of different source wording.
  // Keep the original protection state intact; this is the effective review status.
  return { state, review: state === 'current' ? target.review : 'review' as const, source_fingerprint };
}

/** Validate the entire batch before returning an updated copy for persistence. */
export function importTranslations(deck: Deck, from: string, to: string, glossary: string[], batch: unknown, authorized: string[] = []): Deck {
  if (from === to) throw new Error('Target must differ from source locale.');
  const request = batch as { from?: unknown; to?: unknown; slides?: unknown } | null;
  if (!request || request.to !== to || request.from !== from || !Array.isArray(request.slides)) throw new Error('Translation file must declare matching from/to locales and slides.');
  const updated = structuredClone(deck);
  const seen = new Set<string>();
  for (const item of request.slides) {
    const entry = item as { id?: unknown; translation?: unknown; source_fingerprint?: unknown } | null;
    const slide = updated.slides.find(s => s.id === entry?.id);
    if (!slide || seen.has(slide.id)) throw new Error(`Unknown or duplicate slide ID: ${entry?.id}`);
    seen.add(slide.id);
    const target = localizedSchema.parse(entry!.translation);
    if ((slide.locked || ['approved', 'locked'].includes(slide.status) || ['approved', 'locked'].includes(slide.content[to]?.review)) && !authorized.includes(slide.id)) throw new Error(`${slide.id}: protected translation requires --authorize ${slide.id}`);
    const fingerprint = translationSourceFingerprint(slide, from);
    if (entry!.source_fingerprint !== undefined && entry!.source_fingerprint !== fingerprint) throw new Error(`${slide.id}: source changed since this translation request; prepare a new request and review the translation.`);
    const problems = consistency(slide.content[from], target, glossary);
    if (problems.length) throw new Error(`${slide.id}: ${problems.join('; ')}`);
    if (slide.chart?.fictional && !fictionalDataDisclosure(to, target.fictionalNotice)) throw new Error(`${slide.id}: fictional chart requires a reviewed localized fictionalNotice for ${to}; translation import was not saved.`);
    slide.content[to] = { ...target, source_fingerprint: fingerprint };
  }
  if (updated.slides.some(s => !s.content[to])) throw new Error('Translation import is incomplete; no changes saved.');
  return deckSchema.parse(updated);
}

export function translationRequest(deck: Deck, from: string, to: string, glossary: string[]) {
  return {
    version: 1, from, to, glossary,
    instructions: 'Supply a complete localized object for each listed slide. Retain source_fingerprint so import can reject a request after its source changes. Preserve stable IDs, numbers, units, references and protected terms. Existing translations are supplied for review, never as automatic translations. For fictional charts outside English/French, supply fictionalNotice with a reviewed localized fictional-data disclosure. No network request has been made. Import via translate --file FILE.',
    slides: deck.slides.filter(s => translationFreshness(s, from, to).state !== 'current').map(s => ({ id: s.id, source: s.content[from], translation: null,
      source_fingerprint: translationSourceFingerprint(s, from), freshness: translationFreshness(s, from, to).state,
      shared: { chart: s.chart ?? null, citations: s.citations },
      ...(s.content[to] ? { existing_translation: { ...s.content[to], review: 'review' } } : {}),
      ...(s.chart?.fictional && !fictionalDataDisclosure(to) ? { required_localized_fields: ['fictionalNotice'] } : {}) }))
  };
}
