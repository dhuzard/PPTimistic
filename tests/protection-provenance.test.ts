import { afterAll, beforeAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { createHash } from 'node:crypto';
import { translationSourceFingerprint } from '../src/localization/index.js';
import type { Slide } from '../src/core/model.js';

const exec=promisify(execFile), repo=process.cwd();
let sandbox:string;
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const file=(p:string)=>path.join(sandbox,'projects/demo',p);
async function cli(...args:string[]) {
  try {const r=await exec(process.execPath,['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href,path.join(repo,'src/cli/index.ts'),...args],{cwd:sandbox,timeout:60000});return {code:0,output:r.stdout+r.stderr};}
  catch(e) {const r=e as {code:number;stdout:string;stderr:string};return {code:r.code,output:r.stdout+r.stderr};}
}
async function readDeck() {return YAML.parse(await fs.readFile(file('content/slides.yaml'),'utf8'));}
async function writeDeck(d:unknown) {await fs.writeFile(file('content/slides.yaml'),YAML.stringify(d));}
beforeAll(async()=>{
  sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-provenance-'));
  await fs.cp(path.join(repo,'config'),path.join(sandbox,'config'),{recursive:true});
  const r=await cli('setup','--yes','--project','demo','--no-render');expect(r.code).toBe(0);
},60000);
afterAll(async()=>{await fs.rm(sandbox,{recursive:true,force:true});});

test('accepted images remain protected independently from draft slide text',async()=>{
  const d=await readDeck();const slide=d.slides.find((s:{id:string})=>s.id==='S002');
  expect(slide.visual.accepted).toBe(true);
  slide.content['en-US'].body='A permitted draft edit.';
  slide.content['fr-FR'].body='Une modification de brouillon autorisée.';
  slide.content['fr-FR'].source_fingerprint=translationSourceFingerprint(slide as Slide,'en-US');
  await writeDeck(d);
  expect((await cli('build','--project','demo')).code).toBe(0);
  const original=slide.visual.asset;
  const replacement='assets/reference/replacement.svg';await fs.copyFile(file(original),file(replacement));
  slide.visual.asset=replacement;await writeDeck(d);
  expect((await cli('build','--project','demo')).output).toContain('accepted image changed');
  slide.visual.asset=original;slide.visual.accepted=false;await writeDeck(d);
  expect((await cli('build','--project','demo')).output).toContain('acceptance removed');
  slide.visual.accepted=true;await writeDeck(d);
  const bytes=await fs.readFile(file(original));await fs.appendFile(file(original),'\n');
  expect((await cli('build','--project','demo')).output).toContain('accepted image changed');
  await fs.writeFile(file(original),bytes);
  slide.visual.accepted=false;await writeDeck(d);
  expect((await cli('build','--project','demo','--authorize','S002')).code).toBe(0);
},60000);

test('history links each archived output to its generating source and retained prompt',async()=>{
  expect((await cli('images','--project','demo','--slide','S002')).code).toBe(0);
  const first=JSON.parse(await fs.readFile(file('assets/generated/S002.prompt.json'),'utf8'));
  expect((await cli('build','--project','demo')).code).toBe(0);
  const prior=JSON.parse(await fs.readFile(file('output/build-state.json'),'utf8'));
  const priorPptx=await fs.readFile(file('output/presentation.en-US.pptx'));
  expect((await cli('images','--project','demo','--slide','S002')).code).toBe(0);
  const second=JSON.parse(await fs.readFile(file('assets/generated/S002.prompt.json'),'utf8'));
  expect(first.recordPath).not.toBe(second.recordPath);
  expect((await cli('build','--project','demo','--locale','en-US')).code).toBe(0);
  const report=JSON.parse(await fs.readFile(file('output/build.json'),'utf8'));
  const manifest=JSON.parse(await fs.readFile(file(`output/history/${report.buildId}/manifest.json`),'utf8'));
  const archived=manifest.archived['presentation.en-US.pptx'], generated=manifest.generated['presentation.en-US.pptx'];
  expect(archived).toEqual(prior.provenance['en-US']);
  expect(archived.pptxSha256).toBe(hash(priorPptx));
  expect(archived.prompts.S002.path).toBe(first.recordPath);
  expect(hash(await fs.readFile(file(archived.prompts.S002.path)))).toBe(archived.prompts.S002.sha256);
  expect(generated.prompts.S002.path).toBe(second.recordPath);
  expect(second.recordType).toBe('preparation-or-reuse');
  expect(second.generationProvenance).toBe('unavailable');
  expect(generated.prompts.S002).toMatchObject({role:'preparation-or-reuse',generationProvenance:'unavailable'});
  expect(generated.pptxSha256).toBe(hash(await fs.readFile(file('output/presentation.en-US.pptx'))));
  const current=JSON.parse(await fs.readFile(file('output/build-state.json'),'utf8'));
  expect(current.provenance['fr-FR']).toEqual(prior.provenance['fr-FR']);
},60000);

test('attachment uses the saved accepted-image baseline after YAML acceptance is removed',async()=>{
  const d=await readDeck(), slide=d.slides.find((s:{id:string})=>s.id==='S002');
  slide.visual.accepted=true;await writeDeck(d);
  expect((await cli('build','--project','demo')).code).toBe(0);
  slide.visual.accepted=false;await writeDeck(d);
  const before=await fs.readFile(file('content/slides.yaml'));
  const r=await cli('images','--project','demo','--slide','S002','--asset',file('assets/reference/idea.svg'));
  expect(r.code).not.toBe(0);expect(r.output).toContain('--authorize');
  expect(await fs.readFile(file('content/slides.yaml'))).toEqual(before);
  slide.visual.accepted=true;await writeDeck(d);
},60000);

test('source mappings and input bytes affect freshness and are recorded in history',async()=>{
  const input='inputs/provenance.txt', index='content/sources.yaml', id='SRC-provenance';
  await fs.writeFile(file(input),'first source');
  const digest=hash(await fs.readFile(file(input)));
  const extracted='content/extracted/provenance.txt';
  await fs.mkdir(path.dirname(file(extracted)),{recursive:true});await fs.writeFile(file(extracted),'extracted source');
  const extractedDigest=hash(await fs.readFile(file(extracted)));
  await fs.writeFile(file(index),YAML.stringify({sources:[{id,path:input,sha256:digest,kind:'txt',extracted,extracted_sha256:extractedDigest}]}));
  const d=await readDeck();d.slides[0].source_refs=[id];await writeDeck(d);
  expect((await cli('build','--project','demo')).code).toBe(0);
  const state=JSON.parse(await fs.readFile(file('output/build-state.json'),'utf8'));
  expect(state.provenance['en-US'].sourceRecords[id]).toEqual({path:input,sha256:digest,recordedSha256:digest,extracted:{path:extracted,sha256:extractedDigest,recordedSha256:extractedDigest}});
  expect(state.provenance['en-US'].sources[index]).toBe(hash(await fs.readFile(file(index))));
  const previous=state.provenance['en-US'].sourceFingerprint;
  await fs.writeFile(file(input),'changed source');
  const result=await cli('validate','--project','demo');expect(result.output).toContain('older than the current project source');
  await fs.writeFile(file(input),'first source');
  await fs.writeFile(file(extracted),'changed extraction');
  expect((await cli('validate','--project','demo')).output).toContain('older than the current project source');
  await fs.writeFile(file(extracted),'extracted source');
  await fs.appendFile(file(index),'\n# changed index\n');
  expect((await cli('validate','--project','demo')).output).toContain('older than the current project source');
  expect(previous).toHaveLength(64);
},60000);

test('legacy protection without a recoverable snapshot fails closed',async()=>{
  const statePath=file('output/build-state.json'), report=JSON.parse(await fs.readFile(file('output/build.json'),'utf8'));
  const state=JSON.parse(await fs.readFile(statePath,'utf8'));delete state.version;
  for(const slide of Object.values(state.slides) as {acceptedAsset?:unknown}[]) delete slide.acceptedAsset;
  await fs.writeFile(statePath,JSON.stringify(state));
  const snapshot=file(`output/history/${report.buildId}/source.snapshot.json`), saved=await fs.readFile(snapshot);
  await fs.rm(snapshot);
  const deck=await readDeck(), slide=deck.slides.find((s:{id:string})=>s.id==='S002');
  slide.visual.accepted=false;await writeDeck(deck);
  expect((await cli('build','--project','demo')).output).toContain('legacy image protection baseline is unavailable');
  slide.visual.accepted=true;await writeDeck(deck);
  expect((await cli('build','--project','demo')).code).toBe(0);
  await fs.writeFile(snapshot,saved);
},60000);
