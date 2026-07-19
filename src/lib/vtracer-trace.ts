/**
 * Browser wrapper around visioncortex VTracer (via vtracer-wasm).
 * Runs in a Web Worker (pngtosvg-style) so the UI stays responsive.
 */

import type { VTracerWorkerRequest, VTracerWorkerResponse } from './vtracer.worker';

export interface VTracerTraceOptions {
  /** Approximate palette size hint from the UI color slider. */
  colorCount?: number;
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
 * Build config for clip-art / logos.
 * `colorPrecision` is Runner `is_same_color_a` loss (cmdapp: `8 - bits`).
 * `filterSpeckle` is area in px².
 */
export function buildVtracerConfig(colorCount: number): VTracerConfig {
  const colors = Math.max(2, Math.min(64, Math.round(colorCount)));
  // Input is already posterized to ≤N flat colors. Use strong same-color loss
  // so VTracer does not re-split a single flat into near-shade layers.
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
  // Drop 1–few-pixel fringe clusters (trash AA / edge crumbs).
  const filterSpeckle = 12 * 12;

  return {
    binary: false,
    mode: 'spline',
    hierarchical: 'stacked',
    cornerThreshold: degToRad(90),
    lengthThreshold: 3,
    maxIterations: 10,
    spliceThreshold: degToRad(30),
    filterSpeckle,
    colorPrecision,
    layerDifference,
    pathPrecision: 3,
  };
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
  const config = buildVtracerConfig(options.colorCount ?? 16);
  // Transferable copy — leaves the caller's ImageData intact.
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
  const config = buildVtracerConfig(options.colorCount ?? 16);
  const pixels = rgba.slice().buffer;
  return postToWorker(pixels, width, height, config);
}
