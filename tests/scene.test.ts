import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { slideSchema, themeSchema } from '../src/core/model.js';
import { buildSlideScene } from '../src/core/scene.js';
import { drawSlide } from '../src/layouts/index.js';
import { demoDeck } from '../src/content/demo.js';

const theme=themeSchema.parse({name:'fixture',font:'Arial',background:'FFFFFF',foreground:'161616',secondary:'555555',accent:'005555',pale:'EEEEEE',heading:32,body:24,margin:.6});
const id='object-12345678-1234-4234-8234-123456789abc';
function fixture() { return slideSchema.parse({id:'S1',layout:'statement',content:{'en-US':{title:'Title',message:'Message',objects:{[id]:{text:'Editable custom text'}}}},visual_objects:{title:{x:1.2,style:{color:'112233',fontSize:30}}},objects:[{id,type:'text',x:1,y:5,w:3,h:.6}]}); }

test('shared scene bindings and overrides reach native PowerPoint objects',async()=>{
  const slide=fixture();
  const scene=await buildSlideScene(slide,slide.content['en-US'],theme,'en-US','',0);
  expect(scene.objects.find(o=>o.role==='title')).toMatchObject({id:'S1:title',x:1.2,binding:{field:'title'},options:{color:'112233',fontSize:30}});
  expect(scene.objects.find(o=>o.role===id)).toMatchObject({type:'text',text:'Editable custom text',binding:{field:'objects',id,property:'text'}});
  const pptx=new PptxGenJS(); pptx.layout='LAYOUT_WIDE';
  const geometry=await drawSlide(pptx,slide,slide.content['en-US'],theme,'en-US','',0);
  expect(geometry.boxes.find(o=>o.role==='title')).toMatchObject({x:1.2,font:30});
  const zip=await JSZip.loadAsync(await pptx.write({outputType:'nodebuffer'}) as Buffer);
  const xml=await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect(xml).toContain('Editable custom text');
  expect(xml).toContain('112233');
  expect(xml).toContain('x="1097280"');
});

test('missing localized custom text and hidden source objects fail closed',async()=>{
  const slide=fixture();
  slide.content['en-US'].objects={};
  await expect(buildSlideScene(slide,slide.content['en-US'],theme,'en-US','',0)).rejects.toThrow('Missing en-US text');
  slide.visual_objects!.title={hidden:true};
  await expect(buildSlideScene(slide,slide.content['en-US'],theme,'en-US','',0)).rejects.toThrow('Cannot hide source object');
});

test('edited chart colors and custom text fills are present in native PowerPoint XML',async()=>{
  const chart=demoDeck('Native styles').slides[3];
  chart.visual_objects={chart:{style:{color:'A13344',fill:'F0F1F2'}}};
  const scene=await buildSlideScene(chart,chart.content['en-US'],theme,'en-US','',0);
  expect(scene.objects.find(object=>object.role==='chart')?.options).toMatchObject({chartColors:['A13344'],chartArea:{fill:{color:'F0F1F2'}},plotArea:{fill:{color:'F0F1F2'}}});
  const text=fixture();text.objects![0].style={fill:'EEEEDD'};
  const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';
  await drawSlide(pptx,chart,chart.content['en-US'],theme,'en-US','',0);
  await drawSlide(pptx,text,text.content['en-US'],theme,'en-US','',1);
  const zip=await JSZip.loadAsync(await pptx.write({outputType:'nodebuffer'}) as Buffer);
  const xml=await zip.file('ppt/charts/chart1.xml')!.async('string');
  expect(xml).toContain('A13344');expect(xml).toContain('F0F1F2');
  expect(await zip.file('ppt/slides/slide2.xml')!.async('string')).toContain('EEEEDD');
});

test('native images preserve the same aspect ratio as the browser after resizing',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-scene-image-'));
  try {
    await sharp({create:{width:400,height:100,channels:3,background:'#229966'}}).png().toFile(path.join(dir,'image.png'));
    const slide=slideSchema.parse({id:'I1',layout:'statement',content:{'en-US':{title:'Image proportions',objects:{[id]:{alt:'A wide green rectangle'}}}},objects:[{id,type:'image',x:1,y:3,w:2,h:2,asset:'image.png'}]});
    const scene=await buildSlideScene(slide,slide.content['en-US'],theme,'en-US',dir,0);
    expect(scene.objects.find(object=>object.role===id)).toMatchObject({w:2,h:2,imageAspectRatio:4});
    const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';await drawSlide(pptx,slide,slide.content['en-US'],theme,'en-US',dir,0);
    const zip=await JSZip.loadAsync(await pptx.write({outputType:'nodebuffer'}) as Buffer);
    const picture=(await zip.file('ppt/slides/slide1.xml')!.async('string')).match(/<p:pic>[\s\S]*?<\/p:pic>/)![0];
    expect(picture).toContain('cx="1828800" cy="457200"');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});


test('editor can expose a missing translation without weakening builds',async()=>{
  const slide=fixture();
  slide.content['en-US'].objects={};
  const scene=await buildSlideScene(slide,slide.content['en-US'],theme,'en-US','',0,{allowMissingTranslations:true});
  expect(scene.objects.find(o=>o.role===id)).toMatchObject({text:'',missingTranslation:true,binding:{field:'objects',id,property:'text'}});
  const pptx=new PptxGenJS();
  await expect(drawSlide(pptx,slide,slide.content['en-US'],theme,'en-US','',0)).rejects.toThrow('Missing en-US text');
});
