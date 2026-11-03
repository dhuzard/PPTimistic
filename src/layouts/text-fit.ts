/** Conservative glyph-aware estimate, not a substitute for a local renderer.
 * Widths are in em, with a 6% safety allowance for font substitution. No text
 * or font size is changed. Accents/combining marks retain their base width.
 */
function advance(character: string): number {
  if (/\p{Mark}/u.test(character)) return 0;
  const base = character.normalize('NFD')[0];
  if (/\s/u.test(base)) return .28;
  if (/[ilI.,'`:;!|]/u.test(base)) return .28;
  if (/[mwMW@%]/u.test(base)) return .9;
  if (/[A-Z0-9]/u.test(base)) return .66;
  if (/[a-z]/u.test(base)) return .53;
  if (/[-–—()[\]{}\/]/u.test(base)) return .4;
  return 1; // Unknown glyphs: fail conservatively (including CJK/emoji).
}

export function measureText(text: string, width: number, font: number) {
  if (!(width > 0) || !(font > 0) || !Number.isFinite(width + font)) {
    return { lines: Infinity, height: Infinity, method: 'conservative-glyph-estimate' as const };
  }
  const capacity = width * 72 / font / 1.06;
  let lines = 0;
  for (const paragraph of text.replace(/\r\n?/gu, '\n').split('\n')) {
    let used = 0;
    lines++;
    // NBSP and narrow NBSP intentionally remain within an unbroken token.
    for (const token of paragraph.split(/[ \t]+/u).filter(Boolean)) {
      const tokenWidth = [...token].reduce((sum, c) => sum + advance(c), 0);
      if (used && used + .28 + tokenWidth > capacity) { lines++; used = 0; }
      else if (used) used += .28;
      // PowerPoint can wrap overlong tokens by character; exact multiples must
      // not create an extra empty line.
      for (const character of token) {
        const size = advance(character);
        if (used && used + size > capacity) { lines++; used = 0; }
        used += size;
      }
    }
  }
  return { lines, height: lines * font * 1.22 / 72, method: 'conservative-glyph-estimate' as const };
}

/** Chart engines reserve an undocumented fraction of their box for plot/axes.
 * Flag labels that would need more than one line even in a generous share of
 * the box. This is a review signal, not a prediction of any renderer's wrap. */
export function chartLabelsNeedingReview(labels: readonly string[], chartWidth: number, font = 18): number[] {
  if (!labels.length) return [];
  const slot = chartWidth / labels.length;
  return labels.flatMap((label, index) => measureText(label, slot, font).lines > 1 ? [index] : []);
}
