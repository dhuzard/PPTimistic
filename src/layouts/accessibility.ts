import fs from 'node:fs/promises';
import JSZip from 'jszip';

export type AccessibleObject = { key: string; name: string; title?: boolean; decorative?: boolean; description?: string };

const escapeXml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&apos;');
// MS-ODRAWXML §5.32. The extension URI and placement were also checked against
// a rectangle saved by PowerPoint 16.0 (build 20430), with Shape.Decorative=true.
const decorativeExtension = '<a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext>';

/** Add Office semantics unsupported by PptxGenJS 4.0.1 to a newly staged deck.
 * Changes only nonvisual properties; drawing order, geometry and editable data
 * remain as authored. Never use this to modify an existing user presentation.
 */
export async function finalizeAccessibility(file: string, slides: { accessibility?: AccessibleObject[] }[]) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  for (const [index, slide] of slides.entries()) {
    const part = `ppt/slides/slide${index + 1}.xml`;
    const entry = zip.file(part);
    if (!entry) throw new Error(`Accessibility metadata: missing ${part}`);
    const expected = new Map((slide.accessibility ?? []).map(object => [object.key, object]));
    if (expected.size !== slide.accessibility?.length) throw new Error(`Accessibility metadata: duplicate or missing object names in ${part}`);
    const found = new Set<string>();
    const xml = (await entry.async('string')).replace(/<p:(sp|pic|graphicFrame)\b[^>]*>[\s\S]*?<\/p:\1>/g, objectXml => {
      const name = objectXml.match(/<p:cNvPr\b[^>]*\bname="([^"]*)"/)?.[1];
      const metadata = name ? expected.get(name) : undefined;
      if (!metadata) return objectXml;
      if (found.has(name!)) throw new Error(`Accessibility metadata: duplicate object ${name} in ${part}`);
      found.add(name!);
      let updated = objectXml.replace(/<p:cNvPr\b([^>]*?)(?:\/>|>([\s\S]*?)<\/p:cNvPr>)/, (_match, attributes: string, children: string = '') => {
        attributes = attributes.replace(/\bname="[^"]*"/, () => `name="${escapeXml(metadata.name)}"`);
        if (metadata.description !== undefined || metadata.decorative) attributes = attributes.replace(/\sdescr="[^"]*"/g, '');
        if (!metadata.decorative && metadata.description !== undefined) attributes += ` descr="${escapeXml(metadata.description)}"`;
        if (metadata.decorative && !children.includes('adec:decorative')) {
          children = children.includes('</a:extLst>') ? children.replace('</a:extLst>', `${decorativeExtension}</a:extLst>`) : `${children}<a:extLst>${decorativeExtension}</a:extLst>`;
        }
        return `<p:cNvPr${attributes}>${children}</p:cNvPr>`;
      });
      if (metadata.title) {
        // ECMA-376 PresentationML title placeholder, with explicit existing
        // position/formatting retained. PowerPoint recognizes Shapes.Title.
        updated = updated.replace(/<p:nvPr\s*\/>|<p:nvPr>\s*<\/p:nvPr>/, '<p:nvPr><p:ph type="title"/></p:nvPr>');
        if (!updated.includes('<p:ph type="title"/>')) throw new Error(`Accessibility metadata: cannot identify title ${name} in ${part}`);
      }
      return updated;
    });
    for (const name of expected.keys()) if (!found.has(name)) throw new Error(`Accessibility metadata: object ${name} missing from ${part}`);
    zip.file(part, xml);
  }
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
