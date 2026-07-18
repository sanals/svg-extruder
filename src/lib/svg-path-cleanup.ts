/**
 * Curve-preserving post-trace cleanup.
 * Never Clipper-rebuilds path data (that destroyed ImageTracer Q curves and
 * could empty the scene on complex SVGs). Instead:
 * 1) Recolor tiny dark crumbs to a nearby large fill (keep `d`)
 * 2) Simplify nearly-collinear L runs only (never touch Q/C)
 * 3) Set stroke = fill with a small width to seal empty abutting seams
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
/** Max distance-to-chord to drop an intermediate L vertex (SVG units). */
const COLLINEAR_EPSILON = 0.55;
/** Snap near-horizontal / near-vertical L jitter within this tolerance. */
const AXIS_SNAP = 0.45;

type PathCmd = { cmd: string; args: number[] };

function roundCoord(n: number): number {
  return Math.round(n * 100) / 100;
}

function tokenizePathD(d: string): PathCmd[] | null {
  const tokens = d.match(/[MmLlHhVvCcQqTtSsAaZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return null;

  const cmds: PathCmd[] = [];
  let i = 0;
  let cmd = 'M';

  const argCounts: Record<string, number> = {
    M: 2, m: 2, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1,
    C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2,
    A: 7, a: 7, Z: 0, z: 0,
  };

  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) {
      cmd = tokens[i];
      i += 1;
    }
    const need = argCounts[cmd];
    if (need === undefined) return null;
    if (need === 0) {
      cmds.push({ cmd, args: [] });
      continue;
    }
    if (i + need > tokens.length) return null;
    const args = tokens.slice(i, i + need).map(Number);
    if (args.some(a => !Number.isFinite(a))) return null;
    i += need;
    cmds.push({ cmd, args });
    // Implicit repetition: consecutive coordinate pairs reuse last command
    // (M → L for subsequent pairs).
    if ((cmd === 'M' || cmd === 'm') && i < tokens.length && !/^[A-Za-z]$/.test(tokens[i])) {
      cmd = cmd === 'M' ? 'L' : 'l';
    }
  }
  return cmds;
}

function distToChord(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function snapAxisAligned(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 2) return points;
  const out = points.map(([x, y]) => [x, y] as [number, number]);
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    if (Math.abs(cur[1] - prev[1]) <= AXIS_SNAP) cur[1] = prev[1];
    if (Math.abs(cur[0] - prev[0]) <= AXIS_SNAP) cur[0] = prev[0];
  }
  return out;
}

/** Douglas-Peucker-lite on an open polyline of L vertices. */
function simplifyCollinear(points: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (points.length <= 2) return points;

  const simplify = (pts: Array<[number, number]>): Array<[number, number]> => {
    if (pts.length <= 2) return pts;
    let maxDist = 0;
    let index = 0;
    const end = pts.length - 1;
    for (let i = 1; i < end; i++) {
      const dist = distToChord(pts[i][0], pts[i][1], pts[0][0], pts[0][1], pts[end][0], pts[end][1]);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > epsilon) {
      const left = simplify(pts.slice(0, index + 1));
      const right = simplify(pts.slice(index));
      return [...left.slice(0, -1), ...right];
    }
    return [pts[0], pts[end]];
  };

  return simplify(points);
}

function serializeCmds(cmds: PathCmd[]): string {
  return cmds
    .map(({ cmd, args }) => {
      if (args.length === 0) return cmd;
      return `${cmd} ${args.map(roundCoord).join(' ')}`;
    })
    .join(' ');
}

/**
 * Simplify nearly-collinear absolute/relative L runs only.
 * Q/C/A/S/T segments are left completely untouched.
 */
