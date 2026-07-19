import { imagetracerBackend } from './imagetracer';
import { vtracerBackend } from './vtracer';
import type { TracerBackend, TracerId, TraceRequest } from './types';

export type { TracerBackend, TracerId, TraceRequest, TracerPaletteColor } from './types';

/**
 * Registered backends. Order = UI order.
 * To drop a method: remove its import + entry here (and its package if unused).
 */
const BACKENDS: TracerBackend[] = [vtracerBackend, imagetracerBackend];

const BY_ID = new Map<TracerId, TracerBackend>(
  BACKENDS.map((b) => [b.id, b]),
);

export const DEFAULT_TRACER_ID: TracerId = 'vtracer';

export function listTracerBackends(): TracerBackend[] {
  return [...BACKENDS];
}

export function getTracerBackend(id: TracerId | string | undefined): TracerBackend {
  if (id && BY_ID.has(id as TracerId)) {
    return BY_ID.get(id as TracerId)!;
  }
  return BY_ID.get(DEFAULT_TRACER_ID)!;
}

export function isTracerId(value: unknown): value is TracerId {
  return typeof value === 'string' && BY_ID.has(value as TracerId);
}

/** Dispatch to the selected backend. */
export async function traceRasterToSvg(
  id: TracerId,
  request: TraceRequest,
): Promise<string> {
  return getTracerBackend(id).trace(request);
}
