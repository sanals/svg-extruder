/**
 * Pluggable raster→SVG tracer backends.
 * Add a new file under this folder + register it in index.ts.
 * To retire a backend: unregister it and delete its module/deps.
 */

export type TracerId = 'vtracer' | 'vectorize-image' | 'imagetracer';

export type VTracerPresetId = 'logo' | 'sketch' | 'photo';

export interface TracerPaletteColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface TraceRequest {
  /** Prepared RGBA buffer (posterized when lockPalette is true). */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** UI color-count slider (max palette size). */
  colorCount: number;
  /** Exact palette used for posterize / SVG snap (empty when unlocked). */
  palette: TracerPaletteColor[];
  /** When true, backends may assume ≤colorCount flat colors. */
  lockPalette?: boolean;
  /** VTracer website-style preset (ignored by ImageTracer). */
  preset?: VTracerPresetId;
  /** Print-path filter_speckle UI (n → area n²). */
  filterSpeckle?: number;
  /** Print-path color_precision bits (1–8). Omit / 0 = auto tiers. */
  colorPrecisionBits?: number;
  /** Website-path advanced: color_precision bits (1–8). */
  viColorPrecision?: number;
  /** Website-path advanced: filter_speckle UI (n → area n²). */
  viFilterSpeckle?: number;
  /** Website-path advanced: path_precision. */
  viPathPrecision?: number;
}

export interface TracerBackend {
  id: TracerId;
  /** Short label for the UI segmented control. */
  label: string;
  /** One-line description for tooltips. */
  description: string;
  trace(request: TraceRequest): Promise<string>;
}