export function simplifyStraightRunsInPathD(d: string): string {
  try {
    const cmds = tokenizePathD(d);
    if (!cmds || cmds.length === 0) return d;

    const out: PathCmd[] = [];
    let x = 0;
    let y = 0;
    let i = 0;

    while (i < cmds.length) {
      const cur = cmds[i];

      // Start of a straight run: M/m or L/l/H/h/V/v sequence.
      const isLineish =
        cur.cmd === 'L' || cur.cmd === 'l' ||
        cur.cmd === 'H' || cur.cmd === 'h' ||
        cur.cmd === 'V' || cur.cmd === 'v' ||
        cur.cmd === 'M' || cur.cmd === 'm';

      if (!isLineish || cur.cmd === 'Z' || cur.cmd === 'z') {
        // Pass through curves and close commands unchanged (update cursor for absolute state).
        if (cur.cmd === 'Z' || cur.cmd === 'z') {
          out.push(cur);
          i += 1;
          continue;
        }
        // Curve / arc — emit as-is and advance cursor from end point.
        out.push(cur);
        const a = cur.args;
        if (cur.cmd === 'Q' || cur.cmd === 'T') {
          x = a[a.length - 2];
          y = a[a.length - 1];
        } else if (cur.cmd === 'q' || cur.cmd === 't') {
          x += a[a.length - 2];
          y += a[a.length - 1];
        } else if (cur.cmd === 'C' || cur.cmd === 'S') {
          x = a[a.length - 2];
          y = a[a.length - 1];
        } else if (cur.cmd === 'c' || cur.cmd === 's') {
          x += a[a.length - 2];
          y += a[a.length - 1];
        } else if (cur.cmd === 'A') {
          x = a[5];
          y = a[6];
        } else if (cur.cmd === 'a') {
          x += a[5];
          y += a[6];
        }
        i += 1;
        continue;
      }

      // Collect a contiguous straight-line run (including an optional leading M).
      const runStart = i;
      const absPoints: Array<[number, number]> = [];
      let runX = x;
      let runY = y;
      let startedWithMove = false;

      while (i < cmds.length) {
        const c = cmds[i];
        if (c.cmd === 'Z' || c.cmd === 'z') break;
        if (c.cmd === 'Q' || c.cmd === 'q' || c.cmd === 'C' || c.cmd === 'c' ||
            c.cmd === 'S' || c.cmd === 's' || c.cmd === 'T' || c.cmd === 't' ||
            c.cmd === 'A' || c.cmd === 'a') break;

        // A second M inside a run ends the previous subpath's line run.
        if ((c.cmd === 'M' || c.cmd === 'm') && absPoints.length > 0) break;

        if (c.cmd === 'M') {
          runX = c.args[0];
          runY = c.args[1];
          absPoints.push([runX, runY]);
          startedWithMove = true;
        } else if (c.cmd === 'm') {
          runX += c.args[0];
          runY += c.args[1];
          absPoints.push([runX, runY]);
          startedWithMove = true;
        } else if (c.cmd === 'L') {
          runX = c.args[0];
          runY = c.args[1];
          absPoints.push([runX, runY]);
        } else if (c.cmd === 'l') {
          runX += c.args[0];
          runY += c.args[1];
          absPoints.push([runX, runY]);
        } else if (c.cmd === 'H') {
          runX = c.args[0];
          absPoints.push([runX, runY]);
        } else if (c.cmd === 'h') {
          runX += c.args[0];
          absPoints.push([runX, runY]);
        } else if (c.cmd === 'V') {
          runY = c.args[0];
          absPoints.push([runX, runY]);
        } else if (c.cmd === 'v') {
          runY += c.args[0];
          absPoints.push([runX, runY]);
        } else {
          break;
        }
        i += 1;
      }

      if (absPoints.length === 0) {
        // Shouldn't happen; emit original slice.
        out.push(...cmds.slice(runStart, i || runStart + 1));
        if (i === runStart) i += 1;
        continue;
      }

      // If run didn't start with M, prepend current cursor so L-chain has a base.
      let points = absPoints;
      if (!startedWithMove) {
        points = [[x, y], ...absPoints];
      }

      const snapped = snapAxisAligned(points);
      const simplified = simplifyCollinear(snapped, COLLINEAR_EPSILON);

      if (startedWithMove) {
        const [mx, my] = simplified[0];
        out.push({ cmd: 'M', args: [mx, my] });
        for (let p = 1; p < simplified.length; p++) {
          out.push({ cmd: 'L', args: [simplified[p][0], simplified[p][1]] });
        }
        x = simplified[simplified.length - 1][0];
        y = simplified[simplified.length - 1][1];
      } else {
        // Keep cursor; emit only L points after the implicit start.
        for (let p = 1; p < simplified.length; p++) {
          out.push({ cmd: 'L', args: [simplified[p][0], simplified[p][1]] });
        }
        if (simplified.length > 0) {
          x = simplified[simplified.length - 1][0];
          y = simplified[simplified.length - 1][1];
        }
      }
    }

    const result = serializeCmds(out);
    return result.length > 0 ? result : d;
  } catch {
    return d;
  }
}

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
 * absorb tiny dark crumbs by recoloring fill, simplify collinear L runs only,
 * then seal empty seams with stroke=fill.
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
      const dMatch = tag.match(/\bd\s*=\s*["']([^"']+)["']/i);
      if (!fillMatch || fillMatch[1] === 'none') return tag;

      const fill = fillOverrides.get(currentIndex) ?? fillMatch[1];
      let next = tag;

      if (fillOverrides.has(currentIndex)) {
        next = setOrReplaceAttr(next, 'fill', fill);
      }

      if (dMatch) {
        const simplified = simplifyStraightRunsInPathD(dMatch[1]);
        if (simplified && simplified !== dMatch[1]) {
          next = setOrReplaceAttr(next, 'd', simplified);
        }
      }

      // Slight same-color stroke closes empty abutting gaps without rewriting curves.
      next = setOrReplaceAttr(next, 'stroke', fill);
      next = setOrReplaceAttr(next, 'stroke-width', String(SEAM_STROKE_WIDTH));
      return next;
    });
  } catch (err) {
    console.warn('sealAndStraightenSvg failed; falling back to original SVG', err);
    return svgStr;
  }
}
