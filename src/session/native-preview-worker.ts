import {atomicWrite,exists,hash,hashFile,safePath} from '../core/io.js';
import {renderNativePreview} from './render-native.js';
import {SessionError,type SessionStore} from './store.js';
import type {Actor} from './contracts.js';

const system:Actor={id:'local-native-preview',name:'Preview renderer',role:'owner'};

/** Serialize PowerPoint previews; stale results are discarded before publication. */
export class NativePreviewWorker {
  private timer?:ReturnType<typeof setTimeout>;
  private running?:Promise<void>;
  private stopped=false;
  private requested=false;
  constructor(private store:SessionStore) {}
  schedule=()=>{
    if(this.stopped||this.timer)return;
    if(this.running){this.requested=true;return;}
    this.timer=setTimeout(()=>{this.timer=undefined;this.running=this.drain().finally(()=>{this.running=undefined;});},500);
  };
  private async drain() {
    if(this.stopped)return;
    let processed=false;
    try {
      const state=await this.store.run(()=>this.store.snapshot(system,this.store.loaded.config.source_locale));
      const slide=state.slides.find(item=>item.reference?.status==='pending');
      if(!slide)return;
      processed=true;
      let input:Awaited<ReturnType<SessionStore['nativePreviewInput']>>;
      const expectedSourceHash=this.store.metadata.sourceHash;
      try {input=await this.store.run(()=>this.store.nativePreviewInput(slide.id));}
      catch(error) {await this.store.failNativePreview(slide.id,expectedSourceHash,(error as Error).message).catch(()=>undefined);return;}
      try {
        const png=await renderNativePreview({source:input.source,digest:input.digest,edits:input.edits,index:input.index+1});
        const digest=hash(png), relative=`output/reference/generated-${slide.id}-${digest}.png`;
        const file=await safePath(this.store.loaded.dir,relative);
        if(await exists(file)) {if(await hashFile(file)!==digest)throw new Error('Stored preview differs from its recorded hash.');}
        else await atomicWrite(file,png);
        await this.store.publishNativePreview(slide.id,input.sourceHash,relative,digest);
      } catch(error) {
        if(!(error instanceof SessionError && error.status===409)) await this.store.failNativePreview(slide.id,input.sourceHash,(error as Error).message);
      }
    } catch { /* Source reconciliation or a stopped session will be visible on the next request. */ }
    finally { if(!this.stopped && (processed||this.requested)) {this.requested=false;this.running=undefined;this.schedule();} }
  }
  async stop(){this.stopped=true;clearTimeout(this.timer);await this.running;}
}
