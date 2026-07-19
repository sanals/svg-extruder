/**
 * Pluggable raster→SVG tracer backends.
 * Add a new file under this folder + register it in index.ts.
 * To retire a backend: unregister it and delete its module/deps.
 */

export type TracerId = 'vtracer' | 'imagetracer';

export interface TracerPaletteColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface TraceRequest {
  /** Posterized (or prepared) RGBA buffer. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** UI color-count slider (max palette size). */
  colorCount: number;
  /** Exact palette used for posterize / SVG snap. */
  palette: TracerPaletteColor[];
}

export interface TracerBackend {
  id: TracerId;
  /** Short label for the UI segmented control. */
  label: string;
  /** One-line description for tooltips. */
  description: string;
  trace(request: TraceRequest): Promise<string>;
}
