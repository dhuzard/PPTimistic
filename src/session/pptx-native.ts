import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { XMLValidator } from 'fast-xml-parser';

export interface PptxRun { paragraph: number; run: number; text: string }
export interface PptxGeometry { x: number; y: number; cx: number; cy: number }
export interface PptxObject { id: string; shapeId: string; ordinal: number; duplicateShapeId: boolean; kind: 'shape' | 'picture' | 'unsupported'; name: string; runs: PptxRun[]; geometry?: PptxGeometry; textEditable: boolean; geometryEditable: boolean; reason?: string }
export interface PptxSlide { part: string; objects: PptxObject[] }
export interface PptxScene { digest: string; width: number; height: number; slides: PptxSlide[] }
export interface PptxEdit { slidePart: string; objectId: string; runs?: PptxRun[]; geometry?: PptxGeometry }
/** Serialized overrides are keyed by the exact imported slide part and object ID. */
export interface NativeOverride { runs?: PptxRun[]; geometry?: PptxGeometry }
export type NativeOverridesBySlide = Record<string, Record<string, NativeOverride>>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validateEdit(object: PptxObject, edit: NativeOverride): void {
  if (!record(edit) || Object.keys(edit).some(k => k !== 'runs' && k !== 'geometry')) throw new Error('Invalid object override');
  if (edit.runs === undefined && edit.geometry === undefined) throw new Error('Empty object edit');
  if (edit.runs !== undefined) {
    if (!object.textEditable || object.duplicateShapeId) throw new Error('Unsupported text edit');
    if (!Array.isArray(edit.runs) || edit.runs.length !== object.runs.length || edit.runs.some((r,i) =>
      !record(r) || Object.keys(r).some(k => !['paragraph','run','text'].includes(k)) ||
      r.paragraph !== object.runs[i].paragraph || r.run !== object.runs[i].run ||
      typeof r.text !== 'string' || /[\u0000-\u0008\u000b\u000c\u000d-\u001f\ufffe\uffff]/.test(r.text) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(r.text)))
      throw new Error('Run structure changed or invalid text');
  }
  if (edit.geometry !== undefined) {
    if (!object.geometryEditable || object.duplicateShapeId) throw new Error('Unsupported geometry edit');
    const g = edit.geometry;
    if (!record(g) || Object.keys(g).some(k => !['x','y','cx','cy'].includes(k)) ||
      ![g.x,g.y,g.cx,g.cy].every(Number.isSafeInteger) || typeof g.cx !== 'number' || typeof g.cy !== 'number' || g.cx <= 0 || g.cy <= 0) throw new Error('Invalid geometry');
  }
}
/** Resolve serialized overrides against an immutable imported scene, rejecting stale keys and unsupported edits. */
export function buildNativeEdits(scene: PptxScene, overridesBySlide: NativeOverridesBySlide): PptxEdit[] {
  if (!record(overridesBySlide)) throw new Error('Invalid slide overrides');
  const edits: PptxEdit[] = [];
  for (const [slidePart, overrides] of Object.entries(overridesBySlide)) {
    const slide = scene.slides.find(s => s.part === slidePart);
    if (!slide) throw new Error('Unknown slide override');
    if (!record(overrides)) throw new Error('Invalid slide override');
    for (const [objectId, value] of Object.entries(overrides)) {
      const object = slide.objects.find(o => o.id === objectId);
      if (!object) throw new Error('Unknown slide object');
      if (!record(value)) throw new Error('Invalid object override');
      const override = value as NativeOverride; validateEdit(object, override);
      edits.push({ slidePart, objectId, ...(override.runs !== undefined ? { runs: override.runs.map(r => ({...r})) } : {}),
        ...(override.geometry !== undefined ? { geometry: {...override.geometry} } : {}) });
    }
  }
  return edits;
}
/** Produce editable view data without mutating the immutable imported baseline. */
export function applyNativeOverrides(scene: PptxScene, overridesBySlide: NativeOverridesBySlide): PptxScene {
  const edits = buildNativeEdits(scene, overridesBySlide);
  const effective = structuredClone(scene);
  for (const edit of edits) {
    const object = effective.slides.find(s => s.part === edit.slidePart)!.objects.find(o => o.id === edit.objectId)!;
    if (edit.runs !== undefined) object.runs = edit.runs;
    if (edit.geometry !== undefined) object.geometry = edit.geometry;
  }
  return effective;
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const valid = (xml: string) => { if (XMLValidator.validate(xml) !== true) throw new Error('Invalid OOXML'); };
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, v: string) => v === 'amp' ? '&' : v === 'lt' ? '<' : v === 'gt' ? '>' : v === 'quot' ? '"' : v === 'apos' ? "'" : String.fromCodePoint(v[1] === 'x' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10)));
}
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function attr(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(["'])(.*?)\\1`));
  return m ? decode(m[2]) : undefined;
}
function numberAttr(tag: string, name: string): number {
  const v = attr(tag, name); if (v === undefined || !/^-?\d+$/.test(v) || !Number.isSafeInteger(Number(v))) throw new Error(`Invalid ${name}`); return Number(v);
}
async function file(zip: JSZip, name: string): Promise<string> {
  const entry = zip.file(name); if (!entry) throw new Error(`Missing package part: ${name}`);
  const xml = await entry.async('string'); valid(xml); return xml;
}
function shapeObjects(xml: string, part: string): PptxObject[] {
  const tree = xml.match(/<p:spTree(?:\s[^>]*)?>([\s\S]*?)<\/p:spTree>/)?.[1];
  if (tree === undefined) throw new Error(`Unsupported slide tree: ${part}`);
  const grouped = /<p:grpSp(?:\s|>)/.test(tree);
  const result: PptxObject[] = [];
  const pattern = /<p:(sp|pic|graphicFrame|cxnSp|grpSp)(?:\s[^>]*)?>[\s\S]*?<\/p:\1>/g;
  for (const match of tree.matchAll(pattern)) {
    const raw = match[0], kind = match[1];
    const nv = raw.match(/<p:cNvPr\b[^>]*\/?\s*>/)?.[0];
    if (!nv) throw new Error(`Missing shape identity: ${part}`);
    const shapeId = attr(nv, 'id'); if (!shapeId || !/^\d+$/.test(shapeId)) throw new Error(`Invalid shape identity: ${part}`);
    const id = `${part}#${shapeId}@${result.length}`;
    const tx = raw.match(/<p:txBody(?:\s[^>]*)?>([\s\S]*?)<\/p:txBody>/)?.[1];
    const runs: PptxRun[] = [];
    let simpleText = kind === 'sp' && tx !== undefined && !/<a:(?:fld|br|tab|extLst)\b/.test(tx);
    if (tx !== undefined) {
      const paragraphs = [...tx.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)];
      for (let p = 0; p < paragraphs.length; p++) {
        const body = paragraphs[p][1];
        const rs = [...body.matchAll(/<a:r(?:\s[^>]*)?>([\s\S]*?)<\/a:r>/g)];
        for (let r = 0; r < rs.length; r++) {
          const t = rs[r][1].match(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/);
          if (!t) { simpleText = false; continue; }
          runs.push({ paragraph: p, run: r, text: decode(t[1]) });
        }
        if (/<a:t(?:\s|>)/.test(body.replace(/<a:r(?:\s[^>]*)?>[\s\S]*?<\/a:r>/g, ''))) simpleText = false;
      }
      if (!paragraphs.length || !runs.length) simpleText = false;
    }
    const xfrm = raw.match(/<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/);
    const off = xfrm?.[1].match(/<a:off\b[^>]*\/?\s*>/)?.[0], ext = xfrm?.[1].match(/<a:ext\b[^>]*\/?\s*>/)?.[0];
    let geometry: PptxGeometry | undefined;
    if (off && ext) geometry = { x: numberAttr(off,'x'), y: numberAttr(off,'y'), cx: numberAttr(ext,'cx'), cy: numberAttr(ext,'cy') };
    const geometryEditable = kind === 'sp' && !!geometry && geometry.cx > 0 && geometry.cy > 0 && !grouped && !/<p:ph\b/.test(raw) && !/\b(?:rot|flipH|flipV)\s*=/.test(xfrm?.[0] ?? '');
    result.push({ id, shapeId, ordinal: result.length, duplicateShapeId: false, kind: kind === 'sp' ? 'shape' : kind === 'pic' ? 'picture' : 'unsupported', name: attr(nv,'name') ?? '', runs, geometry, textEditable: simpleText && !grouped, geometryEditable, reason: grouped ? 'Slide contains grouped objects' : kind !== 'sp' ? `Unsupported ${kind}` : undefined });
  }
  for (const object of result) {
    if (result.filter(other => other.shapeId === object.shapeId).length > 1) {
      object.duplicateShapeId = true; object.textEditable = false; object.geometryEditable = false; object.reason = 'Duplicate shape identity';
    }
  }
  return result;
}
export async function importPptxScene(bytes: Uint8Array): Promise<PptxScene> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const presentation = await file(zip, 'ppt/presentation.xml');
  const rels = await file(zip, 'ppt/_rels/presentation.xml.rels');
  const size = presentation.match(/<p:sldSz\b[^>]*\/?\s*>/)?.[0]; if (!size) throw new Error('Missing presentation dimensions');
  const targets = new Map<string,string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const id = attr(m[0], 'Id'), target = attr(m[0], 'Target'), type = attr(m[0], 'Type');
    if (id && target && type?.endsWith('/slide') && attr(m[0], 'TargetMode') !== 'External') {
      const path = target.startsWith('/') ? target.slice(1) : `ppt/${target}`;
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(path) || targets.has(id)) throw new Error('Unsupported slide relationship'); targets.set(id,path);
    }
  }
  const list = presentation.match(/<p:sldIdLst(?:\s[^>]*)?>([\s\S]*?)<\/p:sldIdLst>/)?.[1]; if (list === undefined) throw new Error('Missing slide list');
  const slides: PptxSlide[] = []; const seen = new Set<string>();
  for (const m of list.matchAll(/<p:sldId\b[^>]*\/?\s*>/g)) {
    const rid = attr(m[0], 'r:id'), part = rid && targets.get(rid); if (!part || seen.has(part)) throw new Error('Unsupported slide reference'); seen.add(part);
    slides.push({ part, objects: shapeObjects(await file(zip,part),part) });
  }
  return { digest: sha(bytes), width: numberAttr(size,'cx'), height: numberAttr(size,'cy'), slides };
}
function replaceAttribute(tag: string, name: string, value: number): string {
  const re = new RegExp(`(\\s${name}\\s*=\\s*)(["'])[^"']*\\2`); if (!re.test(tag)) throw new Error(`Missing ${name}`); return tag.replace(re, `$1"${value}"`);
}
export async function patchPptxScene(bytes: Uint8Array, expectedDigest: string, edits: PptxEdit[]): Promise<Buffer> {
  if (sha(bytes) !== expectedDigest) throw new Error('PPTX source digest changed');
  if (!edits.length) return Buffer.from(bytes);
  const scene = await importPptxScene(bytes); const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const seen = new Set<string>();
  for (const edit of edits) {
    const key = `${edit.slidePart}|${edit.objectId}`; if (seen.has(key)) throw new Error('Duplicate object edit'); seen.add(key);
    const slide = scene.slides.find(s => s.part === edit.slidePart), object = slide?.objects.find(o => o.id === edit.objectId);
    if (!object) throw new Error('Unknown slide object');
    validateEdit(object, { ...(edit.runs !== undefined ? {runs: edit.runs} : {}), ...(edit.geometry !== undefined ? {geometry: edit.geometry} : {}) });
    let xml = await file(zip,edit.slidePart); let found = 0;
    xml = xml.replace(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g, raw => {
      const nv = raw.match(/<p:cNvPr\b[^>]*\/?\s*>/)?.[0]; if (!nv || attr(nv,'id') !== object.shapeId) return raw; found++;
      if (edit.runs) {
        let i = 0;
        raw = raw.replace(/<p:txBody(?:\s[^>]*)?>[\s\S]*?<\/p:txBody>/, tx => tx.replace(/<a:r(?:\s[^>]*)?>[\s\S]*?<\/a:r>/g, run => {
          const text = edit.runs![i++].text;
          return run.replace(/<a:t(?:\s[^>]*)?>[^<]*<\/a:t>/, tag => {
            let open = tag.slice(0,tag.indexOf('>')+1);
            if (/^\s|\s$/.test(text) && !/\bxml:space\s*=/.test(open)) open = open.slice(0,-1) + ' xml:space="preserve">';
            return `${open}${encode(text)}</a:t>`;
          });
        }));
        if (i !== edit.runs.length) throw new Error('Run count mismatch');
      }
      if (edit.geometry) {
        const g = edit.geometry;
        raw = raw.replace(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/, x => x.replace(/<a:off\b[^>]*\/?\s*>/, tag => replaceAttribute(replaceAttribute(tag,'x',g.x),'y',g.y)).replace(/<a:ext\b[^>]*\/?\s*>/, tag => replaceAttribute(replaceAttribute(tag,'cx',g.cx),'cy',g.cy)));
      }
      return raw;
    });
    if (found !== 1) throw new Error('Ambiguous object identity'); valid(xml); zip.file(edit.slidePart,xml);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
