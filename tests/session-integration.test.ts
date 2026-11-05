import { afterAll, beforeAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import * as Y from 'yjs';
import YAML from 'yaml';
import JSZip from 'jszip';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const repo = process.cwd(), exec = promisify(execFile);
const loader = pathToFileURL(path.join(repo,'node_modules/tsx/dist/loader.mjs')).href;
let sandbox: string, child: ChildProcess, base: string;
let owner: string, editor: string, reviewer: string;
const data = (value: unknown) => JSON.stringify(value);
async function call(route: string, value?: unknown, cookie = owner) {
  const response = await fetch(`${base}${route}`, { method: value === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, ...(value === undefined ? {} : {'Content-Type':'application/json'}) }, body: value === undefined ? undefined : data(value) });
  return { status: response.status, body: await response.json() };
}
async function snapshot() { return (await call('/api/state')).body; }
async function operation(kind: string, value: unknown, slideId='S001', objectId='S001:body', extra: Record<string,unknown>={}) {
  const state = await snapshot();
  return call('/api/operations',{slideId,locale:'en-US',objectId,expectedRevision:state.revision,kind,value,...extra});
}
async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now()+15000;
  while (!await check()) { if(Date.now()>deadline) throw new Error('Condition was not reached'); await new Promise(resolve=>setTimeout(resolve,100)); }
}
beforeAll(async()=>{
  sandbox = await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-session-'));
  await fs.cp(path.join(repo,'config'),path.join(sandbox,'config'),{recursive:true});
  await exec(process.execPath,['--import',loader,path.join(repo,'src/cli/index.ts'),'setup','--yes','--project','demo','--no-render'],{cwd:sandbox,timeout:60000});
  const workerFile = path.join(sandbox,'test-worker.mjs');
  await fs.writeFile(workerFile,`let input='';for await(const chunk of process.stdin)input+=chunk;const r=JSON.parse(input);process.stdout.write(JSON.stringify({summary:'Fixture worker edited the requested body.',operations:[{slideId:r.job.slideId,locale:r.job.locale,objectId:r.job.slideId+':body',expectedRevision:r.revision,kind:'text',value:'Applied by the local fixture worker.',authorize:[]}]}));`);
  const config = path.join(sandbox,'agent.json');
  await fs.writeFile(config,data({command:process.execPath,args:[workerFile],autoApply:true}));
  child=spawn(process.execPath,['--import',loader,path.join(repo,'src/cli/index.ts'),'session','--project','demo','--agent-config',config],{cwd:sandbox,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const info = await new Promise<any>((resolve,reject)=>{
    let output='',errors='';const timer=setTimeout(()=>reject(new Error('Session startup timed out: '+errors)),20000);
    child.stderr!.on('data',chunk=>{errors+=chunk;});
    child.stdout!.on('data',chunk=>{output+=chunk;try{const value=JSON.parse(output);clearTimeout(timer);resolve(value);}catch{}});
    child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Session exited ${code}: ${errors}`));});
  });
  base=info.url;
  const join=async(link:string,name:string)=>{
    const token = new URLSearchParams(new URL(link).hash.slice(1)).get('token');
    const response=await fetch(base+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:data({token,name})});
    expect(response.status).toBe(200);return response.headers.get('set-cookie')!.split(';')[0];
  };
  owner=await join(info.owner,'Owner');editor=await join(info.editor,'Collaborator');reviewer=await join(info.reviewer,'Reviewer');
});
afterAll(async()=>{
  if(child&&!child.killed){child.kill();await new Promise<void>(resolve=>{child.once('exit',()=>resolve());setTimeout(resolve,1000);});}
  if(sandbox)await fs.rm(sandbox,{recursive:true,force:true});
});

test('serves a bundled editor and authenticated native-object scenes',async()=>{
  const page=await fetch(base);expect(await page.text()).toContain('/client.js');
  const script=await fetch(base+'/client.js');expect(script.status).toBe(200);expect((await script.text()).length).toBeGreaterThan(10000);
  expect((await call('/api/state',undefined,'')).status).toBe(401);
  const state=await snapshot();expect(state.slides).toHaveLength(5);expect(state.slides[0].scene.objects.some((o:any)=>o.id==='S001:title')).toBe(true);
  expect(state.texts['S001|en-US|S001:title']).toHaveProperty('generation');
});

test('blocks session export for an explicitly marked legacy presentation trial',async()=>{
  const marker=path.join(sandbox,'projects/demo/content/.block-session-export');
  await fs.writeFile(marker,'');
  try {
    const result=await call('/api/export',{locale:'en-US',render:false});
    expect(result.status).toBe(409);
    expect(result.body.error).toContain('custom layouts or media');
  } finally { await fs.unlink(marker); }
});

test('prevents another server and ordinary CLI writers from racing an active session',async()=>{
  const run=async(...args:string[])=>{
    try{await exec(process.execPath,['--import',loader,path.join(repo,'src/cli/index.ts'),...args],{cwd:sandbox,timeout:15000});return '';}
    catch(error){return (error as {stderr:string}).stderr;}
  };
  expect(await run('session','--project','demo','--port','0')).toContain('active session server');
  expect(await run('revise','--project','demo','--slide','S001','--message','Concurrent CLI writer')).toContain('active shared session');
});

test('merges simultaneous text inserts from two collaborators and rejects foreign Yjs structures',async()=>{
  const state=await snapshot(), text=state.texts['S001|en-US|S001:body'];
  const a=new Y.Doc(), b=new Y.Doc();
  Y.applyUpdate(a,Buffer.from(text.update,'base64'));Y.applyUpdate(b,Buffer.from(text.update,'base64'));
  a.getText('text').insert(0,'Alice ');b.getText('text').insert(0,'Bob ');
  const payload=(doc:Y.Doc)=>({slideId:'S001',locale:'en-US',objectId:'S001:body',generation:text.generation,update:Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')});
  const responses=await Promise.all([call('/api/text',payload(a),owner),call('/api/text',payload(b),editor)]);
  expect(responses.map(r=>r.status)).toEqual([200,200]);
  const after=await snapshot(), value=after.slides[0].scene.objects.find((o:any)=>o.id==='S001:body').text;
  expect(value).toContain('Alice');expect(value).toContain('Bob');
  a.getMap('foreign').set('unauthorized','value');
  expect((await call('/api/text',payload(a))).status).toBe(400);
  a.destroy();b.destroy();
});

test('prevents stale object writes, persists geometry, and safely undoes an isolated change',async()=>{
  const initial=await snapshot();
  const request={slideId:'S001',locale:'en-US',objectId:'S001:body',expectedRevision:initial.revision,kind:'geometry',value:{x:.8,y:5.2,w:11.5,h:1}};
  const first=await call('/api/operations',request);expect(first.status).toBe(200);
  expect((await call('/api/operations',{...request,value:{x:1}} ,editor)).status).toBe(409);
  const changed=first.body.state.slides[0].scene.objects.find((o:any)=>o.id==='S001:body');expect(changed.x).toBe(.8);
  const history=first.body.state.history.at(-1);
  expect((await call('/api/undo',{id:history.id,expectedRevision:first.body.state.revision})).status).toBe(200);
  const source=YAML.parse(await fs.readFile(path.join(sandbox,'projects/demo/content/slides.yaml'),'utf8'));
  expect(source.slides[0].visual_objects?.body).toBeUndefined();
});

test('enforces object movement locks and reviewer permissions',async()=>{
  expect((await call('/api/locks',{slideId:'S001',objectId:'S001:body'},editor)).status).toBe(200);
  expect((await operation('geometry',{x:1})).status).toBe(409);
  expect((await call('/api/locks',{slideId:'S001',objectId:'S001:body',release:true},editor)).status).toBe(200);
  const state=await snapshot();
  expect((await call('/api/operations',{slideId:'S001',locale:'en-US',objectId:'S001:body',expectedRevision:state.revision,kind:'text',value:'Forbidden'},reviewer)).status).toBe(403);
  expect((await call('/api/comments',{slideId:'S001',locale:'en-US',message:'Please review this.',askAgent:false},reviewer)).status).toBe(200);
});

test('local worker processes feedback and broadcasts a real saved agent revision',async()=>{
  const response=await call('/api/comments',{slideId:'S001',locale:'en-US',objectId:'S001:body',message:'Apply the fixture edit.',askAgent:true});expect(response.status).toBe(200);
  await waitFor(async()=> (await snapshot()).jobs.some((j:any)=>j.commentId===response.body.comment.id&&j.status==='applied'));
  const state=await snapshot();expect(state.slides[0].scene.objects.find((o:any)=>o.id==='S001:body').text).toBe('Applied by the local fixture worker.');
});

test('reviewer agent requests produce proposals without granting write authority',async()=>{
  const response=await call('/api/comments',{slideId:'S001',locale:'en-US',message:'Suggest a fixture edit.',askAgent:true},reviewer);
  await waitFor(async()=> (await snapshot()).jobs.some((j:any)=>j.commentId===response.body.comment.id&&j.status==='proposed'));
  const state=await snapshot(), job=state.jobs.find((j:any)=>j.commentId===response.body.comment.id);
  expect((await call(`/api/jobs/${job.id}/apply`,{},reviewer)).status).toBe(403);
  expect((await operation('text','Newer human wording.')).status).toBe(200);
  expect((await call(`/api/jobs/${job.id}/apply`,{})).status).toBe(409);
  expect((await snapshot()).jobs.find((j:any)=>j.id===job.id).status).toBe('conflict');
});

test.skipIf(!existsSync(chromium.executablePath()))('two real browsers edit inline, share feedback, and keep navigation usable',async()=>{
  const browser=await chromium.launch({headless:true});
  const errors:string[]=[];
  const contextFor=async(cookie:string)=>{
    const context=await browser.newContext({viewport:{width:1440,height:960}});
    const split=cookie.indexOf('=');
    await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);await page.locator('.scene-object').first().waitFor();return page;
  };
  try {
    const a=await contextFor(owner),b=await contextFor(editor);
    await a.locator('[data-object-id="S001:body"]').dblclick();
    const field=a.locator('textarea.inline-text');await field.waitFor();
    const original=await field.inputValue();
    await field.fill('Typed directly on the HTML slide.');
    await waitFor(async()=>(await snapshot()).slides[0].scene.objects.find((o:any)=>o.id==='S001:body').text==='Typed directly on the HTML slide.');
    await b.locator('[data-object-id="S001:body"]').filter({hasText:'Typed directly on the HTML slide.'}).waitFor();
    await field.fill(original);
    await waitFor(async()=>(await snapshot()).slides[0].scene.objects.find((o:any)=>o.id==='S001:body').text===original);
    await b.locator('[data-tab="comments"]').click();
    await b.locator('#comment-message').fill('Browser regression feedback.');
    await b.locator('#comment-form button[type=submit]').click();
    await a.locator('[data-slide="S002"]').click();
    await a.locator('[data-slide="S001"]').click();
    await a.locator('[data-tab="comments"]').click();
    await a.locator('.comment-body').filter({hasText:'Browser regression feedback.'}).waitFor();
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
},60000);

test('saves custom boxes and images, exports actual editable PPTX, and retains history',async()=>{
  const id='object-'+crypto.randomUUID();
  const added=await operation('add',{id,type:'text',text:'Editable annotation',x:1,y:6.5,w:7,h:.35,style:{fontSize:18}},'S001',undefined as any);
  expect(added.status).toBe(200);
  const image=await sharp({create:{width:40,height:40,channels:3,background:'#225e63'}}).png().toBuffer();
  const upload=await fetch(base+'/api/uploads',{method:'POST',headers:{Cookie:owner,'Content-Type':'image/png'},body:image});expect(upload.status).toBe(200);
  const {asset}=await upload.json();
  const imageId='object-'+crypto.randomUUID();
  expect((await operation('add',{id:imageId,type:'image',asset,alt:'A fictional teal test square.',x:11,y:6.2,w:.5,h:.5},'S001',undefined as any)).status).toBe(200);
  const build=await call('/api/export',{locale:'en-US',render:false});expect(build.status,JSON.stringify(build.body)).toBe(200);
  const response=await fetch(base+'/api/exports?file=presentation.en-US.pptx',{headers:{Cookie:owner}});expect(response.status).toBe(200);
  const zip=await JSZip.loadAsync(await response.arrayBuffer());
  const xml=await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect(xml).toContain('Editable annotation');expect(xml).toContain('S001:'+id);expect(xml).toContain('<p:pic>');
  const french=await call('/api/state?locale=fr-FR');expect(french.status).toBe(200);
  expect(french.body.issues.some((issue:any)=>issue.slide==='S001'&&issue.locale==='fr-FR')).toBe(true);
  expect(french.body.slides[0].scene.objects.find((o:any)=>o.role===id).missingTranslation).toBe(true);
  const feedback=await fs.readdir(path.join(sandbox,'projects/demo/feedback'));expect(feedback.some(name=>name.endsWith('.before.yaml'))).toBe(true);
});

test('detects external source edits and invalidates collaborative text generations',async()=>{
  const state=await snapshot(), old=state.texts['S001|en-US|S001:body'];
  const file=path.join(sandbox,'projects/demo/content/slides.yaml');
  const deck=YAML.parse(await fs.readFile(file,'utf8'));deck.slides[0].content['en-US'].body='Externally authored wording.';
  await fs.writeFile(file,YAML.stringify(deck));
  const response=await call('/api/text',{slideId:'S001',locale:'en-US',objectId:'S001:body',generation:old.generation,update:old.update});expect(response.status).toBe(409);
  expect((await snapshot()).slides[0].scene.objects.find((o:any)=>o.id==='S001:body').text).toBe('Externally authored wording.');
});
