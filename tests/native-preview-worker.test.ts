import {afterEach,expect,test,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {NativePreviewWorker} from '../src/session/native-preview-worker.js';
import type {SessionStore} from '../src/session/store.js';

vi.mock('../src/session/render-native.js',()=>({renderNativePreview:vi.fn(async()=>Buffer.from('rendered fixture'))}));
let folder:string,worker:NativePreviewWorker;
afterEach(async()=>{await worker?.stop();if(folder)await fs.rm(folder,{recursive:true,force:true});});
test('renders a pending native revision and publishes the exact hashed output once',async()=>{
  folder=await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-preview-worker-'));
  await fs.mkdir(path.join(folder,'output/reference'),{recursive:true});
  let status='pending',calls=0;
  const fake={
    loaded:{dir:folder,config:{source_locale:'en-US'}},metadata:{sourceHash:'source-before'},
    run:async<T>(fn:()=>Promise<T>)=>fn(),
    snapshot:async()=>({slides:[{id:'S001',reference:{status}}]}),
    nativePreviewInput:async()=>({source:Buffer.from('source'),digest:'digest',edits:[],index:0,revision:1,sourceHash:'source-before'}),
    publishNativePreview:async(id:string,sourceHash:string,file:string,digest:string)=>{expect(id).toBe('S001');expect(sourceHash).toBe('source-before');expect(await fs.readFile(path.join(folder,file))).toEqual(Buffer.from('rendered fixture'));expect(digest).toHaveLength(64);calls++;status='current';},
    failNativePreview:async()=>{throw new Error('Unexpected render failure');},
  } as unknown as SessionStore;
  worker=new NativePreviewWorker(fake);worker.schedule();
  await vi.waitFor(()=>expect(calls).toBe(1),{timeout:4000,interval:50});
  await new Promise(resolve=>setTimeout(resolve,700));expect(calls).toBe(1);
});
