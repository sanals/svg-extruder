/**
 * Curve-preserving post-trace cleanup.
 * Never Clipper-rebuilds path data (that destroyed ImageTracer Q curves and
 * could empty the scene on complex SVGs). Instead:
 * 1) Recolor tiny dark crumbs to a nearby large fill (keep `d`)
 * 2) Set stroke = fill with a small width to seal empty abutting seams
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface PathInfo {
  tag: string;
  fill: string;
  rgb: Rgb | null;
  d: string;
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  index: number;
}

const LIGHT_LUM = 200;
const TINY_AREA = 80;
const TINY_SPAN = 4;
const SEAM_STROKE_WIDTH = 0.7;

function parseFillRgb(fill: string): Rgb | null {
  const normalized = fill.trim().toLowerCase();
  const rgbMatch = normalized.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
  }
  const hexMatch = normalized.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const n = parseInt(hexMatch[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  return null;
}

function getLuminance(rgb: Rgb): number {
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
}

function isLightFill(rgb: Rgb | null): boolean {
  return !!rgb && getLuminance(rgb) >= LIGHT_LUM;
}

/** Rough bbox/area from path numbers — enough to find tinies without flattening curves. */
function pathBoundsFromD(d: string): {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
} | null {
  const nums = d.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!nums || nums.length < 4) return null;

  const coords = nums.map(Number);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < coords.length; i += 2) {
    minX = Math.min(minX, coords[i]);
    maxX = Math.max(maxX, coords[i]);
    minY = Math.min(minY, coords[i + 1]);
    maxY = Math.max(maxY, coords[i + 1]);
  }
  if (!Number.isFinite(minX)) return null;
  const spanX = Math.max(0, maxX - minX);
  const spanY = Math.max(0, maxY - minY);
  return {
    area: spanX * spanY,
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function boxesNear(a: PathInfo, b: PathInfo, pad = 3): boolean {
  return !(
    b.minX > a.maxX + pad ||
    b.maxX < a.minX - pad ||
    b.minY > a.maxY + pad ||
    b.maxY < a.minY - pad
  );
}

function isTiny(path: PathInfo): boolean {
  if (isLightFill(path.rgb)) return false;
  const span = Math.max(path.maxX - path.minX, path.maxY - path.minY);
  return path.area < TINY_AREA || span < TINY_SPAN;
}

function setOrReplaceAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`\\s${name}\\s*=\\s*["'][^"']*["']`, 'i');
  if (re.test(tag)) {
    return tag.replace(re, ` ${name}="${value}"`);
  }
  // Insert before the closing /> or >
  if (tag.endsWith('/>')) {
    return `${tag.slice(0, -2)} ${name}="${value}" />`;
  }
  if (tag.endsWith('>')) {
    return `${tag.slice(0, -1)} ${name}="${value}">`;
  }
  return `${tag} ${name}="${value}"`;
}

function parsePaths(svgStr: string): PathInfo[] {
  const paths: PathInfo[] = [];
  const re = /<path\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(svgStr)) !== null) {
    const tag = match[0];
    const fillMatch = tag.match(/\bfill\s*=\s*["']([^"']+)["']/i);
    const dMatch = tag.match(/\bd\s*=\s*["']([^"']+)["']/i);
    if (!fillMatch || !dMatch) {
      index += 1;
      continue;
    }
    const fill = fillMatch[1];
    if (fill === 'none') {
      index += 1;
      continue;
    }
    const bounds = pathBoundsFromD(dMatch[1]);
    if (!bounds) {
      index += 1;
      continue;
    }
    paths.push({
      tag,
      fill,
      rgb: parseFillRgb(fill),
      d: dMatch[1],
      ...bounds,
      index,
    });
    index += 1;
  }
  return paths;
}

/**
 * Recolor tiny dark crumbs to the nearest large neighbor fill.
 * Keeps original `d` so curves are never flattened.
 */
function absorbTinyFills(paths: PathInfo[]): Map<number, string> {
  const fillOverrides = new Map<number, string>();
  const large = paths.filter(p => !isTiny(p));
  if (large.length === 0) return fillOverrides;

  for (const tiny of paths) {
    if (!isTiny(tiny)) continue;

    let best: PathInfo | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const neighbor of large) {
      if (!boxesNear(tiny, neighbor, 4)) continue;
      const dist = Math.hypot(tiny.cx - neighbor.cx, tiny.cy - neighbor.cy);
      const score = dist - Math.sqrt(neighbor.area) * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = neighbor;
      }
    }
    if (best) fillOverrides.set(tiny.index, best.fill);
  }

  return fillOverrides;
}

/**
 * Post-trace cleanup that preserves ImageTracer curves:
 * absorb tiny dark crumbs by recoloring fill, then seal empty seams with stroke=fill.
 */
export function sealAndStraightenSvg(svgStr: string): string {
  const paths = parsePaths(svgStr);
  if (paths.length === 0) return svgStr;

  try {
    const fillOverrides = absorbTinyFills(paths);
    let pathIndex = 0;

    return svgStr.replace(/<path\b[^>]*\/?>/gi, (tag) => {
      const currentIndex = pathIndex;
      pathIndex += 1;

      const fillMatch = tag.match(/\bfill\s*=\s*["']([^"']+)["']/i);
      if (!fillMatch || fillMatch[1] === 'none') return tag;

      let fill = fillOverrides.get(currentIndex) ?? fillMatch[1];
      let next = tag;

      if (fillOverrides.has(currentIndex)) {
        next = setOrReplaceAttr(next, 'fill', fill);
      }

      // Slight same-color stroke closes empty abutting gaps without rewriting `d`.
      next = setOrReplaceAttr(next, 'stroke', fill);
      next = setOrReplaceAttr(next, 'stroke-width', String(SEAM_STROKE_WIDTH));
      return next;
    });
  } catch (err) {
    console.warn('sealAndStraightenSvg failed; falling back to original SVG', err);
    return svgStr;
  }
}
