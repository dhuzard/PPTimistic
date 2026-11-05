import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const adapter=path.resolve('scripts/session-codex-agent.mjs');
function run(input:unknown,env:Record<string,string>) { return new Promise<{code:number|null,out:string,err:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,[adapter],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']}); let out='',err='';
  child.stdout.on('data',v=>out+=v); child.stderr.on('data',v=>err+=v);child.on('error',reject);child.on('close',code=>resolve({code,out,err}));child.stdin.end(JSON.stringify(input));
}); }
const input={protocol:'pptimistic-agent-v1',job:{slideId:'S1',locale:'en-US'},revision:4,slide:{content:'source data',visual:{asset:'assets/example.png'}}};

test('requires both approvals before spawning a provider',async()=>{
  const result=await run(input,{PPTIMISTIC_AGENT_EXTERNAL_APPROVED:'1',PPTIMISTIC_AGENT_PAID_APPROVED:'0'});
  expect(result.code).not.toBe(0); expect(result.err).toContain('explicit external transmission and paid-call approval');
});

test('runs Codex in an isolated temporary directory and validates structured results',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-adapter-test-'));
  try {
    const preload=path.join(temp,'fake.cjs'), capture=path.join(temp,'capture.json');
    await fs.writeFile(preload,`if (process.argv[1] && process.argv[1].endsWith('exec')) { const fs=require('fs');const args=process.argv.slice(2);const prompt=fs.readFileSync(0,'utf8');const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));fs.writeFileSync(process.env.CAPTURE,JSON.stringify({args,prompt,cwd:process.cwd(),schema}));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({summary:'Review',operations:[process.env.FAKE_OPERATION ? JSON.parse(process.env.FAKE_OPERATION) : {slideId:process.env.BAD_SLIDE?'S2':'S1',locale:'en-US',objectId:'S1:title',expectedRevision:4,kind:'text',value:'New title',authorize:[]}]}));process.exit(0); }`);
    const result=await run(input,{PPTIMISTIC_AGENT_EXTERNAL_APPROVED:'1',PPTIMISTIC_AGENT_PAID_APPROVED:'1',PPTIMISTIC_CODEX_COMMAND:process.execPath,NODE_OPTIONS:`--require="${preload.replaceAll('\\','/')}"`,CAPTURE:capture});
    expect(result.code,result.err).toBe(0); expect(JSON.parse(result.out).operations[0].value).toBe('New title');
    const trace=JSON.parse(await fs.readFile(capture,'utf8'));
    expect(trace.args).toEqual(expect.arrayContaining(['--sandbox','read-only','--ephemeral','--ignore-user-config','--skip-git-repo-check','--output-schema']));
    expect(trace.prompt).toContain('source data'); expect(trace.schema.properties.operations.items.properties.kind.enum).toEqual(['text','geometry','style','image']);
    await expect(fs.stat(trace.cwd)).rejects.toMatchObject({code:'ENOENT'});
    const rejected=await run(input,{PPTIMISTIC_AGENT_EXTERNAL_APPROVED:'1',PPTIMISTIC_AGENT_PAID_APPROVED:'1',PPTIMISTIC_CODEX_COMMAND:process.execPath,NODE_OPTIONS:`--require="${preload.replaceAll('\\','/')}"`,CAPTURE:capture,BAD_SLIDE:'1'});
    expect(rejected.code).not.toBe(0); expect(rejected.err).toContain('out-of-scope');
    const base={slideId:'S1',locale:'en-US',objectId:'S1:title',expectedRevision:4,authorize:[]};
    const env={PPTIMISTIC_AGENT_EXTERNAL_APPROVED:'1',PPTIMISTIC_AGENT_PAID_APPROVED:'1',PPTIMISTIC_CODEX_COMMAND:process.execPath,NODE_OPTIONS:`--require="${preload.replaceAll('\\','/')}"`,CAPTURE:capture};
    for (const operation of [{...base,kind:'geometry',value:{x:1,y:1,w:3,h:2}},{...base,kind:'style',value:{color:'112233'}},{...base,kind:'image',value:{asset:'assets/example.png',alt:'Example'}}]) {
      const accepted=await run(input,{...env,FAKE_OPERATION:JSON.stringify(operation)});
      expect(accepted.code,accepted.err).toBe(0);
    }
    for (const asset of ['https://example.com/image.png','assets/other.png']) {
      const invalid=await run(input,{...env,FAKE_OPERATION:JSON.stringify({...base,kind:'image',value:{asset,alt:'Example'}})});
      expect(invalid.code).not.toBe(0); expect(invalid.err).toContain('out-of-scope');
    }

  } finally {
    const target=path.resolve(temp);
    if (path.dirname(target)!==path.resolve(os.tmpdir()) || !path.basename(target).startsWith('pptimistic-adapter-test-')) throw new Error('Unexpected test directory');
    await fs.rm(target,{recursive:true,force:true});
  }
});
