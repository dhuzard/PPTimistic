import fs from 'node:fs/promises';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';
import { atomicWrite, exists, hash, hashFile, loadProject, safePath, stamp } from './io.js';
import { drawSlide, validateGeometry } from '../layouts/index.js';
import { validateContent, validatePptx, type Issue } from '../validation/index.js';

export type BuildState = { files: Record<string,string>; slides: Record<string,{ fingerprint:string; protected:boolean; locales: Record<string,{ fingerprint:string; protected:boolean }> }> };
export async function fingerprints(dir: string, deck: Awaited<ReturnType<typeof loadProject>>['deck'], theme: unknown) {
  const result: BuildState['slides']={};
  for (const s of deck.slides) {
    const assetPath = s.visual?.asset ? await safePath(dir,s.visual.asset) : undefined;
    const asset = assetPath ? (await exists(assetPath) ? await hashFile(assetPath) : '<missing>') : '';
    const { content, status, locked, ...shared }=s;
    const base={shared,theme,asset};
    result[s.id]={fingerprint:hash(JSON.stringify(base)),protected:locked||status==='approved'||status==='locked',
      locales:Object.fromEntries(Object.entries(content).map(([locale,c])=>{
        const {review,...text}=c;
        return [locale,{fingerprint:hash(JSON.stringify(text)),protected:review==='approved'||review==='locked'}];
      }))};
  }
  return result;
}
export function protectionIssues(previous: BuildState|undefined,next: BuildState['slides'], authorized: string[]) {
  const issues: string[]=[];
  if (!previous) return issues;
  for (const [id,old] of Object.entries(previous.slides)) {
    if (authorized.includes(id)) continue;
    const n=next[id];
    if (old.protected && (!n || !n.protected || n.fingerprint!==old.fingerprint || Object.entries(old.locales).some(([l,v])=>n.locales[l]?.fingerprint!==v.fingerprint))) issues.push(`${id}: approved/locked slide changed. Explicitly authorize it with --authorize ${id}.`);
    else if (Object.entries(old.locales).some(([l,v])=>v.protected && (!n || n.fingerprint!==old.fingerprint || !n.locales[l]?.protected || n.locales[l]?.fingerprint!==v.fingerprint))) issues.push(`${id}: approved/locked translation changed. Explicitly authorize it with --authorize ${id}.`);
  }
  return issues;
}
export async function buildProject(name: string, options: {locale?:string; authorize?:string[]}={}) {
  const {dir,config,deck,theme}=await loadProject(name);
  const locales=options.locale ? [options.locale] : config.output_locales;
  const output=await safePath(dir,'output');
  await fs.mkdir(output,{recursive:true});
  const stateFile=path.join(output,'build-state.json');
  const previous: BuildState|undefined=await exists(stateFile) ? JSON.parse(await fs.readFile(stateFile,'utf8')) : undefined;
  const next=await fingerprints(dir,deck,theme);
  const issues: Issue[]=await validateContent(dir,config,deck,theme,locales);
  for (const message of protectionIssues(previous,next,options.authorize??[])) issues.push({severity:'error',code:'protected-slide',message});
  // Validate every configured translation even on a locale-specific build, but let unrelated
  // missing translations remain visible warnings so one finished language can be exported.
  const allIssues=await validateContent(dir,config,deck,theme);
  for (const issue of allIssues.filter(i=>i.locale && !locales.includes(i.locale))) issues.push({...issue,severity:'warning'});
  await atomicWrite(path.join(output,'validation.json'),JSON.stringify(issues,null,2));
  if (issues.some(i=>i.severity==='error')) throw new Error(`Validation failed:\n${issues.filter(i=>i.severity==='error').map(i=>`${i.slide??''} ${i.locale??''}: ${i.message}`).join('\n')}`);
  for (const locale of locales) {
    const file=path.join(output,`presentation.${locale}.pptx`);
    if (await exists(file)) {
      const expected=previous?.files[locale];
      if (!expected || await hashFile(file)!==expected) throw new Error(`Externally modified or untracked PPTX: ${file}. Preserve it under a new name and reconcile edits into YAML; build will not overwrite it.`);
    }
  }
  const buildId=`${stamp()}-${crypto.randomUUID().slice(0,8)}`;
  const staging=path.join(output,'.staging',buildId);
  await fs.mkdir(staging,{recursive:true});
  const geometry=[];
  try {
    for (const locale of locales) {
      const pptx=new PptxGenJS();
      pptx.layout='LAYOUT_WIDE'; pptx.author='PPTimistic'; pptx.subject='Source-driven, editable presentation'; pptx.title=config.title;
      pptx.theme={headFontFace:theme.font,bodyFontFace:theme.font};
      for (const [index,model] of deck.slides.entries()) {
        const g=await drawSlide(pptx,model,model.content[locale],theme,locale,dir,index);
        geometry.push(g); issues.push(...validateGeometry(g));
      }
      if (issues.some(i=>i.severity==='error')) break;
      const file=path.join(staging,`presentation.${locale}.pptx`);
      await pptx.writeFile({fileName:file,compression:true});
      await validatePptx(file,deck.slides.length);
    }
    await atomicWrite(path.join(output,'validation.json'),JSON.stringify(issues,null,2));
    if (issues.some(i=>i.severity==='error')) throw new Error(`Layout validation failed:\n${issues.filter(i=>i.severity==='error').map(i=>`${i.slide} ${i.locale}: ${i.message}`).join('\n')}`);
    const history=path.join(output,'history',buildId);
    await fs.mkdir(history,{recursive:true});
    const state: BuildState={files:{...previous?.files},slides:next};
    for (const locale of locales) {
      const fileName=`presentation.${locale}.pptx`, dest=path.join(output,fileName);
      if (await exists(dest)) await fs.copyFile(dest,path.join(history,fileName));
      await fs.rename(path.join(staging,fileName),dest);
      state.files[locale]=await hashFile(dest);
    }
    const changed=deck.slides.filter(s=>!previous?.slides[s.id] || JSON.stringify(previous.slides[s.id])!==JSON.stringify(next[s.id])).map(s=>s.id);
    const report={buildId,locales,changedSlides:changed,removedSlides:Object.keys(previous?.slides??{}).filter(id=>!next[id]),issues,
      note:'PPTX files are reassembled in full. Unchanged stored assets are reused; changed slide IDs identify source revisions, not partial ZIP rendering.'};
    await atomicWrite(path.join(history,'source.snapshot.json'),JSON.stringify({config,deck,theme,previousState:previous},null,2));
    await atomicWrite(path.join(history,'build.json'),JSON.stringify(report,null,2));
    await atomicWrite(path.join(output,'geometry.json'),JSON.stringify(geometry,null,2));
    await atomicWrite(path.join(output,'build.json'),JSON.stringify(report,null,2));
    await atomicWrite(stateFile,JSON.stringify(state,null,2));
    return {dir,output,files:locales.map(l=>path.join(output,`presentation.${l}.pptx`)),report};
  } finally { await fs.rm(staging,{recursive:true,force:true}); }
}
