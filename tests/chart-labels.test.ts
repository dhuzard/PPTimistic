import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import YAML from 'yaml';
import PptxGenJS from 'pptxgenjs';
import { themeSchema } from '../src/core/model.js';
import { demoDeck } from '../src/content/demo.js';
import { drawSlide } from '../src/layouts/index.js';

let sandbox: string;
beforeAll(async () => { sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pptimistic-chart-test-')); });
afterAll(async () => { await fs.rm(sandbox, { recursive: true, force: true }); });

describe('editable chart labels', () => {
  test('generated chart XML enables value labels at 16 pt or larger', async () => {
    const theme = themeSchema.parse(YAML.parse(await fs.readFile(path.join(process.cwd(), 'config/themes/editorial-minimal.yaml'), 'utf8')));
    const slide = demoDeck('Chart label fixture').slides[3];
    const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
    await drawSlide(pptx, slide, slide.content['en-US'], theme, 'en-US', sandbox, 3);
    const file = path.join(sandbox, 'chart-labels.pptx');
    await pptx.writeFile({ fileName: file });
    const zip = await JSZip.loadAsync(await fs.readFile(file));
    const chartName = Object.keys(zip.files).find(name => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    expect(chartName).toBeDefined();
    const xml = await zip.file(chartName!)!.async('string');
    expect(xml).toMatch(/<c:showVal val="1"\/>/);
    const labelStyles = [...xml.matchAll(/<c:dLbls>([\s\S]*?)<\/c:dLbls>/g)].map(match => match[1]);
    expect(labelStyles.length).toBeGreaterThan(0);
    expect(labelStyles.join('')).toMatch(/<a:defRPr[^>]*\bsz="(?:1[6-9]\d{2}|[2-9]\d{3,})"/);
  });
});
