import { afterAll, beforeAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import PptxGenJS from 'pptxgenjs';
import YAML from 'yaml';
import { demoDeck, ideaSvg } from '../src/content/demo.js';
import { deckSchema, layouts, projectSchema, themeSchema, type Deck, type Theme } from '../src/core/model.js';
import { drawSlide } from '../src/layouts/index.js';
import { finalizeAccessibility } from '../src/layouts/accessibility.js';
import { validateContent, validatePptx } from '../src/validation/index.js';

let sandbox: string, theme: Theme;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pptimistic-accessibility-'));
  await fs.mkdir(path.join(sandbox, 'assets/reference'), { recursive: true });
  await fs.writeFile(path.join(sandbox, 'assets/reference/idea.svg'), ideaSvg);
  theme = themeSchema.parse(YAML.parse(await fs.readFile('config/themes/editorial-minimal.yaml', 'utf8')));
});
afterAll(async () => { await fs.rm(sandbox, { recursive: true, force: true }); });

function fixture(): Deck {
  const demo = demoDeck('Accessibility fixture');
  return deckSchema.parse({ version: 1, slides: layouts.map((layout, index) => {
    const base = structuredClone(demo.slides[layout === 'chart' ? 3 : layout === 'workflow' || layout === 'diagram' ? 2 : 1]);
    base.id = `A${index + 1}`; base.layout = layout; base.citations = ['Public fixture citation'];
    for (const [locale, content] of Object.entries(base.content)) content.title = `${layout} · ${locale} · "A&B" <test> 'title' $&`;
    return base;
  }) });
}

for (const locale of ['en-US', 'fr-FR']) test(`actual ${locale} PPTX has native titles, logical order, descriptions and decorative flags in every layout`, async () => {
  const deck = fixture(), pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
  const geometry = [];
  for (const [index, slide] of deck.slides.entries()) geometry.push(await drawSlide(pptx, slide, slide.content[locale], theme, locale, sandbox, index));
  const file = path.join(sandbox, `accessibility.${locale}.pptx`);
  await pptx.writeFile({ fileName: file });
  const before = await JSZip.loadAsync(await fs.readFile(file));
  await finalizeAccessibility(file, geometry);
  expect(await validatePptx(file, layouts.length)).toEqual({ slides: layouts.length, valid: true });
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  for (const [index, slide] of deck.slides.entries()) {
    const xml = await zip.file(`ppt/slides/slide${index + 1}.xml`)!.async('string');
    const objects = [...xml.matchAll(/<p:(sp|pic|graphicFrame)\b[^>]*>[\s\S]*?<\/p:\1>/g)].map(match => ({ xml: match[0], type: match[1], properties: parser.parse(match[0].match(/<p:cNvPr\b[^>]*?(?:\/>|>[\s\S]*?<\/p:cNvPr>)/)![0])['p:cNvPr'] }));
    const names = objects.map(object => object.properties.name as string);
    expect(names).toEqual(geometry[index].accessibility!.map(object => object.name));
    expect(names[0]).toContain(`${slide.id}:title | ${slide.content[locale].title}`);
    expect(objects[0].xml).toContain('<p:ph type="title"/>');
    expect(objects[0].xml).toMatch(/<a:pPr[^>]*algn="l"/);
    expect(names.slice(-2)).toEqual([`${slide.id}:citation | Public fixture citation`, `${slide.id}:footer | ${String(index + 1).padStart(2, '0')} / ${slide.id}`]);
    expect(xml).toContain(`lang="${locale}"`);
    for (const object of objects) {
      if (object.properties.name.includes(':decoration-')) {
        expect(object.xml).toContain('adec:decorative');
        expect(object.xml).toContain('val="1"');
        expect(object.properties.descr).toBeUndefined();
      }
      if (object.type === 'pic' || object.type === 'graphicFrame') expect(object.properties.descr).toBe(slide.content[locale].alt);
      if (object.properties.name.includes(':connector-')) {
        const i = Number(object.properties.name.match(/:connector-(\d+)/)[1]);
        expect(object.properties.descr).toBe(`${slide.content[locale].labels[i]} → ${slide.content[locale].labels[i + 1]}`);
        expect(object.xml).not.toContain('adec:decorative');
      }
    }
  }
  // Metadata edits preserve all other package parts byte-for-byte, including
  // the native chart XML, embedded editable workbook, notes and image bytes.
  for (const name of Object.keys(before.files).filter(name => !before.files[name].dir && !/^ppt\/slides\/slide\d+\.xml$/.test(name))) {
    expect(await zip.file(name)!.async('nodebuffer')).toEqual(await before.file(name)!.async('nodebuffer'));
  }
  expect(Object.keys(zip.files).some(name => /^ppt\/charts\/chart\d+\.xml$/.test(name))).toBe(true);
  expect(Object.keys(zip.files).some(name => name.endsWith('.xlsx'))).toBe(true);
});

test('blank alt descriptions fail in each locale; chart captions cannot substitute, and image decoration is explicit', async () => {
  const deck = demoDeck('Descriptions');
  const config = projectSchema.parse({ version: 1, title: 'Descriptions', source_locale: 'en-US', output_locales: ['en-US', 'fr-FR'] });
  for (const slide of [deck.slides[1], deck.slides[3]]) for (const content of Object.values(slide.content)) content.alt = '  ';
  let errors = (await validateContent(sandbox, config, deck, theme)).filter(issue => issue.code === 'alt-text');
  expect(errors.map(issue => `${issue.slide}/${issue.locale}`).sort()).toEqual(['S002/en-US', 'S002/fr-FR', 'S004/en-US', 'S004/fr-FR']);
  expect(errors.every(issue => issue.severity === 'error')).toBe(true);
  deck.slides[1].visual!.decorative = true;
  errors = (await validateContent(sandbox, config, deck, theme)).filter(issue => issue.code === 'alt-text');
  expect(errors.map(issue => issue.slide)).toEqual(['S004', 'S004']);
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
  const geometry = await drawSlide(pptx, deck.slides[1], deck.slides[1].content['fr-FR'], theme, 'fr-FR', sandbox, 0);
  const file = path.join(sandbox, 'decorative.pptx'); await pptx.writeFile({ fileName: file });
  await finalizeAccessibility(file, [geometry]);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const picture = (await zip.file('ppt/slides/slide1.xml')!.async('string')).match(/<p:pic>[\s\S]*?<\/p:pic>/)![0];
  expect(picture).toContain('adec:decorative'); expect(picture).not.toMatch(/\bdescr=/);
});

test('title validation rejects blank titles and flags repeated titles for human review', async () => {
  const deck = demoDeck('Titles');
  const config = projectSchema.parse({ version: 1, title: 'Titles', source_locale: 'en-US', output_locales: ['en-US'] });
  deck.slides[0].content['en-US'].title = ' ';
  deck.slides[2].content['en-US'].title = deck.slides[1].content['en-US'].title;
  const issues = await validateContent(sandbox, config, deck, theme);
  expect(issues).toContainEqual(expect.objectContaining({ code: 'slide-title', severity: 'error', slide: 'S001' }));
  expect(issues).toContainEqual(expect.objectContaining({ code: 'duplicate-title', severity: 'warning', slide: 'S003' }));
});
