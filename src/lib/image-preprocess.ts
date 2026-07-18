export interface PaletteColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PreprocessResult {
  dataUrl: string;
  suggestedColorCount: number;
  detectedRawColors: number;
  palette: PaletteColor[];
  backgroundColor: PaletteColor | null;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Lab {
  l: number;
  a: number;
  b: number;
}

const MIN_COLOR_COUNT = 2;
const MAX_COLOR_COUNT = 64;
/** Default cap — enough for multi-tone flat icons (AI logo ~12–16 colors). */
const DEFAULT_MAX_CONTENT_COLORS = 16;
const MEDIAN_CUT_TARGET = 32;
/** Only merge very close fringe colors; intentional two-tones (two greens/pinks) stay. */
const MERGE_DELTA_E = 14;
const BACKGROUND_SEED_TOLERANCE = 18;
const MAX_SAMPLE_PIXELS = 20000;
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

function rgbKey(r: number, g: number, b: number): number {
  return (r << 16) | (g << 8) | b;
}

function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function rgbToLab({ r, g, b }: Rgb): Lab {
  let rr = r / 255;
  let gg = g / 255;
  let bb = b / 255;

  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  const x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
  const y = (rr * 0.2126 + gg * 0.7152 + bb * 0.0722) / 1.0;
  const z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;

  const fx = x > 0.008856 ? Math.cbrt(x) : (7.787 * x) + (16 / 116);
  const fy = y > 0.008856 ? Math.cbrt(y) : (7.787 * y) + (16 / 116);
  const fz = z > 0.008856 ? Math.cbrt(z) : (7.787 * z) + (16 / 116);

  return {
    l: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function deltaE76(a: Rgb, b: Rgb): number {
  const labA = rgbToLab(a);
  const labB = rgbToLab(b);
  const dl = labA.l - labB.l;
  const da = labA.a - labB.a;
  const db = labA.b - labB.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

function averageColors(colors: Rgb[]): Rgb {
  if (colors.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (const color of colors) {
    r += color.r;
    g += color.g;
    b += color.b;
  }
  const n = colors.length;
  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
  };
}

function readRgb(data: Uint8ClampedArray, index: number): Rgb {
  return { r: data[index], g: data[index + 1], b: data[index + 2] };
}

function writeRgb(data: Uint8ClampedArray, index: number, color: Rgb): void {
  data[index] = color.r;
  data[index + 1] = color.g;
  data[index + 2] = color.b;
  data[index + 3] = 255;
}

function sampleCornerPixels(data: Uint8ClampedArray, width: number, height: number): Rgb[] {
  const samples: Rgb[] = [];
  const inset = Math.max(1, Math.min(8, Math.floor(Math.min(width, height) / 32)));

  const points = [
    [inset, inset],
    [width - 1 - inset, inset],
    [inset, height - 1 - inset],
    [width - 1 - inset, height - 1 - inset],
    [Math.floor(width / 2), inset],
    [Math.floor(width / 2), height - 1 - inset],
    [inset, Math.floor(height / 2)],
    [width - 1 - inset, Math.floor(height / 2)],
  ];

  for (const [x, y] of points) {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] < 128) continue;
    samples.push(readRgb(data, idx));
  }

  return samples;
}

function detectBackgroundColor(cornerSamples: Rgb[]): Rgb | null {
  if (cornerSamples.length === 0) return null;

  const clusters: { center: Rgb; count: number }[] = [];
  for (const sample of cornerSamples) {
    const cluster = clusters.find(c => rgbDistance(c.center, sample) <= BACKGROUND_SEED_TOLERANCE);
    if (cluster) {
      cluster.count += 1;
      cluster.center = averageColors([cluster.center, sample]);
    } else {
      clusters.push({ center: sample, count: 1 });
    }
  }

  clusters.sort((a, b) => b.count - a.count);
  const dominant = clusters[0];
  if (!dominant || dominant.count < Math.ceil(cornerSamples.length * 0.5)) return null;
  return dominant.center;
}

/**
 * Edge-connected flood fill. Only background-connected pixels are marked —
 * interior whites (bin slits, pin icon) stay content even if similar to the bg.
 */
function floodFillBackgroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  background: Rgb,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const stack: number[] = [];

  const trySeed = (x: number, y: number) => {
    const i = y * width + x;
    if (mask[i]) return;
    const idx = i * 4;
    if (data[idx + 3] < 128) {
      mask[i] = 1;
      stack.push(i);
      return;
    }
    if (rgbDistance(readRgb(data, idx), background) <= BACKGROUND_SEED_TOLERANCE) {
      mask[i] = 1;
      stack.push(i);
    }
  };

  for (let x = 0; x < width; x++) {
    trySeed(x, 0);
    trySeed(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    trySeed(0, y);
    trySeed(width - 1, y);
  }

  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = Math.floor(i / width);

    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (mask[ni]) continue;

      const nIdx = ni * 4;
      if (data[nIdx + 3] < 128) {
        mask[ni] = 1;
        stack.push(ni);
        continue;
      }

      if (rgbDistance(readRgb(data, nIdx), background) <= BACKGROUND_SEED_TOLERANCE) {
        mask[ni] = 1;
        stack.push(ni);
      }
    }
  }

  return mask;
}

function sampleContentPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bgMask: Uint8Array,
): Rgb[] {
  const pixels: Rgb[] = [];
  const totalPixels = width * height;
  const stride = Math.max(1, Math.floor(totalPixels / MAX_SAMPLE_PIXELS));

  for (let i = 0; i < totalPixels; i += stride) {
    if (bgMask[i]) continue;
    const idx = i * 4;
    if (data[idx + 3] < 128) continue;
    pixels.push(readRgb(data, idx));
  }

  return pixels;
}

function medianCut(colors: Rgb[], maxColors: number): Rgb[] {
  if (colors.length === 0) return [];
  if (colors.length <= maxColors) {
    return Array.from(new Map(colors.map(c => [rgbKey(c.r, c.g, c.b), c])).values());
  }

  type Box = { pixels: Rgb[] };
  const boxes: Box[] = [{ pixels: [...colors] }];

  while (boxes.length < maxColors) {
    boxes.sort((a, b) => b.pixels.length - a.pixels.length);
    const box = boxes.shift();
    if (!box || box.pixels.length <= 1) {
      if (box) boxes.push(box);
      break;
    }

    let minR = 255;
    let minG = 255;
    let minB = 255;
    let maxR = 0;
    let maxG = 0;
    let maxB = 0;

    for (const pixel of box.pixels) {
      minR = Math.min(minR, pixel.r);
      minG = Math.min(minG, pixel.g);
      minB = Math.min(minB, pixel.b);
      maxR = Math.max(maxR, pixel.r);
      maxG = Math.max(maxG, pixel.g);
      maxB = Math.max(maxB, pixel.b);
    }

    const rangeR = maxR - minR;
    const rangeG = maxG - minG;
    const rangeB = maxB - minB;

    let channel: 'r' | 'g' | 'b' = 'r';
    if (rangeG >= rangeR && rangeG >= rangeB) channel = 'g';
    else if (rangeB >= rangeR && rangeB >= rangeG) channel = 'b';

    box.pixels.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(box.pixels.length / 2);
    boxes.push({ pixels: box.pixels.slice(0, mid) });
    boxes.push({ pixels: box.pixels.slice(mid) });
  }

  return boxes.map(box => averageColors(box.pixels));
}

function mergeSimilarPalette(colors: Rgb[], threshold: number): Rgb[] {
  const merged: Rgb[] = [];
  for (const color of colors) {
    const duplicate = merged.find(existing => deltaE76(existing, color) < threshold);
    if (!duplicate) merged.push(color);
  }
  return merged;
}

/**
 * Collapse fringe / anti-alias midtones into dominant flat colors.
 * Always keeps the higher-frequency color when merging (never invents a new average).
 */
function collapsePalette(
  colors: Rgb[],
  frequencies: number[],
  maxColors: number,
  minDeltaE: number,
): Rgb[] {
  type Entry = { color: Rgb; count: number };
  const entries: Entry[] = colors.map((color, i) => ({ color, count: frequencies[i] ?? 1 }));

  const mergeOnce = (): boolean => {
    if (entries.length <= 1) return false;

    let bestI = -1;
    let bestJ = -1;
    let bestDist = Number.POSITIVE_INFINITY;

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const dist = deltaE76(entries[i].color, entries[j].color);
        if (dist < bestDist) {
          bestDist = dist;
          bestI = i;
          bestJ = j;
        }
      }
    }

    const overBudget = entries.length > maxColors;
    if (!overBudget && bestDist >= minDeltaE) return false;

    const keep = entries[bestI].count >= entries[bestJ].count ? bestI : bestJ;
    const drop = keep === bestI ? bestJ : bestI;
    entries[keep].count += entries[drop].count;
    entries.splice(drop, 1);
    return true;
  };

  while (mergeOnce()) { /* keep collapsing */ }

  return entries.map(e => e.color);
}

