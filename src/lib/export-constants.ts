/** Preview vertex count above which export may be slow — user confirmation recommended. */
export const EXPORT_VERTEX_SOFT_LIMIT = 500_000;

/** Preview vertex count above which export needs an extra strong confirm (not a hard block). */
export const EXPORT_VERTEX_HARD_LIMIT = 2_000_000;

/** Yield Clipper / shape loops every N items during export. */
export const EXPORT_YIELD_EVERY_SHAPES = 40;

/** Vertices per XML chunk when writing 3MF mesh objects. */
export const EXPORT_3MF_VERTEX_CHUNK = 10_000;

/** Yield fuse path extraction every N parts. */
export const FUSE_YIELD_EVERY_PARTS = 32;

/** Union this many part polygons per Clipper batch during fuse. */
export const FUSE_UNION_BATCH_SIZE = 32;

/** Confirm fuse when selection exceeds this many parts. */
export const FUSE_CONFIRM_PARTS = 200;

export class ExportAbortError extends Error {
  constructor(message = 'Export cancelled') {
    super(message);
    this.name = 'ExportAbortError';
  }
}

export function throwIfExportAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportAbortError();
}

export const yieldExportThread = () =>
  new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
