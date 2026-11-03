import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { deckSchema, localizedSchema, projectSchema, themeSchema, type Localized } from '../src/core/model.js';
import { consistency, fictionalDataDisclosure, protectedTokens, translationRequest } from '../src/localization/index.js';
import { validateContent, validatePptx } from '../src/validation/index.js';
import { drawSlide } from '../src/layouts/index.js';
import { demoDeck } from '../src/content/demo.js';

const exec = promisify(execFile), repo = process.cwd();
let sandbox: string;
const config = projectSchema.parse({ version: 1, title: 'Scientific safeguards', source_locale: 'en-US', output_locales: ['en-US', 'fr-FR'] });
const original = localizedSchema.parse({ title: 'Workflow', notes: 'Dose change: -8 mg.', labels: ['Read', 'Check', 'Review', 'Share'] });
const translated = localizedSchema.parse({ title: 'Processus', notes: 'Variation de dose : -8 mg.', labels: ['Lire', 'Vérifier', 'Relire', 'Partager'] });

beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pptimistic-scientific-'));
  await fs.cp(path.join(repo, 'config'), path.join(sandbox, 'config'), { recursive: true });
});
afterAll(async () => { await fs.rm(sandbox, { recursive: true, force: true }); });

async function cli(...args: string[]) {
  try {
    const result = await exec(process.execPath, ['--import', pathToFileURL(path.join(repo, 'node_modules/tsx/dist/loader.mjs')).href, path.join(repo, 'src/cli/index.ts'), ...args], { cwd: sandbox, timeout: 60000 });
    return { code: 0, output: result.stdout + result.stderr };
  } catch (error) {
    const result = error as { code: number; stdout: string; stderr: string };
    return { code: result.code, output: result.stdout + result.stderr };
  }
}

describe('scientific translation fidelity', () => {
  test('signed values and signed exponents are protected, with equivalent minus typography allowed', () => {
    expect(protectedTokens('-8 mg; +8 mg; −0.5; -1e-3; p < 0.05')).toEqual(['+8 mg', '-0.5', '-1e-3', '-8 mg', 'p < 0.05']);
    expect(consistency(original, { ...translated, notes: 'Variation : 8 mg.' }, [])).toContain('notes: numbers, units, DOI or statistical notation differ');
    expect(consistency(original, { ...translated, notes: 'Variation : −8 mg.' }, [])).toEqual([]);
  });

  test('array completeness preserves individual nonempty entries and allows translated reordering', () => {
    const source = { ...original, labels: ['Arm 1', 'Arm 2'], seriesNames: ['Dose A', 'Dose B'] };
    const valid = { ...translated, labels: ['Groupe 1', 'Groupe 2'], seriesNames: ['Dose B', 'Dose A'] };
    expect(consistency(source, valid, [])).toEqual([]);
    for (const key of ['labels', 'seriesNames'] as const) {
      expect(consistency(source, { ...valid, [key]: [valid[key][0]] }, []).join('; ')).toContain(`${key}: translation must retain every array element`);
      expect(consistency(source, { ...valid, [key]: [valid[key][0], '   '] }, []).join('; ')).toContain(`${key}: translation must preserve nonempty array elements`);
    }
  });

  test('protected array tokens cannot move between labels or indexed series', () => {
    for (const key of ['labels', 'seriesNames'] as const) {
      const source = { ...original, [key]: ['Control 1', 'Drug 2'] };
      const target = { ...translated, [key]: ['Contrôle 2', 'Médicament 1'] };
      expect(consistency(source, target, [])).toContain(`${key}[0]: numbers, units, DOI or statistical notation differ`);
      expect(consistency(source, target, [])).toContain(`${key}[1]: numbers, units, DOI or statistical notation differ`);
    }
  });

  test.each([
    { name: 'lost-minus', change: (value: Localized) => { value.notes = 'Variation : 8 mg.'; }, problem: 'numbers, units' },
    { name: 'reversed-sign', change: (value: Localized) => { value.notes = 'Variation : +8 mg.'; }, problem: 'numbers, units' },
    { name: 'missing-workflow-step', change: (value: Localized) => { value.labels.pop(); }, problem: 'retain every array element' },
    { name: 'empty-workflow-step', change: (value: Localized) => { value.labels[2] = ' '; }, problem: 'preserve nonempty array elements' }
  ])('build and translation import reject $name without changing source', async ({ name, change, problem }) => {
    const dir = path.join(sandbox, 'projects', name), contentFile = path.join(dir, 'content/slides.yaml');
    await fs.mkdir(path.dirname(contentFile), { recursive: true });
    await fs.writeFile(path.join(dir, 'project.yaml'), YAML.stringify(config));
    const target = structuredClone(translated); change(target);
    const deck = deckSchema.parse({ version: 1, slides: [{ id: 'Workflow', layout: 'workflow', evidence: 'conceptual', content: { 'en-US': original, 'fr-FR': target } }] });
    await fs.writeFile(contentFile, YAML.stringify(deck));
    const build = await cli('build', '--project', name);
    expect(build.code).not.toBe(0); expect(build.output).toContain(problem);
    expect((await fs.readdir(path.join(dir, 'output'))).some(file => file.endsWith('.pptx'))).toBe(false);
    deck.slides[0].content['fr-FR'] = structuredClone(translated);
    await fs.writeFile(contentFile, YAML.stringify(deck));
    const before = await fs.readFile(contentFile, 'utf8');
    const request = path.join(sandbox, `${name}.translation.yaml`);
    await fs.writeFile(request, YAML.stringify({ version: 1, from: 'en-US', to: 'fr-FR', slides: [{ id: 'Workflow', translation: target }] }));
    const imported = await cli('translate', '--project', name, '--to', 'fr-FR', '--file', request);
    expect(imported.code).not.toBe(0); expect(imported.output).toContain(problem);
    expect(await fs.readFile(contentFile, 'utf8')).toBe(before);
  });
});

