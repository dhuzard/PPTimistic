import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exists, root } from './io.js';
import { capabilities, run } from '../rendering/index.js';

export async function doctor() {
  const major=Number(process.versions.node.split('.')[0]);
  const nodeOk=major>22 || (major===22 && Number(process.versions.node.split('.')[1])>=13);
  let writable=true;
  try { const temp=await fs.mkdtemp(path.join(root,'.studio-write-check-')); await fs.rmdir(temp); } catch { writable=false; }
  const dependencies=[];
  for (const name of ['pptxgenjs','yaml','sharp','mammoth','pdf-parse']) {
    try { await import(name); dependencies.push({name,available:true}); } catch { dependencies.push({name,available:false}); }
  }
  const rendering=await capabilities();
  let fonts:string[]=[];
  if (process.platform==='win32') {
    for (const dir of [path.join(process.env.WINDIR??'C:/Windows','Fonts'),path.join(os.homedir(),'AppData/Local/Microsoft/Windows/Fonts')]) {
      if (await exists(dir)) fonts.push(...await fs.readdir(dir));
    }
  } else {
    try { fonts=(await run('fc-list',['--format','%{family}\n'],5000)).stdout.split('\n'); } catch {
      if (process.platform==='darwin') for (const dir of ['/System/Library/Fonts','/Library/Fonts',path.join(os.homedir(),'Library/Fonts')]) if (await exists(dir)) fonts.push(...await fs.readdir(dir));
    }
  }
  return {node:process.version,nodeOk,writable,dependencies,rendering,
    fonts:{Inter:fonts.some(f=>/^inter(?:[\s.-]|$)/i.test(f)),Arial:fonts.some(f=>/arial/i.test(f)),Aptos:fonts.some(f=>/aptos/i.test(f))},
    imageProvider:'Local assets/native shapes; external image provider not configured.',
    translationProvider:'Manual translations; external translation provider not configured.',
    note:'Missing optional renderers/fonts/providers do not block PPTX generation. Use project.font to override Arial; Inter is preferred when installed.'};
}
