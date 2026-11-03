import { z } from 'zod';

export const localeSchema = z.string().refine(s => {
  try { return Intl.getCanonicalLocales(s)[0] === s; } catch { return false; }
}, 'Use a canonical BCP 47 identifier, e.g. fr-FR or en-US');
export const layouts = ['title', 'statement', 'text-image', 'full-image', 'diagram', 'workflow', 'chart', 'comparison', 'conclusion'] as const;
export const localizedSchema = z.object({
  title: z.string().min(1), message: z.string().default(''), body: z.string().default(''),
  notes: z.string().default(''), caption: z.string().default(''), alt: z.string().default(''),
  labels: z.array(z.string()).default([]), seriesNames: z.array(z.string()).default([]),
  review: z.enum(['draft', 'review', 'approved', 'locked']).default('draft')
}).strict();
export const slideSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  layout: z.enum(layouts), status: z.enum(['draft', 'review', 'approved', 'locked']).default('draft'),
  locked: z.boolean().default(false), evidence: z.enum(['established', 'interpretation', 'hypothesis', 'conceptual', 'missing']).default('missing'),
  source_refs: z.array(z.string()).default([]), citations: z.array(z.string()).default([]),
  content: z.record(localeSchema, localizedSchema),
  visual: z.object({ asset: z.string().optional(), brief: z.string().default(''), accepted: z.boolean().default(false) }).strict().optional(),
  chart: z.object({
    fictional: z.boolean().default(false), data_ref: z.string().optional(),
    series: z.array(z.object({ values: z.array(z.number().finite()).min(1) })).min(1)
  }).strict().optional()
}).strict();
export const deckSchema = z.object({ version: z.literal(1), slides: z.array(slideSchema).min(1) }).strict();
export const projectSchema = z.object({
  version: z.literal(1), title: z.string().min(1), source_locale: localeSchema,
  output_locales: z.array(localeSchema).min(1), theme: z.string().regex(/^[a-z-]+$/).default('editorial-minimal'),
  content: z.string().default('content/slides.yaml'), font: z.string().optional(),
  glossary: z.array(z.string()).default([])
}).strict();
export const themeSchema = z.object({
  name: z.string(), background: z.string().regex(/^[A-Fa-f0-9]{6}$/),
  foreground: z.string().regex(/^[A-Fa-f0-9]{6}$/), secondary: z.string().regex(/^[A-Fa-f0-9]{6}$/),
  accent: z.string().regex(/^[A-Fa-f0-9]{6}$/), pale: z.string().regex(/^[A-Fa-f0-9]{6}$/),
  font: z.string(), heading: z.number().min(28).max(44), body: z.number().min(18).max(28),
  margin: z.number().min(0.5).max(0.9)
}).strict();
export type Slide = z.infer<typeof slideSchema>;
export type Localized = z.infer<typeof localizedSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type Deck = z.infer<typeof deckSchema>;
