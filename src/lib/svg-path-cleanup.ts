/**
 * Curve-preserving post-trace cleanup (VTracer / cubic-friendly).
 * Never Clipper-rebuilds path data. Instead:
 * 1) Recolor tiny crumbs + thin same-color edge spurs to a nearby large fill (keep `d`)
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
/** Needle-like spur: thin side and high aspect (AI ring L-artifacts). */
const SPUR_MIN_THIN = 2.5;
const SPUR_ASPECT = 6;
const SPUR_MAX_AREA = 400;
const SEAM_STROKE_WIDTH = 0.35;
/** Max distance-to-chord to drop an intermediate L vertex (SVG units). */
const COLLINEAR_EPSILON = 0.35;
/** Snap near-horizontal / near-vertical L jitter within this tolerance. */
const AXIS_SNAP = 0.45;
/** Max deviation from 180° (degrees) to treat a corner as "almost flat". */
const FLAT_TURN_DEG = 9;
/** If this many consecutive similar small turns exist, treat the run as a curve. */
const CURVED_RUN_MIN_TURNS = 5;

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

/** Exterior turn angle in degrees (0 = straight ahead, 180 = reverse). */
function turnDeviationDeg(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const bcx = cx - bx;
  const bcy = cy - by;
  const len1 = Math.hypot(abx, aby);
  const len2 = Math.hypot(bcx, bcy);
  if (len1 < 1e-6 || len2 < 1e-6) return 0;
  const dot = (abx * bcx + aby * bcy) / (len1 * len2);
  const clamped = Math.max(-1, Math.min(1, dot));
  // Angle between segments; 0° = collinear same direction.
  return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * Circles/arcs are often dense L polylines with many similar small turns.
 * Detect that and skip simplify so we don't facet them into octagons.
 */
function looksLikeCurvedRun(points: Array<[number, number]>): boolean {
  if (points.length < CURVED_RUN_MIN_TURNS + 2) return false;

  const turns: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    turns.push(turnDeviationDeg(a[0], a[1], b[0], b[1], c[0], c[1]));
  }

  // Count mild, consistent turns (not flat, not sharp corners).
  const mild = turns.filter(t => t > FLAT_TURN_DEG && t < 55);
  if (mild.length < CURVED_RUN_MIN_TURNS) return false;

  const mean = mild.reduce((s, t) => s + t, 0) / mild.length;
  let variance = 0;
  for (const t of mild) variance += (t - mean) * (t - mean);
  variance /= mild.length;
  // Similar turn sizes → arc/circle; high variance → mixed stairs/corners.
  return Math.sqrt(variance) < 12 && mean > FLAT_TURN_DEG;
}

/**
 * Douglas-Peucker-lite that only collapses nearly-flat corners.
 * Mid-vertices with meaningful turn angles are kept so circles stay round.
 */
function simplifyCollinear(points: Array<[number, number]>, epsilon: number): Array<[number, number]> {
  if (points.length <= 2) return points;
  if (looksLikeCurvedRun(points)) return points;

  const simplify = (pts: Array<[number, number]>): Array<[number, number]> => {
    if (pts.length <= 2) return pts;
    let maxDist = 0;
    let index = 0;
    const end = pts.length - 1;
    for (let i = 1; i < end; i++) {
      const dist = distToChord(pts[i][0], pts[i][1], pts[0][0], pts[0][1], pts[end][0], pts[end][1]);
      const turn = turnDeviationDeg(
        pts[i - 1][0], pts[i - 1][1],
        pts[i][0], pts[i][1],
        pts[i + 1][0], pts[i + 1][1],
      );
      // Only consider dropping vertices that are both close to the chord and flat.
      if (turn > FLAT_TURN_DEG) continue;
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > epsilon && index > 0) {
      const left = simplify(pts.slice(0, index + 1));
      const right = simplify(pts.slice(index));
      return [...left.slice(0, -1), ...right];
    }
    // If nothing is flat enough to drop via DP, still strip only flat midpoints.
    if (maxDist <= epsilon) {
      const kept: Array<[number, number]> = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const turn = turnDeviationDeg(
          pts[i - 1][0], pts[i - 1][1],
          pts[i][0], pts[i][1],
          pts[i + 1][0], pts[i + 1][1],
        );
        const dist = distToChord(pts[i][0], pts[i][1], pts[0][0], pts[0][1], pts[end][0], pts[end][1]);
        if (turn > FLAT_TURN_DEG || dist > epsilon) kept.push(pts[i]);
      }
      kept.push(pts[end]);
      return kept;
    }
    return pts;
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

      // Leave circular / arcing polylines alone — axis-snap + DP facets them.
      const simplified = looksLikeCurvedRun(points)
        ? points
        : simplifyCollinear(snapAxisAligned(points), COLLINEAR_EPSILON);

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
  const span = Math.max(path.maxX - path.minX, path.maxY - path.minY);
  return path.area < TINY_AREA || span < TINY_SPAN;
}

