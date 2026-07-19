import { rgbaToVtracerSvg, type VTracerPreset } from '../vtracer-trace';
import type { TracerBackend, TraceRequest } from './types';

/**
 * Website-style VTracer path (vectorize-image.app presets).
 * Raw pixels in → raw SVG out (no posterize/seal — handled by controller).
 * Remove later: unregister from index.ts and delete this file.
 */
export const vectorizeImageBackend: TracerBackend = {
  id: 'vectorize-image',
  label: 'Vectorize Image',
  description: 'Website presets (Logo/Sketch/Photo): raw VTracer SVG, no color lock.',
  async trace(request: TraceRequest): Promise<string> {
    return rgbaToVtracerSvg(request.data, request.width, request.height, {
      colorCount: request.colorCount,
      lockPalette: false,
      preset: (request.preset ?? 'logo') as VTracerPreset,
      viColorPrecision: request.viColorPrecision,
      viFilterSpeckle: request.viFilterSpeckle,
      viPathPrecision: request.viPathPrecision,
    });
  },
};
