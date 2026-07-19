import { rgbaToVtracerSvg } from '../vtracer-trace';
import type { TracerBackend, TraceRequest } from './types';

/**
 * Print-oriented VTracer (posterize + seal applied by the controller).
 * Remove: unregister from index.ts and drop vtracer-wasm / vtracer-trace.ts.
 */
export const vtracerBackend: TracerBackend = {
  id: 'vtracer',
  label: 'VTracer',
  description: 'Print path: lock to N colors, seal seams for extrusion.',
  async trace(request: TraceRequest): Promise<string> {
    return rgbaToVtracerSvg(request.data, request.width, request.height, {
      colorCount: request.colorCount,
      lockPalette: true,
      preset: request.preset ?? 'logo',
      filterSpeckle: request.filterSpeckle,
      colorPrecisionBits: request.colorPrecisionBits,
    });
  },
};
