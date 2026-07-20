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

function meshToBufferGeometry(mesh: Mesh): THREE.BufferGeometry {
  // Apply GL merge map so shared positions become shared indices
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

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.triVerts.slice(), 1));
  geo.computeVertexNormals();
  return geo;
}

function extrudeWithThreeFallback(shapes: THREE.Shape[], depth: number): THREE.BufferGeometry | null {
  if (depth <= 0 || shapes.length === 0) return null;
  return new THREE.ExtrudeGeometry(shapes, {
    depth,
    curveSegments: 32,
    bevelEnabled: false,
  });
}

/**
 * Extrude a MultiPolygon to a manifold BufferGeometry.
 * Falls back to THREE.ExtrudeGeometry on failure.
 */
export function extrudeMultiPolygonManifold(
  multiPoly: MultiPolygon,
  depth: number,
  mod: ManifoldToplevel | null = manifoldMod
): THREE.BufferGeometry | null {
  if (depth <= 0 || !multiPoly.length) return null;

  const shapesFallback = () => extrudeWithThreeFallback(multiPolygonToShapes(multiPoly), depth);

  if (!mod) {
    console.warn('Manifold not initialized; using ExtrudeGeometry fallback');
    return shapesFallback();
  }

  try {
    const contours = multiPolygonToManifoldContours(multiPoly);
    if (contours.length === 0) return null;

    const cs = new mod.CrossSection(contours, 'NonZero');
    if (cs.isEmpty()) {
      cs.delete();
      return shapesFallback();
    }

    const solid = cs.extrude(depth);
    cs.delete();

    const status = solid.status();
    if (status !== 'NoError') {
      solid.delete();
      console.warn('Manifold extrude status', status);
      return shapesFallback();
    }

    const mesh = solid.getMesh();
    solid.delete();
    return meshToBufferGeometry(mesh);
  } catch (err) {
    console.warn('Manifold extrude failed; ExtrudeGeometry fallback', err);
    return shapesFallback();
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
