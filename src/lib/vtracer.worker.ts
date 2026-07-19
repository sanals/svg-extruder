/// <reference lib="webworker" />
/**
 * Off-main-thread VTracer (pngtosvg-style): RGBA in → SVG string out.
 */

import init, { to_svg } from 'vtracer-wasm';
import wasmUrl from 'vtracer-wasm/vtracer.wasm?url';

export interface VTracerWorkerRequest {
  id: number;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  // camelCase config object consumed by vtracer-wasm serde
  config: {
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
  };
}

export type VTracerWorkerResponse =
  | { id: number; type: 'done'; svg: string }
  | { id: number; type: 'error'; message: string };

let initPromise: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  if (!initPromise) {
    initPromise = init({ module_or_path: wasmUrl }).then(() => undefined);
  }
  return initPromise;
}

self.onmessage = async (ev: MessageEvent<VTracerWorkerRequest>) => {
  const { id, pixels, width, height, config } = ev.data;
  try {
    await ensureReady();
    const svg = to_svg(new Uint8Array(pixels), width, height, config);
    const response: VTracerWorkerResponse = { id, type: 'done', svg };
    self.postMessage(response);
  } catch (err) {
    const response: VTracerWorkerResponse = {
      id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(response);
  }
};
