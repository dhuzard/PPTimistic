import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import YAML from 'yaml';
import { layouts, projectSchema, themeSchema } from '../src/core/model.js';
import { drawSlide, validateGeometry } from '../src/layouts/index.js';
import { chartLabelsNeedingReview } from '../src/layouts/text-fit.js';
import { validateContent } from '../src/validation/index.js';
import { fixtureLocales, fixtureThemes, typographyFixture } from './fixtures/typography.js';

test('public typography matrix covers every layout, locale and theme without shrinking or expected overflow', async () => {
  const fixtures = typographyFixture();
  expect(fixtures.map(slide=>slide.layout)).toEqual([...layouts]);
  for (const name of fixtureThemes) {
    const theme=themeSchema.parse(YAML.parse(await fs.readFile(path.join('config/themes',`${name}.yaml`),'utf8')));
    for (const locale of fixtureLocales) {
      const pptx=new PptxGenJS(); pptx.layout='LAYOUT_WIDE';
      for (const [index,slide] of fixtures.entries()) {
        const geometry=await drawSlide(pptx,slide,slide.content[locale],theme,locale,process.cwd(),index);
        expect(validateGeometry(geometry),`${name}/${locale}/${slide.id}`).toEqual([]);
      }
      const zip=await JSZip.loadAsync(await pptx.write({outputType:'nodebuffer'}) as Buffer);
      for (let index=1; index<=fixtures.length; index++) {
        const xml=await zip.file(`ppt/slides/slide${index}.xml`)!.async('string');
        expect(xml).not.toMatch(/<a:(?:normAutofit|spAutoFit)\b/u);
      }
    }
  }
},120000);

test('chart labels that substantially exceed their allocated width require review',()=>{
  expect(chartLabelsNeedingReview(['First example','Second example','Third example'],11.9)).toEqual([]);
  expect(chartLabelsNeedingReview(['Short','An exceptionally long category label that cannot reasonably fit under one chart column','Short'],11.9)).toEqual([1]);
  expect(chartLabelsNeedingReview([],11.9)).toEqual([]);
});

test('content validation reports crowded chart labels by slide and locale', async()=>{
  const slides=typographyFixture();
  const chart=slides.find(slide=>slide.layout==='chart')!;
  chart.content['en-US'].labels[1]='An exceptionally long category label that cannot reasonably fit under one chart column';
  const theme=themeSchema.parse(YAML.parse(await fs.readFile('config/themes/editorial-minimal.yaml','utf8')));
  const project=projectSchema.parse({version:1,title:'Chart label review',source_locale:'en-US',output_locales:['en-US']});
  const issues=await validateContent(process.cwd(),project,{version:1,slides:[chart]},theme);
  expect(issues).toContainEqual(expect.objectContaining({code:'chart-label-review',severity:'warning',slide:chart.id,locale:'en-US'}));
});


test('overfull fixture reports overflow rather than changing the font', async()=>{
  const slide=typographyFixture()[1];
  slide.content['en-US'].body=slide.content['en-US'].body.repeat(10);
  const theme=themeSchema.parse(YAML.parse(await fs.readFile('config/themes/editorial-minimal.yaml','utf8')));
  const pptx=new PptxGenJS(); pptx.layout='LAYOUT_WIDE';
  const geometry=await drawSlide(pptx,slide,slide.content['en-US'],theme,'en-US',process.cwd(),0);
  expect(validateGeometry(geometry)).toContainEqual(expect.objectContaining({code:'text-overflow',slide:slide.id}));
  expect(geometry.boxes.find(box=>box.role==='body')?.font).toBe(theme.body);
});