function countColorFrequencies(samples: Rgb[], palette: Rgb[]): number[] {
  const counts = new Array(palette.length).fill(0);
  for (const sample of samples) {
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < palette.length; i++) {
      const dist = deltaE76(sample, palette[i]);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    counts[best] += 1;
  }
  return counts;
}

function ensureDistinctColor(palette: Rgb[], color: Rgb, minDeltaE: number): Rgb[] {
  if (palette.some(existing => deltaE76(existing, color) < minDeltaE)) return palette;
  return [...palette, color];
}

function nearestPaletteColor(color: Rgb, palette: Rgb[]): Rgb {
  let best = palette[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of palette) {
    const distance = deltaE76(color, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return best;
}

function buildPalette(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bgMask: Uint8Array,
  background: Rgb,
  maxContentColors: number,
): Rgb[] {
  const sampled = sampleContentPixels(data, width, height, bgMask);
  if (sampled.length === 0) return [background];

  let palette = mergeSimilarPalette(medianCut(sampled, MEDIAN_CUT_TARGET), 8);
  const frequencies = countColorFrequencies(sampled, palette);
  palette = collapsePalette(palette, frequencies, maxContentColors, MERGE_DELTA_E);

  // Preserve pure white when content has near-white pixels (letters, bin slits, pin icon).
  const hasNearWhite = sampled.some(c => rgbDistance(c, WHITE) <= 40);
  if (hasNearWhite) {
    if (!palette.some(c => rgbDistance(c, WHITE) <= 30)) {
      palette = [...palette, WHITE];
    }
    // If over budget after forcing white, drop the least-used non-white/non-bg color.
    if (palette.length > maxContentColors) {
      const freqs = countColorFrequencies(sampled, palette);
      const ranked = palette
        .map((c, i) => ({ c, i, n: freqs[i] ?? 0 }))
        .filter(e => rgbDistance(e.c, WHITE) > 30 && deltaE76(e.c, background) >= 8)
        .sort((a, b) => a.n - b.n);
      const dropIndexes = new Set<number>();
      for (const entry of ranked) {
        if (palette.length - dropIndexes.size <= maxContentColors) break;
        dropIndexes.add(entry.i);
      }
      palette = palette.filter((_, i) => !dropIndexes.has(i));
    }
  }

  // Keep background as its own palette entry so it doesn't steal white/orange.
  palette = ensureDistinctColor(palette, background, 8);

  return palette;
}

function quantizeToPalette(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  palette: Rgb[],
  bgMask: Uint8Array,
  background: Rgb,
): void {
  const contentPalette = palette.filter(c => deltaE76(c, background) >= 8);
  const snapPalette = contentPalette.length > 0 ? contentPalette : palette;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const idx = i * 4;

      if (bgMask[i] || data[idx + 3] < 128) {
        writeRgb(data, idx, background);
        continue;
      }

      writeRgb(data, idx, nearestPaletteColor(readRgb(data, idx), snapPalette));
    }
  }
}

/**
 * Remove 1-pixel anti-alias fringe after quantization.
 * Never erases light/white ink into darker neighbors (protects thin letters like "I").
 */
function despeckleIndexed(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bgMask: Uint8Array,
  passes = 2,
): void {
  for (let pass = 0; pass < passes; pass++) {
    const source = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (bgMask[i]) continue;

        const idx = i * 4;
        if (source[idx + 3] < 128) continue;

        const selfR = source[idx];
        const selfG = source[idx + 1];
        const selfB = source[idx + 2];
        const selfLum = 0.299 * selfR + 0.587 * selfG + 0.114 * selfB;
        // Thin white/light strokes are intentional — do not majority-vote them away.
        if (selfLum >= 200) continue;

        const selfKey = rgbKey(selfR, selfG, selfB);
        const counts = new Map<number, number>();

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (bgMask[ni]) continue;
            const nIdx = ni * 4;
            if (source[nIdx + 3] < 128) continue;
            const key = rgbKey(source[nIdx], source[nIdx + 1], source[nIdx + 2]);
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        }

        const selfCount = counts.get(selfKey) ?? 0;
        // Midtone fringe between two flats is often 2–3px thick — still dissolve it.
        if (selfCount > 3) continue;

        let bestKey = selfKey;
        let bestCount = 0;
        counts.forEach((count, key) => {
          if (key === selfKey) return;
          if (count > bestCount) {
            bestCount = count;
            bestKey = key;
          }
        });

        if (bestKey !== selfKey && bestCount >= 4) {
          writeRgb(data, idx, {
            r: (bestKey >> 16) & 0xff,
            g: (bestKey >> 8) & 0xff,
            b: bestKey & 0xff,
          });
        }
      }
    }
  }
}

