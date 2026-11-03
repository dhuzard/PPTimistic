import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite, hashFile, loadProject, safePath, stamp, writeYaml } from '../core/io.js';
import { loadProtectionBaseline } from '../core/build.js';

export interface IllustrationRequest { slideId:string; prompt:string; styleVersion:string; outputPath:string }
export interface IllustrationResult { assetPath:string; provider:string; model?:string; parameters:Record<string,unknown> }
export interface ImageProvider { name:string; generate(request:IllustrationRequest):Promise<IllustrationResult> }
export interface ExternalPolicy { approvedForExternalTransmission:boolean; approvedForPaidCalls:boolean; spendingLimit:number; estimatedCost:number }
export function assertExternalPolicy(policy:ExternalPolicy) {
  if (!policy.approvedForExternalTransmission) throw new Error('External transmission requires explicit project approval.');
  if (!Number.isFinite(policy.estimatedCost)||policy.estimatedCost<0 || !Number.isFinite(policy.spendingLimit)||policy.spendingLimit<0) throw new Error('Cost estimates and spending limit must be finite and nonnegative.');
  if (policy.estimatedCost>0 && !policy.approvedForPaidCalls && policy.estimatedCost>policy.spendingLimit) throw new Error('Paid calls require authorization or an adequate spending limit.');
}
export async function prepareImages(name:string,id?:string) {
  const {dir,config,deck}=await loadProject(name);
  if(id&&!deck.slides.some(s=>s.id===id)) throw new Error(`Unknown slide ID: ${id}`);
  const style=await fs.readFile(await safePath(dir,'illustration-style.md'),'utf8');
  const results=[];
  for (const s of deck.slides.filter(s=>(!id||s.id===id) && s.visual)) {
    const file=path.join(dir,`assets/generated/${s.id}.prompt.json`);
    const recordPath=`assets/generated/${s.id}.prompt.${stamp()}-${crypto.randomUUID().slice(0,8)}.json`;
    const manifest={slideId:s.id,recordPath,recordType:'preparation-or-reuse',generationProvenance:'unavailable',styleVersion:style.match(/version\s+(\d+)/i)?.[1]??'unversioned',
      prompt:`${style}\n\nCentral message: ${s.content[config.source_locale].message}\nSlide brief: ${s.visual!.brief}\nNever include text. Never fabricate empirical results.`,
      assetPath:s.visual?.asset??null,sha256:s.visual?.asset?await hashFile(await safePath(dir,s.visual.asset)):null,
      provider:s.visual?.asset?'local':'unconfigured',model:null,date:new Date().toISOString(),parameters:{},accepted:s.visual?.accepted??false,
      status:s.visual?.asset?'reused':'pending'};
    const data=JSON.stringify(manifest,null,2);
    await atomicWrite(await safePath(dir,recordPath),data);
    await atomicWrite(file,data);
    results.push({slide:s.id,status:manifest.status,file});
  }
  return results;
}
export async function attachImage(name:string,id:string,asset:string,authorized:string[]=[]) {
  const {dir,config,deck}=await loadProject(name);
  const s=deck.slides.find(s=>s.id===id);
  if (!s) throw new Error(`Unknown slide ID: ${id}`);
  const {state:baseline,legacyUnverifiable}=await loadProtectionBaseline(dir);
  const saved=baseline?.slides[id];
  if ((s.locked||['approved','locked'].includes(s.status)||s.visual?.accepted||saved?.acceptedAsset||saved?.protected||Object.values(saved?.locales??{}).some(l=>l.protected)||(legacyUnverifiable && saved)) && !authorized.includes(id)) throw new Error(`${id}: replacing an approved slide, translation or accepted asset requires --authorize ${id}.`);
  if (!['.png','.jpg','.jpeg','.svg','.webp'].includes(path.extname(asset).toLowerCase())) throw new Error('Use PNG, JPEG, SVG or WebP.');
  const data=await fs.readFile(path.resolve(asset));
  const dest=`assets/generated/${id}-${stamp()}${path.extname(asset).toLowerCase()}`;
  await atomicWrite(await safePath(dir,dest),data);
  await atomicWrite(path.join(dir,`feedback/${stamp()}.image-before.yaml`),await fs.readFile(await safePath(dir,config.content)));
  s.visual={asset:dest,brief:s.visual?.brief??'',accepted:true};
  await writeYaml(await safePath(dir,config.content),deck);
  return prepareImages(name,id);
}
