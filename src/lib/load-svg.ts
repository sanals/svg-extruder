import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { ShapeItem } from '../types';
import { processGeometry } from './svg-parser';

export async function loadSvgToShapes(
  svgUrl: string,
  options?: {
    cutOverlaps?: boolean;
    onProgress?: (msg: string | null) => void;
  },
): Promise<ShapeItem[]> {
  const loader = new SVGLoader();
  const svgData = await new Promise<ReturnType<SVGLoader['parse']>>((resolve, reject) => {
    loader.load(svgUrl, resolve, undefined, reject);
  });
  const shapes = await processGeometry(
    svgData,
    options?.cutOverlaps ?? false,
    (msg) => options?.onProgress?.(msg ?? null),
  );
  options?.onProgress?.(null);
  return shapes;
}
