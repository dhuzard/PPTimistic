import { expect, test } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { applyNativeOverrides, buildNativeEdits, importPptxScene, patchPptxScene } from '../src/session/pptx-native.js';

async function fixture() {
  const deck = new PptxGenJS(); deck.layout = 'LAYOUT_WIDE';
  const slide = deck.addSlide(); slide.addText('Original & text', { x: 1, y: 1, w: 3, h: 1 });
  const original = Buffer.from(await deck.write({ outputType: 'nodebuffer' }) as ArrayBuffer);
  const zip = await JSZip.loadAsync(original); zip.file('ppt/media/video1.mp4', Buffer.from([0,1,2,3,255]));
  return zip.generateAsync({ type: 'nodebuffer' });
}
test('no edits preserve every original byte; supported edits preserve all other entry payloads', async () => {
  const bytes = await fixture(), scene = await importPptxScene(bytes);
  expect(await patchPptxScene(bytes, scene.digest, [])).toEqual(bytes);
  const slide = scene.slides[0], object = slide.objects.find(o => o.textEditable && o.geometryEditable)!;
  expect(object).toBeDefined();
  const patched = await patchPptxScene(bytes, scene.digest, [{ slidePart: slide.part, objectId: object.id,
    runs: object.runs.map(r => ({ ...r, text: ' <Revised & exact> ' })), geometry: { x: 42, y: 84, cx: 1000000, cy: 2000000 } }]);
  const after = await importPptxScene(patched), updated = after.slides[0].objects.find(o => o.id === object.id)!;
  expect(updated.runs[0].text).toBe(' <Revised & exact> ');
  expect(updated.geometry).toEqual({ x: 42, y: 84, cx: 1000000, cy: 2000000 });
  const beforeZip = await JSZip.loadAsync(bytes), afterZip = await JSZip.loadAsync(patched);
  expect(Object.keys(afterZip.files).sort()).toEqual(Object.keys(beforeZip.files).sort());
  for (const name of Object.keys(beforeZip.files).filter(n => n !== slide.part && !beforeZip.files[n].dir))
    expect(await afterZip.file(name)!.async('nodebuffer')).toEqual(await beforeZip.file(name)!.async('nodebuffer'));
});
test('rejects stale digest, unknown objects, altered run structure and invalid geometry', async () => {
  const bytes = await fixture(), scene = await importPptxScene(bytes), slide = scene.slides[0], object = slide.objects.find(o => o.textEditable && o.geometryEditable)!;
  await expect(patchPptxScene(bytes, 'wrong', [])).rejects.toThrow('digest');
  await expect(patchPptxScene(bytes, scene.digest, [{slidePart: slide.part, objectId: 'unknown', runs: []}])).rejects.toThrow('Unknown');
  await expect(patchPptxScene(bytes, scene.digest, [{slidePart: slide.part, objectId: object.id, runs: []}])).rejects.toThrow('Run structure');
  await expect(patchPptxScene(bytes, scene.digest, [{slidePart: slide.part, objectId: object.id, geometry: {x:0,y:0,cx:0,cy:1}}])).rejects.toThrow('geometry');
});

