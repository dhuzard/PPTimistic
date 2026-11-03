import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import YAML from 'yaml';

const exec=promisify(execFile),repo=process.cwd(),excerpt='Evidence excerpt kept in local source only.';
let sandbox:string;
async function cli(...args:string[]) {
  try {
    const r=await exec(process.execPath,['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href,path.join(repo,'src/cli/index.ts'),...args],{cwd:sandbox,timeout:60000,maxBuffer:8*1024*1024});
    return {code:0,output:r.stdout+r.stderr};
  } catch(e) {
    const r=e as {code:number;stdout?:string;stderr?:string};
    return {code:r.code,output:(r.stdout??'')+(r.stderr??'')};
  }
}
const projectFile=(relative:string)=>path.join(sandbox,'projects/claim-demo',relative);

beforeAll(async()=>{
  sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-claims-'));
  await fs.cp(path.join(repo,'config'),path.join(sandbox,'config'),{recursive:true});
  const input=path.join(sandbox,'claim-inputs');
  await fs.mkdir(input,{recursive:true});
  await fs.writeFile(path.join(input,'evidence.txt'),`Source paragraph. ${excerpt} End of paragraph.\n`);
  const setup=await cli('setup','--yes','--project','claim-demo','--inputs',input,'--no-render');
  expect(setup.code).toBe(0);
  const sources=YAML.parse(await fs.readFile(projectFile('content/sources.yaml'),'utf8')).sources;
  const source=sources.find((record:{path:string})=>record.path==='inputs/evidence.txt');
  expect(source).toBeDefined();
  const deck=YAML.parse(await fs.readFile(projectFile('content/slides.yaml'),'utf8'));
  deck.slides[1].source_refs.push(source.id);
  deck.slides[1].claims=[{id:'C001',field:'body',source_ref:source.id,excerpt,locator:'page 4, paragraph 2'}];
  await fs.writeFile(projectFile('content/slides.yaml'),YAML.stringify(deck));
  const build=await cli('build','--project','claim-demo');
  expect(build.code).toBe(0);
},60000);

afterAll(async()=>{await fs.rm(sandbox,{recursive:true,force:true});});

describe('local claim report',()=>{
  test('reports provenance and validation without excerpt text; presenter notes link claim ID and locator',async()=>{
    const result=await cli('claims','--project','claim-demo');
    expect(result.code).toBe(0);
    const report=JSON.parse(result.output);
    expect(report.claims).toHaveLength(1);
    const extracted=await fs.readFile(projectFile(report.claims[0].extracted_path));
    expect(report.claims[0]).toMatchObject({slide_id:'S002',claim_id:'C001',field:'body',source_ref:expect.any(String),source_path:'inputs/evidence.txt',source_sha256:expect.stringMatching(/^[a-f0-9]{64}$/),extracted_path:expect.stringMatching(/^content\/extracted\//),extracted_sha256:createHash('sha256').update(extracted).digest('hex'),locator:'page 4, paragraph 2',excerpt_sha256:expect.stringMatching(/^[a-f0-9]{64}$/),excerpt_length:excerpt.length,localized_text:{'en-US':expect.any(String),'fr-FR':expect.any(String)},validation_issues:[]});
    expect(result.output).not.toContain(excerpt);

    const pptx=await JSZip.loadAsync(await fs.readFile(projectFile('output/presentation.en-US.pptx')));
    const notes=await pptx.file('ppt/notesSlides/notesSlide2.xml')!.async('string');
    expect(notes).toContain('C001: field=body');
    expect(notes).toContain('source=');
    expect(notes).toContain('locator=page 4, paragraph 2');
    expect(notes).not.toContain(excerpt);
  });

  test('prints claim validation issues and exits nonzero for a mismatched source excerpt',async()=>{
    const deck=YAML.parse(await fs.readFile(projectFile('content/slides.yaml'),'utf8'));
    deck.slides[1].claims[0].excerpt='This sentence is not in the source.';
    await fs.writeFile(projectFile('content/slides.yaml'),YAML.stringify(deck));
    const result=await cli('claims','--project','claim-demo');
    expect(result.code).toBe(1);
    const report=JSON.parse(result.output);
    expect(report.claims[0].validation_issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'claim-excerpt',severity:'error'})]));
    expect(result.output).not.toContain('This sentence is not in the source.');
  });

  test('rejects an incomplete fictional-chart translation before changing source or configuration',async()=>{
    const contentFile=projectFile('content/slides.yaml'),configFile=projectFile('project.yaml');
    const sourceBefore=await fs.readFile(contentFile),configBefore=await fs.readFile(configFile);
    const deck=YAML.parse(sourceBefore.toString('utf8'));
    const batch={from:'en-US',to:'it-IT',slides:deck.slides.map((slide:{id:string;content:Record<string,unknown>})=>({id:slide.id,translation:{...(slide.content['en-US'] as Record<string,unknown>)}}))};
    const batchFile=path.join(sandbox,'translation-it.yaml');
    await fs.writeFile(batchFile,YAML.stringify(batch));
    const result=await cli('translate','--project','claim-demo','--to','it-IT','--file',batchFile);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('fictional chart requires a reviewed localized fictionalNotice for it-IT');
    expect(await fs.readFile(contentFile)).toEqual(sourceBefore);
    expect(await fs.readFile(configFile)).toEqual(configBefore);
  });
});
