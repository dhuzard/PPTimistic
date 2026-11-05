import { afterAll, beforeAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { deckSchema, projectSchema, themeSchema } from '../src/core/model.js';
import { fingerprints, protectionIssues, sourceFingerprint } from '../src/core/build.js';
import { validateContent } from '../src/validation/index.js';
import { consistency, importTranslations, translationSourceFingerprint } from '../src/localization/index.js';

const textId='object-12345678-1234-4234-8234-123456789abc';
const imageId='object-22345678-1234-4234-8234-123456789abc';
const theme=themeSchema.parse({name:'fixture',font:'Arial',background:'FFFFFF',foreground:'161616',secondary:'555555',accent:'005555',pale:'EEEEEE',heading:32,body:24,margin:.6});
const config=projectSchema.parse({version:1,title:'Custom objects',source_locale:'en-US',output_locales:['en-US','fr-FR']});
let sandbox:string;
beforeAll(async()=>{sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-scene-safeguards-'));await fs.mkdir(path.join(sandbox,'assets'));await fs.writeFile(path.join(sandbox,'assets/figure.png'),'retained asset bytes');});
afterAll(async()=>{await fs.rm(sandbox,{recursive:true,force:true});});
function fixture() {
  return deckSchema.parse({version:1,slides:[{id:'S1',layout:'statement',evidence:'conceptual',content:{
    'en-US':{title:'An observation',objects:{[textId]:{text:'Dose: 8 mg'},[imageId]:{alt:'A supplied diagram'}}},
    'fr-FR':{title:'Une observation',objects:{[textId]:{text:'Dose : 8 mg'},[imageId]:{alt:'Un schéma fourni'}}}
  },objects:[{id:textId,type:'text',x:1,y:5,w:3,h:.5},{id:imageId,type:'image',x:8,y:3,w:2,h:2,asset:'assets/figure.png',accepted:true}]}]});
}

test('custom image bytes participate in freshness and independent accepted-asset protection',async()=>{
  const deck=fixture(),before=await fingerprints(sandbox,deck,theme),fingerprint=await sourceFingerprint(sandbox,config,deck,theme,'en-US');
  expect(before.S1.acceptedAssets?.[imageId]).toMatchObject({path:'assets/figure.png'});
  await fs.writeFile(path.join(sandbox,'assets/figure.png'),'changed asset bytes');
  const after=await fingerprints(sandbox,deck,theme);
  expect(await sourceFingerprint(sandbox,config,deck,theme,'en-US')).not.toBe(fingerprint);
  expect(protectionIssues({version:2,files:{},slides:before},after,[])).toEqual([expect.stringContaining('accepted custom image changed')]);
  expect(protectionIssues({version:2,files:{},slides:before},after,['S1'])).toEqual([]);
  await fs.writeFile(path.join(sandbox,'assets/figure.png'),'retained asset bytes');
  deck.slides[0].objects![1].accepted=false;
  expect(protectionIssues({version:2,files:{},slides:before},await fingerprints(sandbox,deck,theme),[])).toEqual([expect.stringContaining('acceptance removed')]);
});

test('custom objects require complete localized text and descriptions and retain scientific tokens',async()=>{
  const deck=fixture(),slide=deck.slides[0];
  expect((await validateContent(sandbox,config,deck,theme)).filter(issue=>issue.severity==='error')).toEqual([]);
  delete slide.content['fr-FR'].objects;
  const issues=await validateContent(sandbox,config,deck,theme);
  expect(issues).toContainEqual(expect.objectContaining({code:'missing-object-translation',slide:'S1',locale:'fr-FR'}));
  expect(issues).toContainEqual(expect.objectContaining({code:'alt-text',slide:'S1',locale:'fr-FR'}));
  expect(()=>importTranslations(deck,'en-US','fr-FR',[],{from:'en-US',to:'fr-FR',slides:[{id:'S1',translation:slide.content['fr-FR']}]})).toThrow('localized content is required');
  slide.content['fr-FR'].objects={[textId]:{text:'Dose : 80 mg'},[imageId]:{alt:'Un schéma fourni'}};
  expect(consistency(slide.content['en-US'],slide.content['fr-FR'],[])).toContain(`objects.${textId}.text: numbers, units, DOI or statistical notation differ`);
  const old=translationSourceFingerprint(slide,'en-US');
  slide.objects![1].asset='assets/another.png';
  expect(translationSourceFingerprint(slide,'en-US')).not.toBe(old);
});

test('duplicate object IDs, invisible text and hidden source objects fail source validation',async()=>{
  const deck=fixture();
  deck.slides[0].objects!.push(structuredClone(deck.slides[0].objects![0]));
  deck.slides[0].visual_objects={title:{hidden:true,style:{color:'FFFFFF'}}};
  const issues=await validateContent(sandbox,config,deck,theme);
  expect(issues).toContainEqual(expect.objectContaining({code:'duplicate-object-id'}));
  expect(issues).toContainEqual(expect.objectContaining({code:'protected-object'}));
  expect(issues).toContainEqual(expect.objectContaining({code:'object-contrast'}));
});