test('serialized overrides preserve individual run and paragraph structure and formatting', async () => {
  const source = await fixture(); const zip = await JSZip.loadAsync(source);
  const part = 'ppt/slides/slide1.xml'; let xml = await zip.file(part)!.async('string');
  const paragraph = xml.match(/<a:p>[\s\S]*?<\/a:p>/)![0];
  const run = paragraph.match(/<a:r>[\s\S]*?<\/a:r>/)![0];
  const secondRun = run.replace('Original &amp; text', 'Second').replace('lang="en-US"', 'lang="fr-FR"');
  const first = paragraph.replace(run, run + secondRun);
  const second = paragraph.replace('Original &amp; text', 'Third');
  xml = xml.replace(paragraph, first + second); zip.file(part, xml);
  const bytes = await zip.generateAsync({type:'nodebuffer'}), scene = await importPptxScene(bytes);
  const object = scene.slides[0].objects.find(o => o.textEditable)!;
  expect(object.runs.map(r => [r.paragraph,r.run,r.text])).toEqual([[0,0,'Original & text'],[0,1,'Second'],[1,0,'Third']]);
  const runs = object.runs.map((r,i) => ({...r,text:['A','B & C','D'][i]}));
  const geometry = { x: -10, y: 3, cx: 50, cy: 60 };
  const overrides = JSON.parse(JSON.stringify({[part]: {[object.id]: {runs,geometry}}}));
  const edits = buildNativeEdits(scene,overrides), effective = applyNativeOverrides(scene,overrides);
  expect(effective.slides[0].objects.find(o=>o.id===object.id)!.runs).toEqual(runs);
  expect(object.runs[0].text).toBe('Original & text');
  expect(object.geometry).not.toEqual(geometry);
  const patched = await patchPptxScene(bytes,scene.digest,edits), result = await importPptxScene(patched);
  expect(result.slides[0].objects.find(o=>o.id===object.id)!.runs).toEqual(runs);
  expect(result.slides[0].objects.find(o=>o.id===object.id)!.geometry).toEqual(geometry);
  const resultZip = await JSZip.loadAsync(patched), resultXml = await resultZip.file(part)!.async('string');
  const removeText = (s:string) => s.replace(/<a:t(?:\s[^>]*)?>[^<]*<\/a:t>/g,'<text/>').replace(/<a:off\b[^>]*\/>/g,'<off/>').replace(/<a:ext\b[^>]*\/>/g,'<ext/>');
  expect(removeText(resultXml)).toBe(removeText(xml));
});
test('override validation rejects stale keys, changed runs, unsupported objects and invalid dimensions', async () => {
  const bytes = await fixture(), scene = await importPptxScene(bytes), slide = scene.slides[0], object = slide.objects.find(o => o.textEditable && o.geometryEditable)!;
  const asOverrides = (value: unknown) => ({[slide.part]: {[object.id]: value}}) as any;
  expect(() => buildNativeEdits(scene, {'ppt/slides/stale.xml': {}})).toThrow('Unknown slide');
  expect(() => buildNativeEdits(scene, {[slide.part]: {'stale': {runs: object.runs}}})).toThrow('Unknown slide object');
  expect(() => buildNativeEdits(scene, asOverrides({runs: [{...object.runs[0],run: 5}]}))).toThrow('Run structure');
  expect(() => applyNativeOverrides(scene, asOverrides({runs: [{...object.runs[0],text: '\u0001'}]}))).toThrow('invalid text');
  expect(() => buildNativeEdits(scene, asOverrides({geometry: {x:0,y:0,cx:-1,cy:1}}))).toThrow('Invalid geometry');
  expect(() => buildNativeEdits(scene, asOverrides({geometry: {x:0,y:0,cx:1,cy:0}}))).toThrow('Invalid geometry');
  expect(() => buildNativeEdits(scene, asOverrides({geometry: {x:0,y:0,cx:1,cy:1},extra:true}))).toThrow('Invalid object override');
  const duplicate = structuredClone(scene); duplicate.slides[0].objects.find(o=>o.id===object.id)!.duplicateShapeId = true;
  expect(() => buildNativeEdits(duplicate, asOverrides({runs:object.runs}))).toThrow('Unsupported text');
});

test('imported duplicate shape identifiers and unsupported fields remain locked', async () => {
  const bytes = await fixture(), zip = await JSZip.loadAsync(bytes), part = 'ppt/slides/slide1.xml';
  let xml = await zip.file(part)!.async('string');
  const shape = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/)![0];
  xml = xml.replace(shape, shape + shape); zip.file(part,xml);
  const duplicateScene = await importPptxScene(await zip.generateAsync({type:'nodebuffer'}));
  const objects = duplicateScene.slides[0].objects;
  expect(objects).toHaveLength(2);
  expect(objects[0].id).not.toBe(objects[1].id);
  expect(objects.map(o=>o.ordinal)).toEqual([0,1]);
  expect(objects.every(o=>o.duplicateShapeId && !o.textEditable && !o.geometryEditable)).toBe(true);
  expect(() => buildNativeEdits(duplicateScene, {[part]: {[objects[0].id]: {runs: objects[0].runs}}})).toThrow('Unsupported text');
  const fieldZip = await JSZip.loadAsync(bytes); let fieldXml = await fieldZip.file(part)!.async('string');
  fieldXml = fieldXml.replace('<a:r>', '<a:fld id="{00000000-0000-0000-0000-000000000001}" type="slidenum"><a:t>1</a:t></a:fld><a:r>');
  fieldZip.file(part,fieldXml);
  const fieldScene = await importPptxScene(await fieldZip.generateAsync({type:'nodebuffer'}));
  const field = fieldScene.slides[0].objects[0];
  expect(field.textEditable).toBe(false);
  expect(() => buildNativeEdits(fieldScene, {[part]: {[field.id]: {runs:field.runs}}})).toThrow('Unsupported text');
});
