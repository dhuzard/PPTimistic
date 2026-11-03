import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { deckSchema, projectSchema, themeSchema, type Deck } from '../src/core/model.js';
import { importTranslations, translationFreshness, translationRequest, translationSourceFingerprint } from '../src/localization/index.js';
import { validateContent, validatePptx } from '../src/validation/index.js';

const from = 'en-US', to = 'fr-FR', repo = process.cwd(), exec = promisify(execFile);
const config = projectSchema.parse({ version: 1, title: 'Translation review', source_locale: from, output_locales: [from, to] });
let sandbox: string;
beforeAll(async () => {
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pptimistic-translations-'));
  await fs.cp(path.join(repo, 'config'), path.join(sandbox, 'config'), { recursive: true });
});
afterAll(async () => { await fs.rm(sandbox, { recursive: true, force: true }); });

function sourceDeck() {
  return deckSchema.parse({ version: 1, slides: [
    { id: 'Text', layout: 'statement', evidence: 'conceptual', content: {
      [from]: { title: 'Review the procedure', notes: 'Dose -8 mg; p < 0.05.' },
      [to]: { title: 'Relire la procédure', notes: 'Dose -8 mg ; p < 0.05.' }
    } },
    { id: 'Workflow', layout: 'workflow', evidence: 'conceptual', content: {
      [from]: { title: 'Keep every step', labels: ['Read', 'Review'] },
      [to]: { title: 'Conserver chaque étape', labels: ['Lire', 'Relire'] }
    } },
    { id: 'Chart', layout: 'chart', evidence: 'conceptual', chart: { fictional: true, series: [{ values: [8, 9] }] }, content: {
      [from]: { title: 'Fictional example', alt: 'Fictional values: Group A 8, Group B 9. Demonstration only.', labels: ['Group A', 'Group B'], seriesNames: ['Dose'] },
      [to]: { title: 'Exemple fictif', alt: 'Valeurs fictives : groupe A 8, groupe B 9. Démonstration uniquement.', labels: ['Groupe A', 'Groupe B'], seriesNames: ['Dose'] }
    } }
  ] });
}
function batch(deck: Deck, ids = deck.slides.map(s => s.id)) {
  return { version: 1, from, to, slides: deck.slides.filter(s => ids.includes(s.id)).map(s => ({
    id: s.id, source_fingerprint: translationSourceFingerprint(s, from), translation: s.content[to]
  })) };
}
function reviewedDeck() { const deck = sourceDeck(); return importTranslations(deck, from, to, [], batch(deck)); }
async function cli(...args: string[]) {
  try {
    const result = await exec(process.execPath, ['--import', pathToFileURL(path.join(repo, 'node_modules/tsx/dist/loader.mjs')).href, path.join(repo, 'src/cli/index.ts'), ...args], { cwd: sandbox, timeout: 60000 });
    return { code: 0, output: result.stdout + result.stderr };
  } catch (error) { const result = error as { code: number; stdout: string; stderr: string }; return { code: result.code, output: result.stdout + result.stderr }; }
}

