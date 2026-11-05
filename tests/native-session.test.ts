import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import PptxGenJS from 'pptxgenjs';
import * as io from '../src/core/io.js';
import { deckSchema, projectSchema, themeSchema } from '../src/core/model.js';
import { SessionStore } from '../src/session/store.js';
import { importPptxScene } from '../src/session/pptx-native.js';
import { buildProject } from '../src/core/build.js';
import type { Actor } from '../src/session/contracts.js';

const owner: Actor = {id:'owner',name:'Owner',role:'owner'};
const editor: Actor = {id:'editor',name:'Editor',role:'editor'};
const reviewer: Actor = {id:'reviewer',name:'Reviewer',role:'reviewer'};
let folder: string, store: SessionStore, original: Buffer, originalYaml: string;
let manifest: any;
const yamlPath = () => path.join(folder,'content/slides.yaml');
const inputPath = () => path.join(folder,'inputs/presentation-originale.fr-FR.pptx');
const writeManifest = () => fs.writeFile(path.join(folder,'content/reference-preview.json'),JSON.stringify(manifest));
const operation = (text: string, objectId='S001:ref-1', extra: Record<string,unknown>={}) => ({slideId:'S001',locale:'en-US',objectId,expectedRevision:store.metadata.revision,kind:'native-text',value:{runs:[{paragraph:0,run:0,text}]},authorize:[],...extra});
async function restart() { store.dispose(); store = new SessionStore('native-fixture'); await store.initialize(); }
async function source() { return YAML.parse(await fs.readFile(yamlPath(),'utf8')); }

beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-native-session-'));
  for (const relative of ['content','inputs','output/reference']) await fs.mkdir(path.join(folder,relative),{recursive:true});
  const config = projectSchema.parse({version:1,title:'Native fixture',source_locale:'en-US',output_locales:['en-US']});
  await fs.writeFile(path.join(folder,'project.yaml'),YAML.stringify(config));
  const slides = ['Original heading','Unrelated heading'].map((title,index) => ({id:`S00${index+1}`,layout:'statement',evidence:'conceptual',content:{'en-US':{title,message:'Original message',notes:'Preserved speaker notes'}}}));
  originalYaml = YAML.stringify(deckSchema.parse({version:1,slides}));
  await fs.writeFile(yamlPath(),originalYaml);
  const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
  for (const slide of slides) {
    const native = pptx.addSlide();
    native.addText(slide.content['en-US'].title,{x:1,y:1,w:10,h:1});
    native.addText('Original message',{x:1,y:3,w:10,h:1});
    native.addText('Literal citation 2026',{x:1,y:5,w:10,h:1});
  }
  original = Buffer.from(await pptx.write({outputType:'nodebuffer'}) as ArrayBuffer);
  await fs.writeFile(inputPath(),original);
  const scene = await importPptxScene(original), image = Buffer.from('preview fixture');
  await fs.writeFile(path.join(folder,'output/reference/original.png'),image);
  manifest = {version:1,source:'inputs/presentation-originale.fr-FR.pptx',sourceSha256:scene.digest,locale:'en-US',slides:scene.slides.map((slide,index) => ({id:`S00${index+1}`,image:'output/reference/original.png',sha256:io.hash(image),shapes:slide.objects.map((object,ordinal) => ({id:`S00${index+1}:ref-${ordinal+1}`,label:object.runs.map(run=>run.text).join(''),kind:'text',x:object.geometry!.x/914400,y:object.geometry!.y/914400,w:object.geometry!.cx/914400,h:object.geometry!.cy/914400}))}))};
  await writeManifest();
  await fs.writeFile(path.join(folder,'content/.block-session-export'),'Native fixture: export blocked');
  const theme = themeSchema.parse(await io.readYaml(path.resolve('config/themes/editorial-minimal.yaml')));
  vi.spyOn(io,'loadProject').mockImplementation(async () => ({dir:folder,config,theme,deck:deckSchema.parse(await io.readYaml(yamlPath()))}));
  store = new SessionStore('native-fixture'); await store.initialize();
});
afterEach(async () => { store?.dispose(); vi.restoreAllMocks(); if (folder) await fs.rm(folder,{recursive:true,force:true}); });

