import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { writeRevisionPreviews, type PreviewSlide } from '../src/rendering/revision-previews.js';

test('reordered previews pair stable IDs, record unchanged protected assets and reject tampered baselines',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pptimistic-preview-'));
  try {
    const old=path.join(root,'old'), next=path.join(root,'next'), third=path.join(root,'third');
    for (const folder of [old,next,third]) {
      await fs.mkdir(folder);
      for (const [i,background] of ['#fff','#000'].entries()) await sharp({create:{width:32,height:18,channels:3,background}}).png().toFile(path.join(folder,`slide-${i+1}.png`));
    }
    const asset={path:'assets/accepted.png',sha256:'original-asset-hash'};
    const baseline:PreviewSlide[]=[{id:'A',fingerprint:'one',protected:true,acceptedAsset:asset},{id:'B',fingerprint:'two',protected:false}];
    const first=await writeRevisionPreviews(old,['slide-1.png','slide-2.png'],baseline,'fr-FR','old-deck');
    expect(first.slides.A.change).toBe('baseline-unavailable');
    const report=await writeRevisionPreviews(next,['slide-1.png','slide-2.png'],[baseline[1],{...baseline[0],fingerprint:'revised'}],'fr-FR','new-deck',old);
    expect(report.slides.A).toMatchObject({change:'changed',protected:true,acceptedAssetPreserved:true,before:'by-id/A.before.png',comparison:'by-id/A.comparison.png'});
    expect(report.slides.B.change).toBe('unchanged');
    expect(await fs.readFile(path.join(next,report.slides.A.before!))).toEqual(await fs.readFile(path.join(old,'slide-1.png')));
    expect((await sharp(path.join(next,report.slides.A.comparison!)).metadata()).width).toBe(1944);
    await fs.appendFile(path.join(old,'by-id/A.after.png'),'external-edit');
    const tampered=await writeRevisionPreviews(third,['slide-1.png','slide-2.png'],baseline,'fr-FR','third-deck',old);
    expect(tampered.slides.A.change).toBe('baseline-unavailable');
    expect(tampered.slides.A.before).toBeUndefined();
    const removalFolder=path.join(root,'removed');await fs.mkdir(removalFolder);
    const removal=await writeRevisionPreviews(removalFolder,[],[],'fr-FR','removed-deck',next);
    expect(removal.slides.A).toMatchObject({change:'removed',protected:true,before:'by-id/A.before.png'});
    expect(removal.slides.A.after).toBeUndefined();
    await expect(writeRevisionPreviews(third,['slide-1.png'],baseline,'fr-FR','bad')).rejects.toThrow('2 stable slide IDs');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