describe('reviewed translation source fingerprints', () => {
  test('wording-only edits invalidate only the affected slide without changing stored approvals or locks', async () => {
    const deck = reviewedDeck();
    deck.slides[0].content[to].review = 'locked';
    deck.slides[0].content[from].title = 'Review the revised procedure';
    expect(translationFreshness(deck.slides[0], from, to)).toMatchObject({ state: 'stale', review: 'review' });
    expect(deck.slides[0].content[to].review).toBe('locked');
    expect(translationRequest(deck, from, to, []).slides.map(s => s.id)).toEqual(['Text']);
    expect(translationFreshness(deck.slides[1], from, to).state).toBe('current');
    const theme = themeSchema.parse(YAML.parse(await fs.readFile(path.join(repo, 'config/themes/editorial-minimal.yaml'), 'utf8')));
    expect(await validateContent(sandbox, config, deck, theme)).toContainEqual(expect.objectContaining({ code: 'translation-stale', severity: 'error', slide: 'Text', locale: to }));
    expect(() => importTranslations(deck, from, to, [], batch(deck, ['Text']))).toThrow('protected translation');
    const updated = importTranslations(deck, from, to, [], batch(deck, ['Text']), ['Text']);
    expect(updated.slides[0].content[to].review).toBe('locked');
    expect(translationFreshness(updated.slides[0], from, to).state).toBe('current');
    expect(updated.slides.slice(1)).toEqual(deck.slides.slice(1));
  });

  test.each(['diagram-label', 'chart-label', 'chart-series', 'shared-chart-value'] as const)('%s changes require review without changing numbers, notation, or IDs', kind => {
    const deck = reviewedDeck(), before = structuredClone(deck);
    if (kind === 'diagram-label') deck.slides[1].content[from].labels[0] = 'Read the source';
    if (kind === 'chart-label') deck.slides[2].content[from].labels[0] = 'Treatment A';
    if (kind === 'chart-series') deck.slides[2].content[from].seriesNames[0] = 'Test dose';
    if (kind === 'shared-chart-value') deck.slides[2].chart!.series[0].values[0] = 10;
    const id = kind === 'diagram-label' ? 'Workflow' : 'Chart';
    expect(translationRequest(deck, from, to, []).slides.map(s => s.id)).toEqual([id]);
    const updated = importTranslations(deck, from, to, [], batch(deck, [id]));
    expect(updated.slides.map(s => s.id)).toEqual(before.slides.map(s => s.id));
    expect(updated.slides[0]).toEqual(before.slides[0]);
    expect(updated.slides[2].chart).toEqual(deck.slides[2].chart);
    expect(updated.slides.find(s => s.id === id)!.content[to].labels).toEqual(before.slides.find(s => s.id === id)!.content[to].labels);
    expect(translationRequest(updated, from, to, []).slides).toEqual([]);
  });

  test('review metadata does not invalidate source wording; legacy approvals are explicitly unverified', async () => {
    const deck = reviewedDeck();
    deck.slides[0].content[from].review = 'approved';
    deck.slides[0].layout = 'conclusion';
    expect(translationFreshness(deck.slides[0], from, to).state).toBe('current');
    delete deck.slides[0].content[to].source_fingerprint;
    deck.slides[0].content[to].review = 'approved';
    expect(translationFreshness(deck.slides[0], from, to)).toMatchObject({ state: 'untracked', review: 'review' });
    expect(translationRequest(deck, from, to, []).slides.map(s => s.id)).toEqual(['Text']);
    const theme = themeSchema.parse(YAML.parse(await fs.readFile(path.join(repo, 'config/themes/editorial-minimal.yaml'), 'utf8')));
    expect(await validateContent(sandbox, config, deck, theme)).toContainEqual(expect.objectContaining({ code: 'translation-untracked', severity: 'warning', slide: 'Text' }));
  });

  test('an outdated request and scientific-token changes fail atomically', () => {
    const deck = reviewedDeck(), request = batch(deck);
    deck.slides[1].content[from].title = 'A new source title';
    const before = structuredClone(deck);
    expect(() => importTranslations(deck, from, to, [], request)).toThrow('source changed since this translation request');
    expect(deck).toEqual(before);
    const updated = batch(deck);
    updated.slides[0].translation = { ...updated.slides[0].translation, notes: 'Dose 8 mg ; p < 0.05.' };
    expect(() => importTranslations(deck, from, to, [], updated)).toThrow('numbers, units');
    expect(deck).toEqual(before);
  });

  test('CLI blocks stale target exports and accepts a request for only the affected slide', async () => {
    const name = 'review', dir = path.join(sandbox, 'projects', name), content = path.join(dir, 'content/slides.yaml');
    await fs.mkdir(path.dirname(content), { recursive: true });
    await fs.writeFile(path.join(dir, 'project.yaml'), YAML.stringify(config));
    const deck = reviewedDeck();
    await fs.writeFile(content, YAML.stringify(deck));
    expect((await cli('build', '--project', name)).code).toBe(0);
    const pptx = path.join(dir, `output/presentation.${to}.pptx`), originalPptx = await fs.readFile(pptx);
    deck.slides[0].content[from].title = 'Review the revised procedure';
    await fs.writeFile(content, YAML.stringify(deck));
    const rejected = await cli('build', '--project', name);
    expect(rejected.code).not.toBe(0); expect(rejected.output).toContain('requires review');
    expect(await fs.readFile(pptx)).toEqual(originalPptx);
    expect((await cli('translate', '--project', name, '--to', to)).code).toBe(0);
    const requestFile = (await fs.readdir(path.dirname(content))).find(f => f.startsWith(`translation-request.${to}.`))!;
    const request = YAML.parse(await fs.readFile(path.join(path.dirname(content), requestFile), 'utf8'));
    expect(request.slides.map((s: { id: string }) => s.id)).toEqual(['Text']);
    request.slides[0].translation = { ...deck.slides[0].content[to], title: 'Relire la procédure révisée' };
    await fs.writeFile(path.join(sandbox, 'review.yaml'), YAML.stringify(request));
    const imported = await cli('translate', '--project', name, '--to', to, '--file', path.join(sandbox, 'review.yaml'));
    expect(imported.output).not.toContain('Error:'); expect(imported.code).toBe(0);
    const after = deckSchema.parse(YAML.parse(await fs.readFile(content, 'utf8')));
    expect(after.slides.slice(1)).toEqual(deck.slides.slice(1));
    expect((await cli('build', '--project', name)).code).toBe(0);
    expect(await validatePptx(pptx, 3)).toEqual({ slides: 3, valid: true });
  });
});