/**
 * Detect palette colors that only exist as thin anti-alias borders (high edge ratio)
 * and remap them into the nearest solid/dominant color. Keeps intentional two-tones
 * (large filled regions) while killing peach/brown shard layers on JPEG edges.
 */
function dissolveFringeColors(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bgMask: Uint8Array,
  background: Rgb,
): void {
  type Stats = { count: number; edgeCount: number; color: Rgb };
  const stats = new Map<number, Stats>();
  let contentPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (bgMask[i]) continue;
      const idx = i * 4;
      if (data[idx + 3] < 128) continue;

      const color = readRgb(data, idx);
      if (deltaE76(color, background) < 8) continue;

      const key = rgbKey(color.r, color.g, color.b);
      let entry = stats.get(key);
      if (!entry) {
        entry = { count: 0, edgeCount: 0, color };
        stats.set(key, entry);
      }
      entry.count += 1;
      contentPixels += 1;

      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      let onEdge = false;
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          onEdge = true;
          break;
        }
        const ni = ny * width + nx;
        if (bgMask[ni]) {
          onEdge = true;
          break;
        }
        const nIdx = ni * 4;
        const nKey = rgbKey(data[nIdx], data[nIdx + 1], data[nIdx + 2]);
        if (nKey !== key) {
          onEdge = true;
          break;
        }
      }
      if (onEdge) entry.edgeCount += 1;
    }
  }

  if (contentPixels === 0 || stats.size <= 1) return;

  const ranked = Array.from(stats.entries()).sort((a, b) => b[1].count - a[1].count);
  const dominantKeys = new Set(ranked.slice(0, Math.min(8, ranked.length)).map(([k]) => k));

  const fringeKeys = new Set<number>();
  for (const [key, entry] of stats) {
    const lum = 0.299 * entry.color.r + 0.587 * entry.color.g + 0.114 * entry.color.b;
    if (lum >= 200) continue; // never dissolve white/light ink

    const edgeRatio = entry.edgeCount / entry.count;
    const areaRatio = entry.count / contentPixels;
    const isFringe =
      (edgeRatio >= 0.55 && areaRatio < 0.12) ||
      (edgeRatio >= 0.75 && areaRatio < 0.2) ||
      (areaRatio < 0.015 && !dominantKeys.has(key));

    if (isFringe) fringeKeys.add(key);
  }

  if (fringeKeys.size === 0) return;

  const solidPalette = ranked
    .filter(([key]) => !fringeKeys.has(key))
    .map(([, entry]) => entry.color);

  if (solidPalette.length === 0) return;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (bgMask[i]) continue;
      const idx = i * 4;
      if (data[idx + 3] < 128) continue;

      const key = rgbKey(data[idx], data[idx + 1], data[idx + 2]);
      if (!fringeKeys.has(key)) continue;

      // Prefer the most common solid neighbor; fall back to nearest solid palette color.
      const neighborCounts = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (bgMask[ni]) continue;
          const nIdx = ni * 4;
          const nKey = rgbKey(data[nIdx], data[nIdx + 1], data[nIdx + 2]);
          if (fringeKeys.has(nKey)) continue;
          neighborCounts.set(nKey, (neighborCounts.get(nKey) ?? 0) + 1);
        }
      }

      let bestNeighbor: number | null = null;
      let bestNeighborCount = 0;
      neighborCounts.forEach((count, nKey) => {
        if (count > bestNeighborCount) {
          bestNeighborCount = count;
          bestNeighbor = nKey;
        }
      });

      if (bestNeighbor !== null) {
        writeRgb(data, idx, {
          r: (bestNeighbor >> 16) & 0xff,
          g: (bestNeighbor >> 8) & 0xff,
          b: bestNeighbor & 0xff,
        });
      } else {
        writeRgb(data, idx, nearestPaletteColor(readRgb(data, idx), solidPalette));
      }
    }
  }
}

function toTracerPalette(palette: Rgb[]): PaletteColor[] {
  return palette.map(color => ({ r: color.r, g: color.g, b: color.b, a: 255 }));
}

function extractPaletteFromImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bgMask: Uint8Array,
  background: Rgb,
): Rgb[] {
  const unique = new Map<number, Rgb>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (bgMask[i]) continue;
      const idx = i * 4;
      if (data[idx + 3] < 128) continue;
      const color = readRgb(data, idx);
      unique.set(rgbKey(color.r, color.g, color.b), color);
    }
  }
  const palette = Array.from(unique.values());
  return ensureDistinctColor(palette, background, 8);
}

