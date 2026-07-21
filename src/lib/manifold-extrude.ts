/**
 * Watertight extrusion via manifold-3d (WASM).
 * Prefer this over THREE.ExtrudeGeometry for printable 3MF solids.
 */
import * as THREE from 'three';
import type { MultiPolygon, Ring } from '../types';
import { shapeToPolygon, multiPolygonToShapes } from './clipper-utils';
import Module from 'manifold-3d';
import type { ManifoldToplevel, Mesh } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

let manifoldPromise: Promise<ManifoldToplevel> | null = null;
let manifoldMod: ManifoldToplevel | null = null;

export async function ensureManifoldReady(): Promise<ManifoldToplevel> {
  if (manifoldMod) return manifoldMod;
  if (!manifoldPromise) {
    manifoldPromise = (async () => {
      const mod = await Module({
        locateFile: () => wasmUrl,
      });
      mod.setup();
      manifoldMod = mod;
      return mod;
    })();
  }
  return manifoldPromise;
}

/** Drop duplicate closing point if present; Manifold wants closed rings but duplicates confuse it. */
function cleanRing(ring: Ring): [number, number][] {
  if (ring.length < 3) return [];
  const pts: [number, number][] = ring.map(p => [p[0], p[1]]);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) pts.pop();
  return pts.length >= 3 ? pts : [];
}

/**
 * Flatten MultiPolygon into Manifold contours (outers + holes).
 * FillRule NonZero matches Clipper NonZero winding (outer vs hole).
 */
export function multiPolygonToManifoldContours(multiPoly: MultiPolygon): [number, number][][] {
  const contours: [number, number][][] = [];
  for (const poly of multiPoly) {
    if (!poly?.length) continue;
    for (const ring of poly) {
      const cleaned = cleanRing(ring);
      if (cleaned.length >= 3) contours.push(cleaned);
    }
  }
  return contours;
}

function meshToBufferGeometry(mesh: Mesh, skipDegenerateIndices = true): THREE.BufferGeometry {
  try {
    mesh.merge();
  } catch {
    // ignore if merge map empty / not applicable
  }

  const numProp = mesh.numProp || 3;
  const numVert = mesh.vertProperties.length / numProp;
  const positions = new Float32Array(numVert * 3);
  for (let i = 0; i < numVert; i++) {
    positions[i * 3] = mesh.vertProperties[i * numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
  }

  const src = mesh.triVerts;
  const filtered: number[] = [];
  for (let i = 0; i + 2 < src.length; i += 3) {
    const a = src[i];
    const b = src[i + 1];
    const c = src[i + 2];
    if (skipDegenerateIndices && (a === b || b === c || a === c)) continue;
    filtered.push(a, b, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(filtered), 1));
  geo.computeVertexNormals();
  return geo;
}

function bufferGeometryToManifoldMesh(geo: THREE.BufferGeometry, mod: ManifoldToplevel): Mesh | null {
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  if (!pos || !index || pos.count === 0) return null;

  const vertProperties = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    vertProperties[i * 3] = pos.getX(i);
    vertProperties[i * 3 + 1] = pos.getY(i);
    vertProperties[i * 3 + 2] = pos.getZ(i);
  }
  const triVerts = new Uint32Array(index.array.length);
  triVerts.set(index.array as Uint32Array);

  return new mod.Mesh({ numProp: 3, vertProperties, triVerts });
}

/** Round-trip through Manifold.ofMesh to repair welded / near-coincident topology. */
export function remanifoldBufferGeometry(
  geo: THREE.BufferGeometry,
  mod: ManifoldToplevel | null = manifoldMod,
): THREE.BufferGeometry | null {
  if (!mod) return null;
  const inputMesh = bufferGeometryToManifoldMesh(geo, mod);
  if (!inputMesh) return null;

  try {
    inputMesh.merge();
  } catch {
    // best effort
  }

  const manifold = mod.Manifold.ofMesh(inputMesh);
  const status = manifold.status();
  if (status !== 'NoError') {
    manifold.delete();
    return null;
  }
  const outMesh = manifold.getMesh();
  manifold.delete();
  return meshToBufferGeometry(outMesh, true);
}

export type RobustExtrudeResult =
  | { ok: true; geometry: THREE.BufferGeometry }
  | { ok: false; stage: 'extrude'; message: string; manifoldStatus?: string };

/**
 * Extrude a MultiPolygon to a manifold BufferGeometry.
 * Falls back to THREE.ExtrudeGeometry on failure (fast mode only).
 */
export function extrudeMultiPolygonManifold(
  multiPoly: MultiPolygon,
  depth: number,
  mod: ManifoldToplevel | null = manifoldMod
): THREE.BufferGeometry | null {
  const result = extrudeMultiPolygonRobust(multiPoly, depth, mod, { allowThreeFallback: true });
  return result.ok ? result.geometry : null;
}

/**
 * Manifold-only extrusion for robust export. No ExtrudeGeometry fallback.
 */
export function extrudeMultiPolygonRobust(
  multiPoly: MultiPolygon,
  depth: number,
  mod: ManifoldToplevel | null = manifoldMod,
  opts?: { allowThreeFallback?: boolean },
): RobustExtrudeResult | { ok: true; geometry: THREE.BufferGeometry } {
  if (depth <= 0 || !multiPoly.length) {
    return { ok: false, stage: 'extrude', message: 'Empty or zero-depth polygon' };
  }

  if (!mod) {
    if (opts?.allowThreeFallback) {
      const shapes = multiPolygonToShapes(multiPoly);
      if (shapes.length === 0) {
        return { ok: false, stage: 'extrude', message: 'Manifold not initialized' };
      }
      const geom = new THREE.ExtrudeGeometry(shapes, {
        depth,
        curveSegments: 32,
        bevelEnabled: false,
      });
      return { ok: true, geometry: geom };
    }
    return { ok: false, stage: 'extrude', message: 'Manifold engine not initialized' };
  }

  try {
    const contours = multiPolygonToManifoldContours(multiPoly);
    if (contours.length === 0) {
      return { ok: false, stage: 'extrude', message: 'No valid contours after normalization' };
    }

    const cs = new mod.CrossSection(contours, 'NonZero');
    if (cs.isEmpty()) {
      cs.delete();
      return { ok: false, stage: 'extrude', message: 'CrossSection empty' };
    }

    const solid = cs.extrude(depth);
    cs.delete();

    const status = solid.status();
    if (status !== 'NoError') {
      solid.delete();
      return { ok: false, stage: 'extrude', message: `Manifold extrude failed: ${status}`, manifoldStatus: status };
    }

    const mesh = solid.getMesh();
    solid.delete();
    return { ok: true, geometry: meshToBufferGeometry(mesh, true) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, stage: 'extrude', message: msg };
  }
}

/** Extrude THREE.Shape[] via Manifold (converts through shapeToPolygon). */
export function extrudeShapesManifold(
  shapes: THREE.Shape[],
  depth: number,
  mod: ManifoldToplevel | null = manifoldMod
): THREE.BufferGeometry | null {
  if (depth <= 0 || shapes.length === 0) return null;
  const multi: MultiPolygon = [];
  for (const shape of shapes) {
    multi.push(shapeToPolygon(shape));
  }
  return extrudeMultiPolygonManifold(multi, depth, mod);
}
