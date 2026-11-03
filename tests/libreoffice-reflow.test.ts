import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import PptxGenJS from 'pptxgenjs';
import sharp from 'sharp';
import { findTool, run } from '../src/rendering/index.js';

test('LibreOffice renders native EN/FR/IT text fixtures when locally available',async context=>{
  const soffice=await findTool('soffice',[process.env.SOFFICE_PATH??'',...(process.platform==='win32'?['C:/Program Files/LibreOffice/program/soffice.exe']:['/Applications/LibreOffice.app/Contents/MacOS/soffice'])]);
  const pdftoppm=await findTool('pdftoppm',[process.env.PDFTOPPM_PATH??'']);
  if (!soffice || !pdftoppm) {context.skip('LibreOffice and pdftoppm are both required; geometry tests still run.');return;}
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-reflow-render-'));
  try {
    const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';
    for (const [locale,text] of [
      ['en-US','A concise observation leaves room for discussion.'],
      ['fr-FR','Une observation concise laisse de la place à la discussion.'],
      ['it-IT','Un’osservazione concisa lascia spazio alla discussione.']
    ]) {
      const slide=pptx.addSlide();
      slide.addText(`${locale}\n${text}`,{x:.6,y:.6,w:8,h:2,fontFace:'Arial',fontSize:24,margin:0,lang:locale});
    }
    const file=path.join(folder,'reflow.pptx');await pptx.writeFile({fileName:file});
    await run(soffice,[`-env:UserInstallation=${pathToFileURL(path.join(folder,'profile')).href}`,'--headless','--convert-to','pdf','--outdir',folder,file]);
    await run(pdftoppm,['-png','-scale-to','640',path.join(folder,'reflow.pdf'),path.join(folder,'slide')]);
    const images=(await fs.readdir(folder)).filter(file=>/^slide-\d+\.png$/u.test(file));
    expect(images).toHaveLength(3);
    for (const image of images) expect((await sharp(path.join(folder,image)).stats()).isOpaque).toBe(true);
    // Renderer compatibility only; pixels are not automatically a visual fit verdict.
  } finally {await fs.rm(folder,{recursive:true,force:true});}
},120000);
