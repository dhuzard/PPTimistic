import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claimSchema, deckSchema, projectSchema, themeSchema } from '../src/core/model.js';
import { ingest } from '../src/content/ingest.js';
import { validateContent } from '../src/validation/index.js';
import { writeYaml } from '../src/core/io.js';

let sandbox: string;
const config = projectSchema.parse({ version: 1, title: 'Claim traceability', source_locale: 'en-US', output_locales: ['en-US'] });
const theme = themeSchema.parse({ name: 'Test', background: 'FFFFFF', foreground: '111111', secondary: '222222', accent: '333333', pale: 'EEEEEE', font: 'Arial', heading: 32, body: 22, margin: .6 });
beforeAll(async () => { sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pptimistic-claims-')); });
afterAll(async () => { await fs.rm(sandbox, { recursive: true, force: true }); });

async function fixture(textSource = true) {
  const dir = await fs.mkdtemp(path.join(sandbox, 'project-'));
  await fs.mkdir(path.join(dir, 'inputs'));
  const sourceFile = path.join(dir, 'inputs', textSource ? 'study.txt' : 'figure.svg');
  await fs.writeFile(sourceFile, textSource ? 'The cohort received 8 mg.\n\nObserved value: 12 units.' : '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  const [source] = await ingest(dir);
  const deck = deckSchema.parse({ version: 1, slides: [{ id: 'S001', layout: 'statement', evidence: 'conceptual', source_refs: [source.id],
    content: { 'en-US': { title: 'Supplied observation', body: 'The cohort received 8 mg.' } },
    claims: [{ id: 'C001', field: 'body', source_ref: source.id, excerpt: 'The cohort\t received 8 mg.', locator: 'Paragraph 1' }]
  }] });
  return { dir, sourceFile, source, deck };
}

describe('opt-in claim-to-source traceability', () => {
  test('existing decks remain unchanged without opting into claims', () => {
    const deck = deckSchema.parse({ version: 1, slides: [{ id: 'S001', layout: 'statement', content: { 'en-US': { title: 'No claim links' } } }] });
    expect(deck.slides[0]).not.toHaveProperty('claims');
  });

  test('an ingested TXT excerpt matches literal text after whitespace normalization', async () => {
    const { dir, deck } = await fixture();
    expect(await validateContent(dir, config, deck, theme)).toEqual([]);
    // Links record traceability only: validation does not infer scientific truth.
    deck.slides[0].content['en-US'].body = 'Author wording requiring scientific review.';
    expect(await validateContent(dir, config, deck, theme)).toEqual([]);
  });

  test('wrong excerpt reports its stable claim ID and never fuzzy-matches a number', async () => {
    const { dir, deck } = await fixture();
    deck.slides[0].claims![0].excerpt = 'The cohort received 80 mg.';
    expect(await validateContent(dir, config, deck, theme)).toContainEqual(expect.objectContaining({ severity: 'error', code: 'claim-excerpt', slide: 'S001', claim: 'C001' }));
  });

  test('claim IDs are globally unique across slides', async () => {
    const { dir, deck } = await fixture();
    const second = structuredClone(deck.slides[0]); second.id = 'S002'; deck.slides.push(second);
    expect(await validateContent(dir, config, deck, theme)).toContainEqual(expect.objectContaining({ code: 'claim-id', slide: 'S002', claim: 'C001' }));
  });

  test.each(['slide', 'index'])('claim sources must appear in the %s reference list', async missing => {
    const { dir, deck } = await fixture();
    if (missing === 'slide') deck.slides[0].source_refs = [];
    else deck.slides[0].claims![0].source_ref = 'SRC-missing';
    expect(await validateContent(dir, config, deck, theme)).toContainEqual(expect.objectContaining({ code: 'claim-reference', claim: 'C001' }));
  });

  test('a field must be nonempty and visible in its source-locale layout', async () => {
    const { dir, deck } = await fixture();
    deck.slides[0].content['en-US'].body = ' ';
    expect(await validateContent(dir, config, deck, theme)).toContainEqual(expect.objectContaining({ code: 'claim-field', claim: 'C001' }));
    deck.slides[0].claims![0].field = 'caption';
    deck.slides[0].content['en-US'].caption = 'Present in YAML but hidden on statement slides.';
    expect(await validateContent(dir, config, deck, theme)).toContainEqual(expect.objectContaining({ code: 'claim-field', claim: 'C001' }));
  });

  test('a source with no extracted text gives an explicit manual citation route', async () => {
    const { dir, deck } = await fixture(false);
    const issue = (await validateContent(dir, config, deck, theme)).find(value => value.code === 'claim-source-text');
    expect(issue).toMatchObject({ severity: 'error', claim: 'C001' });
    expect(issue?.message).toContain('slide citations with manual review');
  });

  test('missing extracted text fails instead of accepting an uncheckable excerpt', async () => {
    const { dir, source, deck } = await fixture();
    await fs.unlink(path.join(dir, source.extracted!));
    expect(await validateContent(dir, config, deck, theme)).toContainEqual(expect.objectContaining({ code: 'claim-source-text', claim: 'C001' }));
  });

  test('a changed original source still fails provenance validation', async () => {
    const { dir, sourceFile, deck } = await fixture();
    await fs.appendFile(sourceFile, '\nExternally changed.');
    expect(await validateContent(dir, config, deck, theme)).toContainEqual(expect.objectContaining({ severity: 'error', code: 'source-integrity', slide: 'S001' }));
  });

  test('edited extraction cannot support an invented excerpt while the original is unchanged', async () => {
    const { dir, source, deck } = await fixture();
    expect(source.extracted_sha256).toMatch(/^[a-f0-9]{64}$/);
    const invented = 'The cohort received 80 mg.';
    await fs.writeFile(path.join(dir, source.extracted!), invented);
    deck.slides[0].claims![0].excerpt = invented;
    const issues = await validateContent(dir, config, deck, theme);
    expect(issues).toContainEqual(expect.objectContaining({ severity: 'error', code: 'claim-source-integrity', claim: 'C001' }));
    expect(issues.some(issue => issue.code === 'source-integrity')).toBe(false);
  });

  test('older source indexes require re-ingestion only when opting into excerpt claims', async () => {
    const { dir, source, deck } = await fixture();
    delete source.extracted_sha256;
    await writeYaml(path.join(dir, 'content/sources.yaml'), { sources: [source] });
    const issue = (await validateContent(dir, config, deck, theme)).find(value => value.code === 'claim-source-integrity');
    expect(issue?.message).toContain('Re-ingest the local source');
    delete deck.slides[0].claims;
    expect(await validateContent(dir, config, deck, theme)).toEqual([]);
  });

  test('schema limits fields to visible prose and rejects blank excerpts or unstable IDs', () => {
    const claim = { id: 'C001', field: 'title', source_ref: 'SRC-example', excerpt: 'Source passage.' };
    expect(claimSchema.safeParse(claim).success).toBe(true);
    for (const invalid of [{ ...claim, field: 'notes' }, { ...claim, excerpt: '  ' }, { ...claim, id: 'not stable!' }]) expect(claimSchema.safeParse(invalid).success).toBe(false);
  });
});
