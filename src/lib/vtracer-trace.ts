/**
 * Browser wrapper around visioncortex VTracer (via vtracer-wasm).
 * Produces spline SVG paths — closer to pngtosvg-quality curves than ImageTracer.
 */

import init, { to_svg } from 'vtracer-wasm';
import wasmUrl from 'vtracer-wasm/vtracer.wasm?url';

export interface VTracerTraceOptions {
  /** Approximate palette size hint (from UI / preprocess). */
  colorCount?: number;
}

interface VTracerConfig {
  binary: boolean;
  mode: 'spline' | 'polygon' | 'pixel';
  hierarchical: 'stacked' | 'cutout';
  cornerThreshold: number;
  lengthThreshold: number;
  maxIterations: number;
  spliceThreshold: number;
  filterSpeckle: number;
  colorPrecision: number;
  layerDifference: number;
  pathPrecision: number;
}

let initPromise: Promise<void> | null = null;

function ensureVtracerReady(): Promise<void> {
  if (!initPromise) {
    initPromise = init({ module_or_path: wasmUrl }).then(() => undefined);
  }
  return initPromise;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Build config matching VTracer poster/clip-art defaults, with thresholds in
 * radians (what vtracer-wasm passes straight into to_compound_path).
 *
 * Note: `colorPrecision` here is the Runner `is_same_color_a` loss value
 * (cmdapp uses `8 - color_precision_bits`). `filterSpeckle` is an area in px².
 */
function buildConfig(colorCount: number): VTracerConfig {
  const colors = Math.max(2, Math.min(64, Math.round(colorCount)));
  // Pre-quantized clip art: low loss so flat regions stay intact.
  // Fewer UI colors → allow slightly more merge; many colors → loss 0.
  const colorPrecision = colors <= 6 ? 2 : colors <= 12 ? 1 : 0;
  const layerDifference = colors <= 8 ? 16 : colors <= 16 ? 20 : 28;
  // pngtosvg-like speckleSize ~8 → area 64 (cmdapp squares the linear size).
  const filterSpeckle = 8 * 8;

  return {
    binary: false,
    mode: 'spline',
    hierarchical: 'stacked',
    cornerThreshold: degToRad(60),
    lengthThreshold: 4,
    maxIterations: 10,
    spliceThreshold: degToRad(45),
    filterSpeckle,
    colorPrecision,
    layerDifference,
    pathPrecision: 2,
  };
}

export async function imageDataToVtracerSvg(
  imageData: ImageData,
  options: VTracerTraceOptions = {},
): Promise<string> {
  await ensureVtracerReady();
  const pixels = new Uint8Array(imageData.data);
  const config = buildConfig(options.colorCount ?? 16);
  return to_svg(pixels, imageData.width, imageData.height, config);
}

/** Decode a PNG/JPEG data URL into ImageData for VTracer. */
export async function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to decode image for vectorization'));
    img.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create canvas context for vectorization');
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function dataUrlToVtracerSvg(
  dataUrl: string,
  options: VTracerTraceOptions = {},
): Promise<string> {
  const imageData = await dataUrlToImageData(dataUrl);
  return imageDataToVtracerSvg(imageData, options);
}
