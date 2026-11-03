import { expect, test } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { measureText } from '../src/layouts/text-fit.js';
import { drawSlide, validateGeometry } from '../src/layouts/index.js';
import { slideSchema, themeSchema } from '../src/core/model.js';

const theme=themeSchema.parse({name:'fixture',font:'Arial',background:'FFFFFF',foreground:'161616',secondary:'555555',accent:'005555',pale:'EEEEEE',heading:32,body:24,margin:.6});

test('glyph widths, combining accents, explicit lines and exact token fits are measured',()=>{
  expect(measureText('WWWWWWWWWW',1,24).lines).toBeGreaterThan(measureText('iiiiiiiiii',1,24).lines);
  expect(measureText('éééé',2,24)).toEqual(measureText('e\u0301e\u0301e\u0301e\u0301',2,24));
  expect(measureText('First\n\nThird',3,24).lines).toBe(3);
  expect(measureText('WW',2*.9*24*1.06/72,24).lines).toBe(1);
});

test.each([
  ['en-US','A concise statement.','A supporting observation with enough context to discuss.'],
  ['fr-FR','Une observation concise.','Une observation complémentaire fournit le contexte nécessaire à la discussion.'],
  ['it-IT','Una breve osservazione.','Un’osservazione complementare fornisce il contesto necessario per la discussione.']
])('%s reflow preserves font sizes and flags dense translated text',async(locale,message,body)=>{
  const slide=slideSchema.parse({id:'REFLOW',layout:'statement',evidence:'conceptual',content:{[locale]:{title:'Reflow',message,body}}});
  const pptx=new PptxGenJS(); pptx.layout='LAYOUT_WIDE';
  const fit=await drawSlide(pptx,slide,slide.content[locale],theme,locale,'',0);
  expect(validateGeometry(fit)).toEqual([]);
  slide.content[locale].body=body.repeat(30);
  const dense=await drawSlide(pptx,slide,slide.content[locale],theme,locale,'',1);
  expect(validateGeometry(dense)).toContainEqual(expect.objectContaining({code:'text-overflow',slide:'REFLOW',locale}));
  expect(dense.boxes.find(b=>b.role==='body')?.font).toBe(24);
  const zip=await JSZip.loadAsync(await pptx.write({outputType:'nodebuffer'}) as Buffer);
  const xml=await zip.file('ppt/slides/slide2.xml')!.async('string');
  expect(xml).toContain('sz="2400"');
  expect(xml).not.toContain('<a:normAutofit');
});