function toPaletteColor(color: Rgb): PaletteColor {
  return { r: color.r, g: color.g, b: color.b, a: 255 };
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

/** Remove SVG paths whose fill matches the background (keeps white content intact). */
export function stripBackgroundFromSvg(svgStr: string, background: PaletteColor | null): string {
  if (!background) return svgStr;

  return svgStr.replace(/<path\b[^>]*\/?>/gi, (pathTag) => {
    const fillMatch = pathTag.match(/\bfill\s*=\s*["']([^"']+)["']/i);
    if (!fillMatch) return pathTag;
    const rgb = parseFillRgb(fillMatch[1]);
    if (!rgb) return pathTag;
    if (rgbDistance(rgb, background) <= 8) return '';
    return pathTag;
  });
}

/**
 * Drop microscopic shard paths left by ImageTracer (few vertices / tiny bbox).
 * Never strips light/white fills (letters, cutouts).
 */
export function stripTinyShardPaths(svgStr: string, minPoints = 8, minSpan = 4): string {
  return svgStr.replace(/<path\b[^>]*\/?>/gi, (pathTag) => {
    const fillMatch = pathTag.match(/\bfill\s*=\s*["']([^"']+)["']/i);
    const fillRgb = fillMatch ? parseFillRgb(fillMatch[1]) : null;
    if (fillRgb) {
      const lum = 0.299 * fillRgb.r + 0.587 * fillRgb.g + 0.114 * fillRgb.b;
      if (lum >= 200) return pathTag;
    }

    const dMatch = pathTag.match(/\bd\s*=\s*["']([^"']+)["']/i);
    if (!dMatch) return pathTag;

    const nums = dMatch[1].match(/-?\d*\.?\d+/g);
    if (!nums || nums.length < 4) return '';

    const coords: number[] = nums.map(Number);
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
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const span = Math.max(spanX, spanY);
    const area = Math.max(0, spanX) * Math.max(0, spanY);
    const pointCount = Math.floor(coords.length / 2);

    // Tiny crumbs along joins — regardless of how many jaggy vertices they have.
    if (area < 20 || span < minSpan) return '';
    if (pointCount < minPoints && area < 80) return '';

    return pathTag;
  });
}

export interface PreprocessOptions {
  /** Max distinct content colors (excluding background). Slider drives this. */
  maxContentColors?: number;
}

export function preprocessCanvas(
  canvas: HTMLCanvasElement,
  options: PreprocessOptions = {},
): PreprocessResult {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D canvas context for image preprocessing.');
  }

  const maxContentColors = Math.min(
    MAX_COLOR_COUNT,
    Math.max(MIN_COLOR_COUNT, options.maxContentColors ?? DEFAULT_MAX_CONTENT_COLORS),
  );

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const cornerSamples = sampleCornerPixels(data, width, height);
  const background = detectBackgroundColor(cornerSamples) ?? { r: 245, g: 245, b: 245 };
  const bgMask = floodFillBackgroundMask(data, width, height, background);

  // Keep full source dimensions so the SVG viewBox matches the uploaded image.
  // Background is flattened in-place and stripped from the SVG after tracing.
  let palette = buildPalette(data, width, height, bgMask, background, maxContentColors);
  quantizeToPalette(data, width, height, palette, bgMask, background);
  dissolveFringeColors(data, width, height, bgMask, background);
  despeckleIndexed(data, width, height, bgMask, 2);
  // Second fringe pass after despeckle catches leftover AA crumbs.
  dissolveFringeColors(data, width, height, bgMask, background);

  // Rebuild palette from the cleaned raster so ImageTracer never sees dissolved fringe colors.
  palette = extractPaletteFromImage(data, width, height, bgMask, background);

  const suggestedColorCount = Math.min(
    MAX_COLOR_COUNT,
    Math.max(MIN_COLOR_COUNT, palette.filter(c => deltaE76(c, background) >= 8).length),
  );

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) {
    throw new Error('Could not create output canvas for image preprocessing.');
  }
  outputCtx.putImageData(imageData, 0, 0);

  return {
    dataUrl: outputCanvas.toDataURL('image/png'),
    suggestedColorCount: Math.max(MIN_COLOR_COUNT, suggestedColorCount),
    detectedRawColors: palette.length,
    palette: toTracerPalette(palette),
    backgroundColor: toPaletteColor(background),
  };
}
