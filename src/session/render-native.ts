import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import sharp from 'sharp';
import {patchPptxScene, type PptxEdit} from './pptx-native.js';

const exec=promisify(execFile);
/** Render a single changed slide from an isolated patched copy, never the user's original. */
export async function renderNativePreview(input:{source:Uint8Array;digest:string;edits:PptxEdit[];index:number}):Promise<Buffer> {
  if(process.platform!=='win32')throw new Error('Live native previews require PowerPoint on Windows.');
  if(!Number.isInteger(input.index)||input.index<1)throw new Error('Invalid preview slide.');
  const patched=await patchPptxScene(input.source,input.digest,input.edits);
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-native-preview-'));
  try {
    const deck=path.join(temporary,'preview.pptx'),image=path.join(temporary,'slide.png');
    await fs.writeFile(deck,patched,{mode:0o600});
    const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'render-native.ps1');
    await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Deck',deck,'-Slide',String(input.index),'-Destination',image],{timeout:120000,windowsHide:true,maxBuffer:1024*1024});
    const result=await fs.readFile(image);const metadata=await sharp(result).metadata();
    if(metadata.format!=='png'||metadata.width!==1600||metadata.height!==900)throw new Error('PowerPoint produced an invalid preview image.');
    return result;
  } finally {
    const target=path.resolve(temporary),parent=path.resolve(os.tmpdir());
    if(path.dirname(target)!==parent||!path.basename(target).startsWith('pptimistic-native-preview-'))throw new Error('Refusing to remove an unexpected preview directory.');
    await fs.rm(target,{recursive:true,force:true});
  }
}
