/**
 * Browser wrapper around visioncortex VTracer (via vtracer-wasm).
 * Runs in a Web Worker (pngtosvg-style) so the UI stays responsive.
 */

import type { VTracerWorkerRequest, VTracerWorkerResponse } from './vtracer.worker';

/** Matches vectorize-image.app Logo / Sketch / Photo presets. */
export type VTracerPreset = 'logo' | 'sketch' | 'photo';

export interface VTracerTraceOptions {
  /** Approximate palette size hint from the UI color slider (print / lock path). */
  colorCount?: number;
  /**
   * Website-style preset (Vectorize Image backend).
   * UI bits/speckle are converted to Runner loss / area before wasm.
   */
  preset?: VTracerPreset;
  /**
   * When true (VTracer print path), tune for posterized ≤N colors.
   * When false (Vectorize Image), use preset knobs like vectorize-image.app.
   */
  lockPalette?: boolean;
}

/** Site UI color_precision bits → Runner is_same_color_a loss (cmdapp). */
function bitsToLoss(bits: number): number {
  return Math.max(0, Math.min(8, 8 - Math.round(bits)));
}

/** Site UI filter_speckle → area in px² (cmdapp: n*n). */
function speckleToArea(n: number): number {
  const v = Math.max(0, Math.round(n));
  return v * v;
}

/** Config shape expected by vtracer-wasm (camelCase). */
export interface VTracerConfig {
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

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Print / locked-palette path: input is already posterized to ≤N flats.
 * Stronger loss so VTracer does not re-split a single flat into near-shades.
 * (Locked path still uses Runner-style loss values, not webapp UI bits.)
 */
export function buildVtracerConfig(colorCount: number): VTracerConfig {
  const colors = Math.max(2, Math.min(64, Math.round(colorCount)));
  let colorPrecision: number;
  let layerDifference: number;
  if (colors <= 4) {
    colorPrecision = 8;
    layerDifference = 48;
  } else if (colors <= 8) {
    colorPrecision = 6;
    layerDifference = 32;
  } else if (colors <= 16) {
    colorPrecision = 5;
    layerDifference = 28;
  } else if (colors <= 32) {
    colorPrecision = 3;
    layerDifference = 20;
  } else {
    colorPrecision = 2;
    layerDifference = 16;
  }

  return {
    binary: false,
    mode: 'spline',
    hierarchical: 'stacked',
    cornerThreshold: degToRad(90),
    lengthThreshold: 3,
    maxIterations: 10,
    spliceThreshold: degToRad(30),
    filterSpeckle: 12 * 12,
    colorPrecision,
    layerDifference,
    pathPrecision: 3,
  };
}

/**
 * vectorize-image.app–style presets for vtracer-wasm.
 * Site UI shows bits/speckle; wasm expects loss/area (same as our print path).
 * Logo advanced: color 6 → loss 2, speck 4 → area 16, path 2.
 * Curve defaults from visioncortex demo: corner 60°, length 4, splice 45°.
 */
export function buildVtracerPresetConfig(preset: VTracerPreset = 'logo'): VTracerConfig {
  const base: VTracerConfig = {
    binary: false,
    mode: 'spline',
    hierarchical: 'stacked',
    cornerThreshold: degToRad(60),
    lengthThreshold: 4,
    maxIterations: 10,
    spliceThreshold: degToRad(45),
    filterSpeckle: speckleToArea(4),
    colorPrecision: bitsToLoss(6),
    layerDifference: 16,
    pathPrecision: 2,
  };

  if (preset === 'sketch') {
    return {
      ...base,
      binary: true,
      colorPrecision: bitsToLoss(1),
      layerDifference: 32,
      filterSpeckle: speckleToArea(8),
      pathPrecision: 2,
    };
  }

  if (preset === 'photo') {
    return {
      ...base,
      colorPrecision: bitsToLoss(8),
      layerDifference: 8,
      filterSpeckle: speckleToArea(4),
      pathPrecision: 2,
    };
  }

  // logo (default)
  return base;
}

export function resolveVtracerConfig(options: VTracerTraceOptions = {}): VTracerConfig {
  if (options.lockPalette === false) {
    return buildVtracerPresetConfig(options.preset ?? 'logo');
  }
  return buildVtracerConfig(options.colorCount ?? 16);
}

let worker: Worker | null = null;
let nextRequestId = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./vtracer.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

function postToWorker(
  pixels: ArrayBuffer,
  width: number,
  height: number,
  config: VTracerConfig,
): Promise<string> {
  const w = getWorker();
  const id = nextRequestId++;
  const request: VTracerWorkerRequest = { id, pixels, width, height, config };

  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<VTracerWorkerResponse>) => {
      if (ev.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (ev.data.type === 'done') resolve(ev.data.svg);
      else reject(new Error(ev.data.message || 'VTracer worker failed'));
    };
    const onError = (err: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      reject(err.error ?? new Error(err.message || 'VTracer worker crashed'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage(request, [pixels]);
  });
}

/** Trace ImageData → SVG via worker. Does not mutate the source ImageData. */
export async function imageDataToVtracerSvg(
  imageData: ImageData,
  options: VTracerTraceOptions = {},
): Promise<string> {
  const config = resolveVtracerConfig(options);
  const pixels = imageData.data.slice().buffer;
  return postToWorker(pixels, imageData.width, imageData.height, config);
}

/** Trace a cloned RGBA buffer (e.g. from a cached source snapshot). */
export async function rgbaToVtracerSvg(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: VTracerTraceOptions = {},
): Promise<string> {
  const config = resolveVtracerConfig(options);
  const pixels = rgba.slice().buffer;
  return postToWorker(pixels, width, height, config);
}