test('imports without touching YAML, saves native text with canonical binding, and leaves original and unrelated content intact',async () => {
  const before = await source(), state = await store.snapshot(owner,'en-US');
  expect(await fs.readFile(yamlPath(),'utf8')).toBe(originalYaml);
  expect(state.slides[0].reference?.shapes?.[0].nativeText).toMatchObject({editable:true,runs:[{text:'Original heading'}]});
  await store.operate(editor,operation('Revised heading'));
  const after = await source();
  expect(after.slides[0].content['en-US'].title).toBe('Revised heading');
  expect(Object.values(after.slides[0].native_text.objects)[0]).toEqual({binding:'title',runs:[{paragraph:0,run:0,text:'Revised heading'}]});
  expect(after.slides[0].native_text.sourceSha256).toBe(io.hash(original));
  expect(after.slides[0].content['en-US'].notes).toBe(before.slides[0].content['en-US'].notes);
  expect(after.slides[1]).toEqual(before.slides[1]);
  expect(await fs.readFile(inputPath())).toEqual(original);
  const updated = await store.snapshot(owner,'en-US');
  expect(updated.slides[0].reference?.status).toBe('pending');
  expect(updated.exportBlocked).toBe(true);
  await expect(store.export(owner,{locale:'en-US'})).rejects.toThrow('export remains disabled');
  await expect(buildProject('native-fixture')).rejects.toThrow('Generic build cannot preserve');
});

test('unbound literal labels save only native overrides; comments and optimistic concurrency remain intact',async () => {
  const before = await source(), stale = operation('First label','S001:ref-3');
  const comment = await store.comment(reviewer,{slideId:'S001',locale:'en-US',objectId:'S001:ref-3',message:'Keep the source qualification.'});
  await store.operate(editor,stale);
  await expect(store.operate(editor,{...stale,value:{runs:[{paragraph:0,run:0,text:'Stale label'}]}})).rejects.toThrow('changed');
  const after = await source();
  expect(after.slides[0].content).toEqual(before.slides[0].content);
  expect(Object.values(after.slides[0].native_text.objects)[0]).toEqual({runs:[{paragraph:0,run:0,text:'First label'}]});
  expect(store.metadata.comments).toEqual([comment]);
  await expect(store.operate(editor,operation('Unknown','S001:ref-99'))).rejects.toThrow('safe text');
  await expect(store.operate(editor,operation('Structure','S001:ref-1',{value:{runs:[{paragraph:9,run:0,text:'Invalid structure'}]}}))).rejects.toThrow('paragraph');
});

test('rejects changed source, changed mapping, wrong geometry, and wrong object types without writing YAML',async () => {
  await fs.writeFile(inputPath(),Buffer.concat([original,Buffer.from('external change')]));
  await expect(store.operate(editor,operation('Blocked'))).rejects.toThrow('digest changed');
  expect(await fs.readFile(yamlPath(),'utf8')).toBe(originalYaml);
  await fs.writeFile(inputPath(),original);
  manifest.slides[0].shapes[0].x += .1; await writeManifest();
  await expect(store.operate(editor,operation('Blocked'))).rejects.toThrow('mapping changed');
  await restart();
  await expect(store.operate(editor,operation('Blocked'))).rejects.toThrow('geometry');
  manifest.slides[0].shapes[0].x -= .1; manifest.slides[0].shapes[0].kind = 'image'; await writeManifest(); await restart();
  await expect(store.operate(editor,operation('Blocked'))).rejects.toThrow('type');
  expect(await fs.readFile(yamlPath(),'utf8')).toBe(originalYaml);
});

