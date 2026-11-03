import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { atomicWrite, exists, hashFile, safePath } from '../core/io.js';

export type PreviewSlide = {
  id: string; fingerprint: string; protected: boolean;
  acceptedAsset?: {path: string; sha256: string};
};
type Entry = PreviewSlide & {
  after?: string; afterSha256?: string; before?: string; comparison?: string;
  change: 'added' | 'changed' | 'unchanged' | 'removed' | 'baseline-unavailable';
  acceptedAssetPreserved?: boolean;
};
type PreviewManifest = {version: 1; locale: string; pptxSha256: string; slides: Record<string, Entry>};

/** Match renders by stable slide ID, never by page number across revisions.
 * A historical image is usable only if its stored hash still matches.
 */
export async function writeRevisionPreviews(folder: string, files: string[], slides: PreviewSlide[], locale: string, pptxSha256: string, previousFolder?: string) {
  if (files.length !== slides.length) throw new Error(`Renderer produced ${files.length} pages for ${slides.length} stable slide IDs.`);
  let previous: PreviewManifest | undefined;
  if (previousFolder && await exists(path.join(previousFolder, 'revision-previews.json'))) {
    previous = JSON.parse(await fs.readFile(path.join(previousFolder, 'revision-previews.json'), 'utf8'));
    if (previous?.version !== 1 || previous.locale !== locale) previous = undefined;
  }
  await fs.mkdir(path.join(folder, 'by-id'), {recursive: true});
  const entries: Record<string, Entry> = {};
  for (const [i, slide] of slides.entries()) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(slide.id) || entries[slide.id]) throw new Error('Invalid or duplicate stable slide ID in render.');
    const after = `by-id/${slide.id}.after.png`;
    await fs.copyFile(await safePath(folder, files[i]), await safePath(folder, after));
    const old = previous?.slides[slide.id];
    const entry: Entry = {...slide, after, afterSha256: await hashFile(path.join(folder, after)),
      change: old ? old.fingerprint === slide.fingerprint ? 'unchanged' : 'changed' : previous ? 'added' : 'baseline-unavailable'};
    if (old?.acceptedAsset) entry.acceptedAssetPreserved = Boolean(slide.acceptedAsset && old.acceptedAsset.path === slide.acceptedAsset.path && old.acceptedAsset.sha256 === slide.acceptedAsset.sha256);
    if (old?.after && old.afterSha256 && previousFolder) {
      const beforeFile = await safePath(previousFolder, old.after);
      if (await exists(beforeFile) && await hashFile(beforeFile) === old.afterSha256) {
        entry.before = `by-id/${slide.id}.before.png`;
        await fs.copyFile(beforeFile, path.join(folder, entry.before));
        if (entry.change === 'changed') {
          entry.comparison = `by-id/${slide.id}.comparison.png`;
          const tiles = await Promise.all([entry.before, after].map(file => sharp(path.join(folder, file)).resize(960, 540, {fit: 'contain', background: '#fff'}).png().toBuffer()));
          await sharp({create:{width:1944,height:540,channels:3,background:'#e4e4e7'}})
            .composite(tiles.map((input, index) => ({input,left:index*984,top:0}))).png().toFile(path.join(folder, entry.comparison));
        }
      } else entry.change = 'baseline-unavailable';
    } else if (old) entry.change = 'baseline-unavailable';
    entries[slide.id] = entry;
  }
  for (const [id, old] of Object.entries(previous?.slides ?? {})) if (!entries[id]) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(id)) throw new Error('Invalid historical stable slide ID.');
    const removed: Entry = {...old, after:undefined, afterSha256:undefined, before:undefined, comparison:undefined, acceptedAssetPreserved:old.acceptedAsset ? false : undefined, change:'removed'};
    if (old.after && old.afterSha256 && previousFolder) {
      const file=await safePath(previousFolder,old.after);
      if (await exists(file) && await hashFile(file)===old.afterSha256) {
        removed.before=`by-id/${id}.before.png`;
        await fs.copyFile(file,path.join(folder,removed.before));
      }
    }
    entries[id]=removed;
  }
  const manifest: PreviewManifest = {version:1,locale,pptxSha256,slides:entries};
  await atomicWrite(path.join(folder, 'revision-previews.json'), JSON.stringify({...manifest, changeBasis:'Source fingerprint, including theme, localized text and asset bytes; not a pixel comparison.', comparisonOrder:'before left; after right', visualInspection:'Not performed automatically. Open the individual or comparison PNGs.'}, null, 2));
  return manifest;
}