describe('fictional chart disclosure', () => {
  test.each(['en-US', 'fr-FR'])('actual %s PPTX retains a native visible disclosure after chart prose is edited or removed', async locale => {
    const theme = themeSchema.parse(YAML.parse(await fs.readFile(path.join(repo, 'config/themes/editorial-minimal.yaml'), 'utf8')));
    const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
    for (const caption of ['', 'Author supplied caption']) {
      const chart = structuredClone(demoDeck('Test').slides[3]);
      const content = chart.content[locale];
      Object.assign(content, { title: 'Chart', message: 'Author supplied claim', caption });
      await drawSlide(pptx, chart, content, theme, locale, sandbox, 0);
    }
    const file = path.join(sandbox, `disclosure.${locale}.pptx`);
    await pptx.writeFile({ fileName: file });
    expect(await validatePptx(file, 2)).toEqual({ slides: 2, valid: true });
    const zip = await JSZip.loadAsync(await fs.readFile(file));
    for (const number of [1, 2]) {
      const xml = await zip.file(`ppt/slides/slide${number}.xml`)!.async('string');
      expect(xml).toContain(`<a:t>${fictionalDataDisclosure(locale)}</a:t>`);
      expect(xml).toContain('Author supplied claim');
    }
  });

  test('unsupported fictional-chart disclosure languages fail explicitly', async () => {
    const chart = structuredClone(demoDeck('Test').slides[3]);
    chart.content['it-IT'] = structuredClone(chart.content['en-US']);
    const theme = themeSchema.parse(YAML.parse(await fs.readFile(path.join(repo, 'config/themes/editorial-minimal.yaml'), 'utf8')));
    const issues = await validateContent(sandbox, { ...config, output_locales: ['it-IT'] }, { version: 1, slides: [chart] }, theme);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'fictional-disclosure', severity: 'error', locale: 'it-IT' }));
    expect(fictionalDataDisclosure('it-IT')).toBeUndefined();
    chart.content['it-IT'].fictionalNotice = '   ';
    expect(await validateContent(sandbox, { ...config, output_locales: ['it-IT'] }, { version: 1, slides: [chart] }, theme)).toContainEqual(expect.objectContaining({ code: 'fictional-disclosure' }));
    chart.content['it-IT'].fictionalNotice = 'Dati fittizi — solo dimostrazione';
    const reviewedNotice = await validateContent(sandbox, { ...config, output_locales: ['it-IT'] }, { version: 1, slides: [chart] }, theme);
    expect(reviewedNotice.filter(issue => issue.severity === 'error')).toEqual([]);
    expect(reviewedNotice).toContainEqual(expect.objectContaining({ code: 'translation-untracked', severity: 'warning' }));
    expect(fictionalDataDisclosure('it-IT', '  Dati fittizi  ')).toBe('Dati fittizi');
    expect(fictionalDataDisclosure('en-US', 'Author edited text')).toBe('Fictional data — demonstration only');
    expect(fictionalDataDisclosure('fr-FR', 'Author edited text')).toBe('Données fictives — démonstration uniquement');
  });

  test('Italian fictional notice survives manual translation import and appears in the built PPTX', async () => {
    const name = 'italian-notice', dir = path.join(sandbox, 'projects', name), contentFile = path.join(dir, 'content/slides.yaml');
    await fs.mkdir(path.dirname(contentFile), { recursive: true });
    await fs.writeFile(path.join(dir, 'project.yaml'), YAML.stringify({ ...config, output_locales: ['en-US'] }));
    const chart = structuredClone(demoDeck('Test').slides[3]);
    delete chart.content['fr-FR']; chart.content['en-US'].caption = '';
    const deck = { version: 1 as const, slides: [chart] };
    await fs.writeFile(contentFile, YAML.stringify(deck));
    expect(translationRequest(deck, 'en-US', 'it-IT', []).instructions).toContain('fictionalNotice');
    expect(translationRequest(deck, 'en-US', 'it-IT', []).slides[0].required_localized_fields).toEqual(['fictionalNotice']);
    expect(translationRequest(deck, 'en-US', 'fr-FR', []).slides[0]).not.toHaveProperty('required_localized_fields');
    const target = localizedSchema.parse({
      title: 'Dati di esempio', message: 'Confronto illustrativo.', body: 'Grafico dimostrativo.', notes: 'Esempio senza inferenze scientifiche.',
      caption: '', alt: 'Valori fittizi: esempio A, 12; esempio B, 19; esempio C, 15. Solo dimostrazione, senza inferenze scientifiche.', labels: ['Esempio A', 'Esempio B', 'Esempio C'], seriesNames: ['Valori fittizi'],
      fictionalNotice: 'Dati fittizi — solo dimostrazione'
    });
    const request = path.join(sandbox, 'italian-notice.translation.yaml');
    const incomplete = structuredClone(target); delete incomplete.fictionalNotice;
    const before = await fs.readFile(contentFile, 'utf8');
    await fs.writeFile(request, YAML.stringify({ version: 1, from: 'en-US', to: 'it-IT', slides: [{ id: chart.id, translation: incomplete }] }));
    const rejected = await cli('translate', '--project', name, '--to', 'it-IT', '--file', request);
    expect(rejected.code).not.toBe(0); expect(rejected.output).toContain('fictionalNotice');
    expect(await fs.readFile(contentFile, 'utf8')).toBe(before);
    await fs.writeFile(request, YAML.stringify({ version: 1, from: 'en-US', to: 'it-IT', slides: [{ id: chart.id, translation: target }] }));
    const imported = await cli('translate', '--project', name, '--to', 'it-IT', '--file', request);
    expect(imported.output).not.toContain('Error:'); expect(imported.code).toBe(0);
    expect(YAML.parse(await fs.readFile(contentFile, 'utf8')).slides[0].content['it-IT'].fictionalNotice).toBe(target.fictionalNotice);
    const built = await cli('build', '--project', name, '--locale', 'it-IT');
    expect(built.output).not.toContain('Error:'); expect(built.code).toBe(0);
    const file = path.join(dir, 'output/presentation.it-IT.pptx');
    expect(await validatePptx(file, 1)).toEqual({ slides: 1, valid: true });
    const zip = await JSZip.loadAsync(await fs.readFile(file));
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain(`<a:t>${target.fictionalNotice}</a:t>`);
  });

  test('explicit custom notices retain protected scientific tokens when translated', () => {
    const source = { ...original, fictionalNotice: 'DVC fictional example 8 mg' };
    const target = { ...translated, fictionalNotice: 'DVC dati fittizi 80 mg' };
    expect(consistency(source, target, ['DVC'])).toContain('fictionalNotice: numbers, units, DOI or statistical notation differ');
    expect(consistency(source, translated, ['DVC'])).toEqual([]); // Automatic target notice may be used.
  });
});