test('enforces review protection, user roles, movement locks, and agent authorization boundaries',async () => {
  await expect(store.operate(reviewer,operation('Blocked'))).rejects.toThrow('Reviewers');
  store.lock(owner,{slideId:'S001',objectId:'S001:ref-1'});
  await expect(store.operate(editor,operation('Blocked'))).rejects.toThrow('moving');
  store.lock(owner,{slideId:'S001',objectId:'S001:ref-1',release:true});
  const deck = await source(); deck.slides[0].content['en-US'].review = 'locked';
  await fs.writeFile(yamlPath(),YAML.stringify(deck)); await store.refresh();
  await expect(store.operate(editor,operation('Blocked'))).rejects.toThrow('protected');
  await expect(store.operate(editor,operation('Blocked','S001:ref-1',{authorize:['S001']}))).rejects.toThrow('Only the session owner');
  await store.operate(owner,operation('Authorized title','S001:ref-1',{authorize:['S001']}));
  const comment = await store.comment(owner,{slideId:'S001',locale:'en-US',objectId:'S001:ref-1',message:'Suggest wording.',askAgent:true});
  const job = store.metadata.jobs.find(item => item.commentId === comment.id)!;
  await expect(store.propose(owner,job.id,{summary:'Unauthorized grant',operations:[operation('Agent text','S001:ref-1',{authorize:['S001']})]})).rejects.toThrow('cannot grant authorization');
});

test('preview input includes all edits; stale publication fails; undo and restart invalidate patched previews',async () => {
  await store.operate(editor,operation('First title'));
  const first = await store.nativePreviewInput('S001');
  await store.operate(editor,operation('Other literal','S002:ref-3',{slideId:'S002'}));
  const second = await store.nativePreviewInput('S001');
  expect(second.edits).toHaveLength(2); expect(second.source).toEqual(original); expect(second.index).toBe(0);
  const image = Buffer.from('updated preview');
  await fs.writeFile(path.join(folder,'output/reference/generated.png'),image);
  await expect(store.publishNativePreview('S001',first.sourceHash,'output/reference/generated.png',io.hash(image))).rejects.toThrow('older source');
  await store.publishNativePreview('S001',second.sourceHash,'output/reference/generated.png',io.hash(image));
  expect((await store.snapshot(owner,'en-US')).slides[0].reference?.status).toBe('current');
  const history = store.metadata.history.find(item => item.slideId === 'S001')!;
  await store.undo(editor,{id:history.id,expectedRevision:store.metadata.revision});
  expect((await store.snapshot(owner,'en-US')).slides[0].reference?.status).toBe('pending');
  const undone = await store.nativePreviewInput('S001');
  expect(undone.edits.every(edit=>edit.slidePart !== 'ppt/slides/slide1.xml')).toBe(true);
  await store.publishNativePreview('S001',undone.sourceHash,'output/reference/original.png',manifest.slides[0].sha256);
  expect((await store.snapshot(owner,'en-US')).slides[0].reference?.status).toBe('current');
  await restart();
  expect((await store.snapshot(owner,'en-US')).slides[1].reference?.status).toBe('pending');
});

test('preview failures stop retries for that source, while a subsequent edit makes the preview pending again',async () => {
  await store.operate(editor,operation('First title'));
  const first = await store.nativePreviewInput('S001');
  await store.failNativePreview('S001',first.sourceHash,'Renderer unavailable');
  expect((await store.snapshot(owner,'en-US')).slides[0].reference).toMatchObject({status:'failed',error:'Renderer unavailable'});
  await store.operate(editor,operation('Second title'));
  await store.failNativePreview('S001',first.sourceHash,'Stale error');
  expect((await store.snapshot(owner,'en-US')).slides[0].reference?.status).toBe('pending');
  await expect(store.operate(editor,{...operation('Generic'),kind:'text',objectId:'S001:title',value:'Generic'})).rejects.toThrow('bound to original');
});
