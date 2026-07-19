import ImageTracer from 'imagetracerjs';
import type { TracerBackend, TraceRequest } from './types';

/**
 * Optional legacy backend — imagetracerjs.
 * Remove later: unregister from index.ts, delete this file, uninstall imagetracerjs.
 */
export const imagetracerBackend: TracerBackend = {
  id: 'imagetracer',
  label: 'ImageTracer',
  description: 'Legacy ImageTracer.js path. Keep for comparison / fallback.',
  async trace(request: TraceRequest): Promise<string> {
    const { data, width, height, colorCount, palette } = request;
    const imgd = {
      width,
      height,
      data: data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data),
    };

    const pal =
      palette.length > 0
        ? palette.map((c) => ({
            r: c.r,
            g: c.g,
            b: c.b,
            a: c.a ?? 255,
          }))
        : undefined;

    const options: Record<string, unknown> = {
      colorsampling: pal ? 0 : 2,
      numberofcolors: pal?.length ?? colorCount,
      colorquantcycles: pal ? 1 : 3,
      mincolorratio: 0.002,
      strokewidth: 0,
      viewbox: true,
      pathomit: 6,
      ltres: 2.0,
      qtres: 0.35,
      rightangleenhance: true,
      roundcoords: 1,
      blurradius: 0,
      blurdelta: 20,
      linefilter: true,
    };
    if (pal) options.pal = pal;

    // imagedataToSVG is sync in imagetracerjs — wrap for a uniform async API.
    const svgStr = ImageTracer.imagedataToSVG(imgd, options) as string;
    return svgStr;
  },
};
