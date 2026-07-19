/**
 * Display-only SVG tweaks for the Step 1 preview, plus fill extract/merge helpers.
 * normalizeSvgForPreview does not alter rawSvgContent used for 3D / download.
 */

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

function setOrReplaceAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*["'][^"']*["']`, 'i');
  if (re.test(tag)) {
    return tag.replace(re, `${name}="${value}"`);
  }
  return tag.replace(/<svg\b/i, `<svg ${name}="${value}"`);
}

function parseLength(value: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Ensure the SVG scales to fill a preview container (fixes tiny ImageTracer output).
 */
export function normalizeSvgForPreview(svgStr: string): string {
  const match = svgStr.match(/<svg\b[^>]*>/i);
  if (!match) return svgStr;

  let open = match[0];
  const existingViewBox = getAttr(open, 'viewBox') ?? getAttr(open, 'viewbox');
  const w = parseLength(getAttr(open, 'width'));
  const h = parseLength(getAttr(open, 'height'));

  if (!existingViewBox) {
    if (w && h) {
      open = setOrReplaceAttr(open, 'viewBox', `0 0 ${w} ${h}`);
    }
  }

  open = setOrReplaceAttr(open, 'width', '100%');
  open = setOrReplaceAttr(open, 'height', '100%');
  open = setOrReplaceAttr(open, 'preserveAspectRatio', 'xMidYMid meet');

  return svgStr.replace(/<svg\b[^>]*>/i, open);
}

/** Normalize a CSS/SVG color string to 6-digit lowercase hex without `#`, or null. */
export function normalizeSvgColorToHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent' || v === 'currentcolor') return null;

  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    return h.toLowerCase();
  }

  const rgb = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) {
    const toByte = (n: string) => Math.max(0, Math.min(255, Math.round(Number(n))));
    return [toByte(rgb[1]), toByte(rgb[2]), toByte(rgb[3])]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  return null;
}

function collectColorsFromAttrValue(attrValue: string, into: Set<string>) {
  const hex = normalizeSvgColorToHex(attrValue);
  if (hex) into.add(hex);
}

/**
 * Collect unique fill/stroke colors from SVG markup (hex without `#`).
 */
export function extractUniqueSvgFills(svg: string): string[] {
  const colors = new Set<string>();

  const attrRe = /\b(?:fill|stroke)\s*=\s*["']([^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(svg)) !== null) {
    collectColorsFromAttrValue(m[1], colors);
  }

  const styleRe = /\bstyle\s*=\s*["']([^"']*)["']/gi;
  while ((m = styleRe.exec(svg)) !== null) {
    const style = m[1];
    const fillM = style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i);
    const strokeM = style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i);
    if (fillM) collectColorsFromAttrValue(fillM[1].trim(), colors);
    if (strokeM) collectColorsFromAttrValue(strokeM[1].trim(), colors);
  }

  return Array.from(colors).sort();
}

function rewriteColorValue(original: string, fromSet: Set<string>, toHex: string): string {
  const normalized = normalizeSvgColorToHex(original);
  if (!normalized || !fromSet.has(normalized)) return original;
  const hadHash = original.trim().startsWith('#');
  return hadHash ? `#${toHex}` : `#${toHex}`;
}

/**
 * Rewrite fill/stroke (and style fill/stroke) colors that match `fromHexes` to `toHex`.
 * Hexes are 6-digit without `#`.
 */
export function mergeSvgFills(svg: string, fromHexes: string[], toHex: string): string {
  const fromSet = new Set(fromHexes.map((h) => h.replace(/^#/, '').toLowerCase()));
  const target = toHex.replace(/^#/, '').toLowerCase();
  if (fromSet.size === 0 || !/^[0-9a-f]{6}$/.test(target)) return svg;

  let out = svg.replace(/\b(fill|stroke)\s*=\s*(["'])([^"']*)\2/gi, (_all, attr, quote, val) => {
    const next = rewriteColorValue(val, fromSet, target);
    return `${attr}=${quote}${next}${quote}`;
  });

  out = out.replace(/\bstyle\s*=\s*(["'])([^"']*)\1/gi, (_all, quote, style: string) => {
    const nextStyle = style.replace(/(fill|stroke)\s*:\s*([^;]+)/gi, (_s, prop: string, val: string) => {
      const rewritten = rewriteColorValue(val.trim(), fromSet, target);
      return `${prop}:${rewritten}`;
    });
    return `style=${quote}${nextStyle}${quote}`;
  });

  return out;
}
