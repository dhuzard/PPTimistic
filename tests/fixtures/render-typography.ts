import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import PptxGenJS from 'pptxgenjs';
import YAML from 'yaml';
import { themeSchema } from '../../src/core/model.js';
import { drawSlide, validateGeometry } from '../../src/layouts/index.js';
import { chartLabelsNeedingReview } from '../../src/layouts/text-fit.js';
import { findTool, run } from '../../src/rendering/index.js';
import { fixtureLocales, fixtureThemes, typographyFixture } from './typography.js';

// Usage: npx tsx tests/fixtures/render-typography.ts OUTPUT_DIR libreoffice|powerpoint
// Output is public fictional data. Images are deliberately marked uninspected.
const [outputArg, renderer] = process.argv.slice(2);
if (!outputArg || !['libreoffice','powerpoint'].includes(renderer)) throw new Error('Usage: tsx tests/fixtures/render-typography.ts OUTPUT_DIR libreoffice|powerpoint');
const output=path.resolve(outputArg);
await fs.mkdir(output,{recursive:true});
const soffice=renderer==='libreoffice' ? await findTool('soffice',[process.env.SOFFICE_PATH??'']) : undefined;
const pdftoppm=renderer==='libreoffice' ? await findTool('pdftoppm',[process.env.PDFTOPPM_PATH??'']) : undefined;
if (renderer==='libreoffice' && (!soffice || !pdftoppm)) throw new Error('Install LibreOffice and pdftoppm, or set SOFFICE_PATH and PDFTOPPM_PATH.');
const matrix=fixtureThemes.flatMap(theme=>fixtureLocales.map(locale=>({theme,locale,substitution:false})));
matrix.push({theme:'editorial-minimal',locale:'en-US',substitution:true});
const records=[];
for (const entry of matrix) {
  const folder=path.join(output,`${entry.theme}-${entry.locale}${entry.substitution?'-missing-font':''}`);
  await fs.mkdir(folder,{recursive:true});
  const theme=themeSchema.parse(YAML.parse(await fs.readFile(path.join('config/themes',`${entry.theme}.yaml`),'utf8')));
  if (entry.substitution) theme.font='PPTimistic Missing Font';
  const pptx=new PptxGenJS(); pptx.layout='LAYOUT_WIDE';
  const slides=typographyFixture();
  const overfull=structuredClone(slides[1]); overfull.id='QA_OVERFULL';
  overfull.content[entry.locale].body=overfull.content[entry.locale].body.repeat(10);
  const longChart=structuredClone(slides[6]); longChart.id='QA_LONG_CHART';
  longChart.content[entry.locale].labels[1]=longChart.content[entry.locale].labels[1].repeat(8);
  slides.push(overfull,longChart);
  const geometry=[];
  for (const [index,slide] of slides.entries()) geometry.push(...validateGeometry(await drawSlide(pptx,slide,slide.content[entry.locale],theme,entry.locale,process.cwd(),index)));
  const file=path.join(folder,'fixture.pptx'); await pptx.writeFile({fileName:file});
  if (renderer==='libreoffice') {
    await run(soffice!,[`-env:UserInstallation=${pathToFileURL(path.join(folder,'lo-profile')).href}`,'--headless','--convert-to','pdf','--outdir',folder,file]);
    await run(pdftoppm!,['-png','-scale-to','1600',path.join(folder,'fixture.pdf'),path.join(folder,'slide')]);
    await fs.rm(path.join(folder,'lo-profile'),{recursive:true,force:true});
  } else {
    await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('src/rendering/powerpoint.ps1'),'-Deck',file,'-Destination',folder]);
  }
  const images=(await fs.readdir(folder)).filter(name=>/^slide-\d+\.png$/u.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  if (images.length!==slides.length) throw new Error(`Expected ${slides.length} images in ${folder}, found ${images.length}.`);
  records.push({...entry,font:theme.font,renderer,chartLabelReview:chartLabelsNeedingReview(longChart.content[entry.locale].labels,13.333333-2*theme.margin),slides:slides.map((slide,index)=>({id:slide.id,layout:slide.layout,image:path.relative(output,path.join(folder,images[index])).replaceAll('\\','/'),inspection:'not inspected'})),geometry});
}
await fs.writeFile(path.join(output,'qa-manifest.json'),JSON.stringify({generatedAt:new Date().toISOString(),records},null,2));
console.log(`Rendered ${records.length} public fixture decks to ${output}; visual inspection is still required.`);
