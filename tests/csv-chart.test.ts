import { afterAll, beforeAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import YAML from 'yaml';
import { hash } from '../src/core/io.js';
import { ingest } from '../src/content/ingest.js';
import { resolveChartData } from '../src/content/chart-data.js';
import { slideSchema } from '../src/core/model.js';

const repo=process.cwd(), exec=promisify(execFile);
let sandbox:string, dir:string, sourceId:string, digest:string;
const csv='group,control,treated\n"A, B",1.25,9\nC,-2.5,12\nD,100,22\n';
async function cli(...args:string[]) {
  try { const r=await exec(process.execPath,['--import',pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href,path.join(repo,'src/cli/index.ts'),...args],{cwd:sandbox,timeout:60000}); return {code:0,output:r.stdout+r.stderr}; }
  catch(error) { const e=error as {code:number;stdout:string;stderr:string}; return {code:e.code,output:e.stdout+e.stderr}; }
}
function chart() { return slideSchema.parse({id:'S004',layout:'chart',evidence:'established',source_refs:[sourceId],chart:{fictional:false,data_ref:sourceId,binding:{source_sha256:digest,category_column:'group',value_columns:['treated','control'],rows:[3,2]}},content:{'en-US':{title:'Selected observations',labels:['C','A, B'],seriesNames:['treated','control']}}}); }
beforeAll(async()=>{
  sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-csv-chart-')); dir=path.join(sandbox,'projects/demo');
  await fs.cp(path.join(repo,'config'),path.join(sandbox,'config'),{recursive:true});
  expect((await cli('setup','--yes','--project','demo','--no-render')).code).toBe(0);
  await fs.writeFile(path.join(dir,'inputs','values.csv'),csv);
  const [source]=await ingest(dir);sourceId=source.id;digest=source.sha256;
},60000);
afterAll(async()=>{await fs.rm(sandbox,{recursive:true,force:true});});

test('selected CSV values are native editable chart and workbook data with recorded provenance',async()=>{
  const slide=chart();
  await fs.rm(path.join(dir,'output'),{recursive:true,force:true});
  const deck={version:1,slides:[slide]};
  await fs.writeFile(path.join(dir,'content/slides.yaml'),YAML.stringify(deck));
  const project=YAML.parse(await fs.readFile(path.join(dir,'project.yaml'),'utf8'));project.output_locales=['en-US'];
  await fs.writeFile(path.join(dir,'project.yaml'),YAML.stringify(project));
  const result=await cli('build','--project','demo');expect(result.output).toBeTruthy();expect(result.code, result.output).toBe(0);
  const zip=await JSZip.loadAsync(await fs.readFile(path.join(dir,'output/presentation.en-US.pptx')));
  const chartFile=Object.keys(zip.files).find(n=>/^ppt\/charts\/chart\d+\.xml$/.test(n))!;
  const xml=await zip.file(chartFile)!.async('string');
  for(const value of ['C','A, B','12','9','-2.5','1.25']) expect(xml).toContain(`>${value}<`);
  const embedded=Object.keys(zip.files).find(n=>/^ppt\/embeddings\/.*\.xlsx$/.test(n))!;
  expect(embedded).toBeTruthy();
  const workbook=await JSZip.loadAsync(await zip.file(embedded)!.async('nodebuffer'));
  const worksheet=await workbook.file('xl/worksheets/sheet1.xml')!.async('string');
  for(const value of ['12','9','-2.5','1.25']) expect(worksheet).toContain(`>${value}<`);
  const state=JSON.parse(await fs.readFile(path.join(dir,'output/build-state.json'),'utf8'));
  expect(state.provenance['en-US'].chartSelections.S004).toEqual({source_id:sourceId,source_sha256:digest,category_column:'group',value_columns:['treated','control'],rows:[3,2]});
},60000);

test('blocks changed and re-ingested sources, invalid selections and unsupported numbers',async()=>{
  const slide=chart();
  expect((await resolveChartData(dir,slide)).series.map(s=>s.values)).toEqual([[12,9],[-2.5,1.25]]);
  const bad=structuredClone(slide);bad.chart!.binding!.rows=[2,2];
  await expect(resolveChartData(dir,bad)).rejects.toThrow('row numbers');
  bad.chart!.binding!.rows=[2];bad.chart!.binding!.value_columns=['missing'];
  await expect(resolveChartData(dir,bad)).rejects.toThrow('columns');
  await fs.writeFile(path.join(dir,'inputs/values.csv'),csv.replace('1.25','1.26'));
  expect((await cli('build','--project','demo')).code).not.toBe(0);
  await ingest(dir);
  await expect(resolveChartData(dir,slide)).rejects.toThrow('changed since selection');
  await fs.writeFile(path.join(dir,'inputs/values.csv'),csv.replace('1.25','1e999'));
  const [fresh]=await ingest(dir); const invalid=chart();invalid.chart!.binding!.source_sha256=fresh.sha256;
  await expect(resolveChartData(dir,invalid)).rejects.toThrow('numeric range');
},60000);