/** Compact blob (near-square bbox) — likely an intentional spot, not AA shrapnel. */
function isCompactDetail(path: PathInfo): boolean {
  const w = Math.max(0.001, path.maxX - path.minX);
  const h = Math.max(0.001, path.maxY - path.minY);
  const aspect = Math.max(w, h) / Math.min(w, h);
  return aspect <= 1.8 && path.area >= 6 && path.area <= 400;
}

function isThinSpur(path: PathInfo): boolean {
  const w = Math.max(0.001, path.maxX - path.minX);
  const h = Math.max(0.001, path.maxY - path.minY);
  const mn = Math.min(w, h);
  const mx = Math.max(w, h);
  return mn < SPUR_MIN_THIN && mx / mn >= SPUR_ASPECT && path.area < SPUR_MAX_AREA;
}

function hugsGlobalEdge(
  path: PathInfo,
  global: { minX: number; minY: number; maxX: number; maxY: number },
  pad = 2,
): boolean {
  return (
    path.minX <= global.minX + pad ||
    path.maxX >= global.maxX - pad ||
    path.minY <= global.minY + pad ||
    path.maxY >= global.maxY - pad
  );
}

function fillDistance(a: Rgb | null, b: Rgb | null): number {
  if (!a || !b) return 999;
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
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

interface EdgeDebrisResult {
  /** Recolor crumb to neighbor fill (different color AA fringe). */
  fillOverrides: Map<number, string>;
  /** Drop path entirely (same-color thin spurs — recolor alone stays visible). */
  deleteIndexes: Set<number>;
}

/**
 * Absorb edge debris: recolor unlike crumbs; delete same-color thin spurs / edge strips.
 * Never rewrites path `d` geometry.
 */
function absorbEdgeDebris(paths: PathInfo[]): EdgeDebrisResult {
  const fillOverrides = new Map<number, string>();
  const deleteIndexes = new Set<number>();
  if (paths.length === 0) return { fillOverrides, deleteIndexes };

  let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
  for (const p of paths) {
    gMinX = Math.min(gMinX, p.minX);
    gMinY = Math.min(gMinY, p.minY);
    gMaxX = Math.max(gMaxX, p.maxX);
    gMaxY = Math.max(gMaxY, p.maxY);
  }
  const global = { minX: gMinX, minY: gMinY, maxX: gMaxX, maxY: gMaxY };

  const large = paths.filter(p => !isTiny(p) && !isThinSpur(p));
  if (large.length === 0) return { fillOverrides, deleteIndexes };

  const compactColorCounts = new Map<string, number>();
  for (const path of paths) {
    if (!isCompactDetail(path) || !path.rgb) continue;
    const key = `${path.rgb.r},${path.rgb.g},${path.rgb.b}`;
    compactColorCounts.set(key, (compactColorCounts.get(key) ?? 0) + 1);
  }

  const shouldAbsorb = (path: PathInfo): boolean => {
    if (isTiny(path)) return true;
    if (isThinSpur(path)) return true;
    if (hugsGlobalEdge(path, global, 2)) {
      const w = path.maxX - path.minX;
      const h = path.maxY - path.minY;
      const mn = Math.min(w, h);
      if (mn < 3.5 && path.area < SPUR_MAX_AREA) return true;
    }
    return false;
  };

  for (const crumb of paths) {
    if (!shouldAbsorb(crumb)) continue;
    if (crumb.rgb && isCompactDetail(crumb)) {
      const key = `${crumb.rgb.r},${crumb.rgb.g},${crumb.rgb.b}`;
      if ((compactColorCounts.get(key) ?? 0) >= 2) continue;
    }
    if (isLightFill(crumb.rgb) && crumb.area >= TINY_AREA && !isThinSpur(crumb) && !hugsGlobalEdge(crumb, global, 2)) {
      continue;
    }

    let best: PathInfo | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const span = Math.max(crumb.maxX - crumb.minX, crumb.maxY - crumb.minY);
    // Micro AA crumbs between unlike colors (grey on orange) — ignore fill distance.
    const microCrumbs = isTiny(crumb) && (crumb.area < 40 || span < 3);
    const colorBudget = microCrumbs
      ? 999
      : (isThinSpur(crumb) || hugsGlobalEdge(crumb, global, 2) ? 40 : 48);

    for (const neighbor of large) {
      if (neighbor.index === crumb.index) continue;
      if (!boxesNear(crumb, neighbor, 6)) continue;
      if (neighbor.area <= crumb.area * 2) continue;
      if (fillDistance(crumb.rgb, neighbor.rgb) > colorBudget) continue;
      const contains =
        crumb.cx >= neighbor.minX && crumb.cx <= neighbor.maxX &&
        crumb.cy >= neighbor.minY && crumb.cy <= neighbor.maxY;
      // Edge distance to neighbor bbox (0 if inside) — AA crumbs sit on the host edge.
      const dx = crumb.cx < neighbor.minX ? neighbor.minX - crumb.cx
        : crumb.cx > neighbor.maxX ? crumb.cx - neighbor.maxX : 0;
      const dy = crumb.cy < neighbor.minY ? neighbor.minY - crumb.cy
        : crumb.cy > neighbor.maxY ? crumb.cy - neighbor.maxY : 0;
      const edgeDist = Math.hypot(dx, dy);
      // Prefer containing / touching hosts, then larger area (main body over distant rings).
      const score = (contains ? 0 : 500) + edgeDist * 10 - Math.sqrt(neighbor.area);
      if (score < bestScore) {
        bestScore = score;
        best = neighbor;
      }
    }
    if (!best) continue;

    const sameColor = fillDistance(crumb.rgb, best.rgb) <= 24;
    const isSpurLike = isThinSpur(crumb) || (
      hugsGlobalEdge(crumb, global, 2) &&
      Math.min(crumb.maxX - crumb.minX, crumb.maxY - crumb.minY) < 3.5
    );

    // Same-color needle/edge strips must be removed — recolor alone leaves a visible spur.
    if (sameColor && isSpurLike) {
      deleteIndexes.add(crumb.index);
    } else {
      fillOverrides.set(crumb.index, best.fill);
    }
  }

  return { fillOverrides, deleteIndexes };
}

/**
 * Post-trace cleanup:
 * absorb edge debris by recoloring/deleting, simplify collinear L runs only,
 * then seal empty seams with stroke=fill.
 */
export function sealAndStraightenSvg(svgStr: string): string {
  const paths = parsePaths(svgStr);
  if (paths.length === 0) return svgStr;

  try {
    const { fillOverrides, deleteIndexes } = absorbEdgeDebris(paths);
    let pathIndex = 0;

    return svgStr.replace(/<path\b[^>]*\/?>/gi, (tag) => {
      const currentIndex = pathIndex;
      pathIndex += 1;

      if (deleteIndexes.has(currentIndex)) return '';

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
