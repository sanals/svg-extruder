import { rgbaToVtracerSvg } from '../vtracer-trace';
import type { TracerBackend, TraceRequest } from './types';

/**
 * Default backend — visioncortex VTracer (wasm worker).
 * Remove: unregister from index.ts and drop vtracer-wasm / vtracer-trace.ts.
 */
export const vtracerBackend: TracerBackend = {
  id: 'vtracer',
  label: 'VTracer',
  description: 'Fast stacked spline tracer (default). Best for logos / flat art.',
  async trace(request: TraceRequest): Promise<string> {
    return rgbaToVtracerSvg(request.data, request.width, request.height, {
      colorCount: request.colorCount,
    });
  },
};
