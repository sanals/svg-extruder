import { buildMultiPlate3MF } from './generic-3mf-exporter';
import type { ShapeItem, MultiPolygon, Ring, PrintItem, PrintPlate } from '../types';
import { shapeToPolygon, performClipperBoolean } from '../lib/clipper-utils';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import * as ClipperLib from 'clipper-lib';
import { ensureManifoldReady, extrudeMultiPolygonManifold } from './manifold-extrude';
import {
  EXPORT_YIELD_EVERY_SHAPES,
  throwIfExportAborted,
  yieldExportThread,
} from './export-constants';

export { ExportAbortError, EXPORT_VERTEX_SOFT_LIMIT, EXPORT_VERTEX_HARD_LIMIT } from './export-constants';

const yieldThread = yieldExportThread;

/** Reverse triangle winding (needed after odd number of axis reflections). */
export function flipTriangleWinding(geo: THREE.BufferGeometry): void {
  const index = geo.getIndex();
  if (index) {
    const arr = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    index.needsUpdate = true;
    return;
  }
  const pos = geo.getAttribute('position');
  if (!pos) return;
  const arr = pos.array as Float32Array;
  for (let i = 0; i < arr.length; i += 9) {
    // swap vertex 1 and 2 of each triangle
    for (let c = 0; c < 3; c++) {
      const a = i + 3 + c;
      const b = i + 6 + c;
      const tmp = arr[a];
      arr[a] = arr[b];
      arr[b] = tmp;
    }
  }
  pos.needsUpdate = true;
}

/** Weld verts + normals for slicer-friendly solids. Never bevel here. Keeps index when present. */
export function hardenExportGeometry(
  geo: THREE.BufferGeometry,
  /** Prefer ~1e-3 after mm-scale; ~1e-4 in raw model units. */
  weldTolerance: number = 1e-3
): THREE.BufferGeometry {
  const g = BufferGeometryUtils.mergeVertices(geo, weldTolerance);
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return g;
}

/** Put former top face on the bed (z=0) without mirroring XY. */
export function flipFaceDown(geo: THREE.BufferGeometry): void {
  geo.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1));
  geo.computeBoundingBox();
  const minZ = geo.boundingBox!.min.z;
  geo.translate(0, 0, -minZ);
}

export function areExtrusionHeightsUniform(
  shapeIds: string[],
  meshDepths: Record<string, number>
): boolean {
  if (shapeIds.length === 0) return false;
  const first = meshDepths[shapeIds[0]] ?? 0;
  return shapeIds.every(id => (meshDepths[id] ?? 0) === first);
}

function extrudeMultiPolyForExport(multiPoly: MultiPolygon, totalDepth: number): THREE.BufferGeometry | null {
  if (totalDepth <= 0 || multiPoly.length === 0) {
    console.warn('Skipping zero-depth flat for export (open surface is not printable)');
    return null;
  }
  return extrudeMultiPolygonManifold(multiPoly, totalDepth);
}

function unionMultiPolygons(multiPolys: MultiPolygon[]): MultiPolygon {
  if (multiPolys.length === 0) return [];
  if (multiPolys.length === 1) return multiPolys[0];
  try {
    return performClipperBoolean(
      multiPolys[0],
      multiPolys.slice(1),
      ClipperLib.ClipType.ctUnion
    );
  } catch (err) {
    console.error('Clipper union failed during export', err);
    throw err;
  }
}

function concatGeometries(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geoms.length === 1) return geoms[0];
  const merged = BufferGeometryUtils.mergeGeometries(geoms, false);
  if (!merged) {
    console.warn('mergeGeometries failed; returning first geometry');
    return geoms[0];
  }
  return hardenExportGeometry(merged);
}

type ClippedPart = {
  multiPoly: MultiPolygon;
  colorHex: string;
  totalDepth: number;
  id: string;
};

export async function sliceAndExport(
  shapesWithColors: ShapeItem[],
  buildPlateSize: number,
  gridSize: string,
  printerModel: string,
  mergeByColor: boolean,
  customScale: number,
  clearance: number,
  scaleZProportionally: boolean,
  meshDepths: Record<string, number>,
  _sealGaps: boolean,
  meshColorOverrides: Record<string, string>,
  backingDepth: number,
  onProgress: (msg: string) => void,
  printFaceDown: boolean = false,
  faceColorDepthMm: number = 0,
  baseColorHex: string = 'ffffff',
  signal?: AbortSignal
): Promise<Blob | null> {
  // _sealGaps is preview-only (viewport bevel); export never enables ExtrudeGeometry bevel.
  void _sealGaps;

  if (shapesWithColors.length === 0) return null;

  const heightsUniform = areExtrusionHeightsUniform(
    shapesWithColors.map(s => s.id),
    meshDepths
  );
  const doFlipFaceDown = printFaceDown && heightsUniform;

  const baseHexNorm = baseColorHex.replace('#', '').toLowerCase();
  const baseColorPrint = `#${baseHexNorm}`;
  const faceColorEnabled = faceColorDepthMm > 0;
  const faceColorMmClamped = faceColorEnabled
    ? Math.min(1, Math.max(0.02, faceColorDepthMm))
    : 0;

  onProgress("Initializing manifold engine...");
  throwIfExportAborted(signal);
  await ensureManifoldReady();
  await yieldThread();

  onProgress("Analyzing model dimensions...");
  throwIfExportAborted(signal);
  await yieldThread();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  shapesWithColors.forEach(item => {
    item.shapes.forEach(shape => {
      const pts = shape.getPoints();
      pts.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    });
  });

  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;

  const currentPhysicalWidth = rawWidth * 0.1 * customScale;
  const currentPhysicalHeight = rawHeight * 0.1 * customScale;

  const SAFE_MARGIN_PERCENT = 200 / 256;
  const usablePlateSize = buildPlateSize * SAFE_MARGIN_PERCENT;

  let gridCols = 1;
  let gridRows = 1;

  if (gridSize === 'auto') {
    gridCols = Math.ceil(currentPhysicalWidth / usablePlateSize);
    gridRows = Math.ceil(currentPhysicalHeight / usablePlateSize);

    if (gridCols > 2) gridCols = 2;
    if (gridRows > 2) gridRows = 2;
  } else {
    const [colsStr, rowsStr] = gridSize.split("x");
    gridCols = parseInt(colsStr, 10);
    gridRows = parseInt(rowsStr, 10);
  }

  const targetMaxWidth = usablePlateSize * gridCols;
  const targetMaxHeight = usablePlateSize * gridRows;

  const scaleX = targetMaxWidth / (rawWidth * 0.1);
  const scaleY = targetMaxHeight / (rawHeight * 0.1);
  let scaleFactor = Math.min(scaleX, scaleY);

  if (gridSize === 'auto') {
    scaleFactor = Math.min(customScale, scaleFactor);
  }

  const finalPhysicalWidth = rawWidth * 0.1 * scaleFactor;
  const finalPhysicalHeight = rawHeight * 0.1 * scaleFactor;

  const gridPhysicalWidth = gridCols * buildPlateSize;
  const gridPhysicalHeight = gridRows * buildPlateSize;
  const offsetX = (gridPhysicalWidth - finalPhysicalWidth) / 2;
  const offsetY = (gridPhysicalHeight - finalPhysicalHeight) / 2;

  const cellSvgWidth = buildPlateSize / (0.1 * scaleFactor);
  const cellSvgHeight = buildPlateSize / (0.1 * scaleFactor);

  const svgOffsetX = offsetX / (0.1 * scaleFactor);
  const svgOffsetY = offsetY / (0.1 * scaleFactor);

  const plates: PrintPlate[] = [];
  const clipperScale = 10000;

  const parsePolyNode = (node: any, multiPoly: MultiPolygon) => {
    if (!node.IsHole()) {
      const ring: Ring = node.Contour().map((p: any) => [p.X / clipperScale, p.Y / clipperScale]);
      if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
      if (ring.length >= 4) {
        const poly = [ring];
        node.Childs().forEach((child: any) => {
          const holeRing: Ring = child.Contour().map((p: any) => [p.X / clipperScale, p.Y / clipperScale]);
          if (holeRing.length > 0 && (holeRing[0][0] !== holeRing[holeRing.length - 1][0] || holeRing[0][1] !== holeRing[holeRing.length - 1][1])) holeRing.push([...holeRing[0]]);
          if (holeRing.length >= 4) poly.push(holeRing);
          child.Childs().forEach((nestedNode: any) => parsePolyNode(nestedNode, multiPoly));
        });
        multiPoly.push(poly);
      }
    }
  };

  const applyExportScale = (geom: THREE.BufferGeometry) => {
    const matrix = new THREE.Matrix4().makeScale(
      0.1 * scaleFactor,
      -0.1 * scaleFactor,
      scaleZProportionally ? 0.1 * scaleFactor : 0.1
    );
    geom.applyMatrix4(matrix);
  };

  /** Model-unit Z scale applied in applyExportScale (physical_mm = depth * zScale). */
  const zScale = scaleZProportionally ? 0.1 * scaleFactor : 0.1;
  const faceDepthModel = faceColorEnabled ? faceColorMmClamped / zScale : 0;

  /**
   * Scale to mm, optional face-down flip, fix winding for odd reflections, weld in mm-space.
   * Y scale is always negative (1 reflection). Face-down adds a Z reflection → even → no winding fix.
   * skipFaceDown: face-only stacks that are already bed-ready (color at z=0).
   */
  const finalizeScaledGeom = (
    geom: THREE.BufferGeometry,
    opts?: { skipFaceDown?: boolean }
  ): THREE.BufferGeometry => {
    applyExportScale(geom);
    if (doFlipFaceDown && !opts?.skipFaceDown) {
      flipFaceDown(geom);
    } else {
      // Face-up, or face-only already laid out bed-ready: only Y reflection → fix winding
      flipTriangleWinding(geom);
    }
    return hardenExportGeometry(geom, 1e-3);
  };

  const buildScaledSolidAtZ = (
    multiPoly: MultiPolygon,
    depth: number,
    zOffsetModel: number = 0,
    opts?: { skipFaceDown?: boolean }
  ): THREE.BufferGeometry | null => {
    const geom = extrudeMultiPolyForExport(multiPoly, depth);
    if (!geom) return null;
    if (zOffsetModel !== 0) geom.translate(0, 0, zOffsetModel);
    return finalizeScaledGeom(geom, opts);
  };

  const buildScaledSolid = (multiPoly: MultiPolygon, totalDepth: number): THREE.BufferGeometry | null => {
    return buildScaledSolidAtZ(multiPoly, totalDepth, 0);
  };

  /**
   * One shared base + per-color thin face shells (no overlapping base bodies).
   * When printFaceDown: build bed-ready Z (face at 0, body above) and skip per-mesh flipFaceDown,
   * which would otherwise nest both meshes at z=0 and cause z-fighting.
   */
  const buildFaceOnlyPlateItems = (parts: ClippedPart[]): PrintItem[] => {
    if (parts.length === 0 || faceDepthModel <= 0) return [];

    const maxDepth = Math.max(...parts.map(p => p.totalDepth));
    const faceD = Math.min(faceDepthModel, maxDepth);
    const bodyD = maxDepth - faceD;
    const items: PrintItem[] = [];
    // Bed-ready layout when face-down; otherwise color on top of body
    const bedReady = doFlipFaceDown;
    const faceOnlyOpts = bedReady ? { skipFaceDown: true } : undefined;
    const bodyZ = bedReady ? faceD : 0;
    const faceZ = bedReady ? 0 : bodyD;

    if (bodyD > 1e-8) {
      try {
        const united = unionMultiPolygons(parts.map(p => p.multiPoly));
        if (united.length > 0) {
          const bodyGeom = buildScaledSolidAtZ(united, bodyD, bodyZ, faceOnlyOpts);
          if (bodyGeom) {
            items.push({
              id: `base_${Math.random().toString(36).substring(7)}`,
              geometry: bodyGeom,
              colorHex: baseColorPrint,
              name: 'FaceOnly_Base',
            });
          }
        }
      } catch (err) {
        console.error('Failed to union shared base silhouette', err);
        // Fallback: per-part bodies only if union fails (worse, but better than empty)
        for (const part of parts) {
          const partFace = Math.min(faceDepthModel, part.totalDepth);
          const partBody = part.totalDepth - partFace;
          if (partBody <= 1e-8 || part.multiPoly.length === 0) continue;
          const partBodyZ = bedReady ? partFace : 0;
          const g = buildScaledSolidAtZ(part.multiPoly, partBody, partBodyZ, faceOnlyOpts);
          if (g) {
            items.push({
              id: `base_${part.id}`,
              geometry: g,
              colorHex: baseColorPrint,
              name: `FaceOnly_Base_${part.id}`,
            });
          }
        }
      }
    }

    const colorGroups: Record<string, ClippedPart[]> = {};
    parts.forEach(part => {
      if (!colorGroups[part.colorHex]) colorGroups[part.colorHex] = [];
      colorGroups[part.colorHex].push(part);
    });

    for (const [hex, group] of Object.entries(colorGroups)) {
      let faceGeom: THREE.BufferGeometry | null = null;
      try {
        const united = unionMultiPolygons(group.map(p => p.multiPoly));
        if (united.length > 0) {
          faceGeom = buildScaledSolidAtZ(united, faceD, faceZ, faceOnlyOpts);
        }
      } catch (err) {
        console.error('Failed to union face color group', hex, err);
      }

      if (!faceGeom) {
        const geoms: THREE.BufferGeometry[] = [];
        for (const part of group) {
          if (part.multiPoly.length === 0) continue;
          const partFace = Math.min(faceDepthModel, part.totalDepth);
          const partBody = part.totalDepth - partFace;
          const partFaceZ = bedReady ? 0 : partBody;
          const g = buildScaledSolidAtZ(part.multiPoly, partFace, partFaceZ, faceOnlyOpts);
          if (g) geoms.push(g);
        }
        if (geoms.length > 0) faceGeom = concatGeometries(geoms);
      }

      if (faceGeom) {
        items.push({
          id: `face_${Math.random().toString(36).substring(7)}`,
          geometry: faceGeom,
          colorHex: hex,
          name: `FaceOnly_${hex}`,
        });
      }
    }

    return items;
  };

  onProgress("Applying assembly clearance...");
  throwIfExportAborted(signal);
  await yieldThread();

  const offsetShapes: Record<string, MultiPolygon> = {};
  const offsetAmountInClipper = clearance > 0 ? -(clearance / (0.1 * scaleFactor)) * clipperScale : 0;

  for (let shapeIdx = 0; shapeIdx < shapesWithColors.length; shapeIdx++) {
    const item = shapesWithColors[shapeIdx];
    if (shapeIdx > 0 && shapeIdx % EXPORT_YIELD_EVERY_SHAPES === 0) {
      onProgress(`Applying assembly clearance (${shapeIdx}/${shapesWithColors.length})...`);
      throwIfExportAborted(signal);
      await yieldThread();
    }

    if (offsetAmountInClipper === 0) {
       const multiPoly: MultiPolygon = [];
       item.shapes.forEach(shape => multiPoly.push(shapeToPolygon(shape)));
       offsetShapes[item.id] = multiPoly;
    } else {
       const co = new ClipperLib.ClipperOffset();
       item.shapes.forEach(shape => {
         const polygon = shapeToPolygon(shape);
         for (let i = 0; i < polygon.length; i++) {
           const ring = polygon[i];
           if (ring.length < 3) continue;
           const path = ring.map(p => ({ X: Math.round(p[0] * clipperScale), Y: Math.round(p[1] * clipperScale) }));
           const isOuter = (i === 0);
           const orient = ClipperLib.Clipper.Orientation(path);
           if (isOuter !== orient) path.reverse();
           // @ts-ignore
           co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
         }
       });

       // @ts-ignore
       const offsettedTree = new ClipperLib.PolyTree();
       // @ts-ignore
       co.Execute(offsettedTree, offsetAmountInClipper);

       const resultMultiPoly: MultiPolygon = [];
       // @ts-ignore
       offsettedTree.Childs().forEach((child: any) => parsePolyNode(child, resultMultiPoly));
       offsetShapes[item.id] = resultMultiPoly;
    }
  }

  const totalQuadrants = gridRows * gridCols;
  let quadrantIndex = 0;

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      quadrantIndex++;
      onProgress(`Slicing quadrant ${quadrantIndex} of ${totalQuadrants}...`);
      throwIfExportAborted(signal);
      await yieldThread();

      const rectMinX = minX - svgOffsetX + c * cellSvgWidth;
      const rectMaxX = minX - svgOffsetX + (c + 1) * cellSvgWidth;
      const rectMinY = minY - svgOffsetY + r * cellSvgHeight;
      const rectMaxY = minY - svgOffsetY + (r + 1) * cellSvgHeight;

      const clipPath = [
        { X: Math.round(rectMinX * clipperScale), Y: Math.round(rectMinY * clipperScale) },
        { X: Math.round(rectMaxX * clipperScale), Y: Math.round(rectMinY * clipperScale) },
        { X: Math.round(rectMaxX * clipperScale), Y: Math.round(rectMaxY * clipperScale) },
        { X: Math.round(rectMinX * clipperScale), Y: Math.round(rectMaxY * clipperScale) }
      ];

      ClipperLib.Clipper.Orientation(clipPath);

      const clippedParts: ClippedPart[] = [];

      for (let shapeIdx = 0; shapeIdx < shapesWithColors.length; shapeIdx++) {
        const item = shapesWithColors[shapeIdx];
        if (shapeIdx > 0 && shapeIdx % EXPORT_YIELD_EVERY_SHAPES === 0) {
          onProgress(`Clipping quadrant ${quadrantIndex}/${totalQuadrants} (${shapeIdx}/${shapesWithColors.length} shapes)...`);
          throwIfExportAborted(signal);
          await yieldThread();
        }

        const clipper = new ClipperLib.Clipper();
        // @ts-ignore
        clipper.AddPath(clipPath, ClipperLib.PolyType.ptClip, true);

        const multiPoly = offsetShapes[item.id];
        multiPoly.forEach(polygon => {
          for (let i = 0; i < polygon.length; i++) {
            const ring = polygon[i];
            if (ring.length < 3) continue;
            const path = ring.map(p => ({ X: Math.round(p[0] * clipperScale), Y: Math.round(p[1] * clipperScale) }));
            const isOuter = (i === 0);
            const orient = ClipperLib.Clipper.Orientation(path);
            if (isOuter !== orient) path.reverse();
            // @ts-ignore
            clipper.AddPath(path, ClipperLib.PolyType.ptSubject, true);
          }
        });

        // @ts-ignore
        const solutionTree = new ClipperLib.PolyTree();
        // @ts-ignore
        clipper.Execute(ClipperLib.ClipType.ctIntersection, solutionTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

        const resultMultiPoly: MultiPolygon = [];
        // @ts-ignore
        solutionTree.Childs().forEach((child: any) => parsePolyNode(child, resultMultiPoly));

        if (resultMultiPoly.length > 0) {
          const depth = meshDepths[item.id] ?? 0;
          const totalDepth = depth + backingDepth;
          const overriddenHex = meshColorOverrides[item.id];
          const hex = overriddenHex ?? item.colorHex;
          clippedParts.push({
            multiPoly: resultMultiPoly,
            colorHex: `#${hex}`,
            totalDepth,
            id: item.id,
          });
        }
      }

      const itemsForPlate: PrintItem[] = [];

      if (faceColorEnabled) {
        onProgress(`Building face shells (plate ${quadrantIndex}/${totalQuadrants})...`);
        throwIfExportAborted(signal);
        await yieldThread();
        itemsForPlate.push(...buildFaceOnlyPlateItems(clippedParts));
      } else if (mergeByColor) {
        onProgress(`Building solids by color (plate ${quadrantIndex}/${totalQuadrants})...`);
        throwIfExportAborted(signal);
        await yieldThread();

        const colorGroups: Record<string, ClippedPart[]> = {};
        clippedParts.forEach(part => {
          if (!colorGroups[part.colorHex]) colorGroups[part.colorHex] = [];
          colorGroups[part.colorHex].push(part);
        });

        const colorEntries = Object.entries(colorGroups);
        for (let ci = 0; ci < colorEntries.length; ci++) {
          const [hex, parts] = colorEntries[ci];
          onProgress(`Extruding color ${ci + 1}/${colorEntries.length} (plate ${quadrantIndex})...`);
          throwIfExportAborted(signal);
          await yieldThread();

          const maxDepth = Math.max(...parts.map(p => p.totalDepth));
          let geom: THREE.BufferGeometry | null = null;

          try {
            const united = unionMultiPolygons(parts.map(p => p.multiPoly));
            if (united.length > 0) {
              geom = buildScaledSolid(united, maxDepth);
            }
          } catch (err) {
            console.error("Failed to union geometries for color", hex, err);
          }

          if (!geom) {
            const geoms: THREE.BufferGeometry[] = [];
            for (const part of parts) {
              if (part.multiPoly.length === 0) continue;
              const g = buildScaledSolid(part.multiPoly, part.totalDepth);
              if (g) geoms.push(g);
            }
            if (geoms.length === 0) continue;
            geom = concatGeometries(geoms);
          }

          itemsForPlate.push({
            id: Math.random().toString(36).substring(7),
            geometry: geom,
            colorHex: hex,
            name: `ColorGroup_${hex}`,
          });
        }
      } else {
        for (const part of clippedParts) {
          if (part.multiPoly.length === 0) continue;
          const geom = buildScaledSolid(part.multiPoly, part.totalDepth);
          if (!geom) continue;
          itemsForPlate.push({
            id: part.id,
            geometry: geom,
            colorHex: part.colorHex,
            name: `Part_${part.id}`,
          });
        }
      }

      if (itemsForPlate.length > 0) {
        plates.push({
          name: `Plate_R${r + 1}_C${c + 1}`, items: itemsForPlate, width: buildPlateSize, height: buildPlateSize
        });
      }
    }
  }

  onProgress("Assembling 3MF archive...");
  throwIfExportAborted(signal);
  await yieldThread();

  if (plates.length > 0) {
    return await buildMultiPlate3MF(plates, {
      printerModel,
      groupIntoOneObject: mergeByColor,
      onProgress,
      signal,
    });
  }
  return null;
}

/**
 * Build printable STL from shape data using the same manifold extrusion as 3MF.
 * Does NOT dump the preview scene (ExtrudeGeometry + Seal Gaps bevel), which is non-manifold.
 *
 * @param customScalePercent UI scale (100 = 100%)
 */
export async function exportShapesToSTL(
  shapesWithColors: ShapeItem[],
  customScalePercent: number,
  scaleZProportionally: boolean,
  mergeBeforeExport: boolean,
  meshDepths: Record<string, number>,
  meshColorOverrides: Record<string, string>,
  backingDepth: number,
  printFaceDown: boolean = false,
  onProgress?: (msg: string) => void,
): Promise<void> {
  if (shapesWithColors.length === 0) {
    throw new Error('No shapes to export');
  }

  const progress = onProgress ?? (() => {});
  progress('Initializing manifold engine...');
  await ensureManifoldReady();
  await yieldThread();

  const customScale = customScalePercent / 100.0;
  const xyScale = 0.1 * customScale;
  const zScale = scaleZProportionally ? xyScale : 0.1;

  const heightsUniform = areExtrusionHeightsUniform(
    shapesWithColors.map(s => s.id),
    meshDepths,
  );
  const doFlipFaceDown = printFaceDown && heightsUniform;

  const finalizeGeom = (geom: THREE.BufferGeometry): THREE.BufferGeometry => {
    geom.applyMatrix4(new THREE.Matrix4().makeScale(xyScale, -xyScale, zScale));
    if (doFlipFaceDown) {
      flipFaceDown(geom);
    } else {
      flipTriangleWinding(geom);
    }
    return hardenExportGeometry(geom, 1e-3);
  };

  const buildSolid = (multiPoly: MultiPolygon, totalDepth: number): THREE.BufferGeometry | null => {
    const geom = extrudeMultiPolyForExport(multiPoly, totalDepth);
    if (!geom) return null;
    return finalizeGeom(geom);
  };

  type StlPart = { multiPoly: MultiPolygon; totalDepth: number; id: string };
  const parts: StlPart[] = [];

  progress('Preparing shapes...');
  await yieldThread();

  for (const item of shapesWithColors) {
    const multiPoly: MultiPolygon = item.shapes.map(shape => shapeToPolygon(shape));
    if (multiPoly.length === 0) continue;
    const depth = meshDepths[item.id] ?? 0;
    const totalDepth = depth + backingDepth;
    if (totalDepth <= 0) continue;
    parts.push({ multiPoly, totalDepth, id: item.id });
  }

  if (parts.length === 0) {
    throw new Error('No extrudable parts (all zero depth?)');
  }

  const geometries: THREE.BufferGeometry[] = [];

  if (mergeBeforeExport) {
    progress('Uniting polygons for single STL mesh...');
    await yieldThread();
    const maxDepth = Math.max(...parts.map(p => p.totalDepth));
    let geom: THREE.BufferGeometry | null = null;
    try {
      const united = unionMultiPolygons(parts.map(p => p.multiPoly));
      if (united.length > 0) {
        geom = buildSolid(united, maxDepth);
      }
    } catch (err) {
      console.error('STL union failed; falling back to per-part solids', err);
    }
    if (!geom) {
      const geoms: THREE.BufferGeometry[] = [];
      for (const part of parts) {
        const g = buildSolid(part.multiPoly, part.totalDepth);
        if (g) geoms.push(g);
      }
      if (geoms.length === 0) throw new Error('Failed to build STL geometry');
      geom = concatGeometries(geoms);
    }
    geometries.push(geom);
  } else {
    progress('Building manifold solids...');
    await yieldThread();
    for (let i = 0; i < parts.length; i++) {
      if (i % 8 === 0) {
        progress(`Building solid ${i + 1}/${parts.length}...`);
        await yieldThread();
      }
      const g = buildSolid(parts[i].multiPoly, parts[i].totalDepth);
      if (g) geometries.push(g);
    }
  }

  if (geometries.length === 0) {
    throw new Error('Failed to build STL geometry');
  }

  progress('Writing STL file...');
  await yieldThread();

  const group = new THREE.Group();
  for (const geom of geometries) {
    group.add(new THREE.Mesh(geom, new THREE.MeshBasicMaterial()));
  }

  const exporter = new STLExporter();
  const result = exporter.parse(group, { binary: true });
  const blob = new Blob([result], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = url;
  link.download = 'extruded_model.stl';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** @deprecated Preview-scene STL dump (non-manifold). Use exportShapesToSTL. */
export function exportToSTL(
  scene: THREE.Object3D,
  customScale: number,
  scaleZProportionally: boolean,
  mergeBeforeExport: boolean,
  printFaceDown: boolean = false
) {
  const exportScene = scene.clone();

  exportScene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.userData.originalColorHex !== undefined) {
        mesh.material = (mesh.material as THREE.Material).clone();
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color = new THREE.Color("#" + mesh.userData.originalColorHex);
        mat.emissive = new THREE.Color(0x000000);
        mat.emissiveIntensity = 0;
      }
      mesh.position.z = 0;
    }
  });

  let finalExportObject: THREE.Object3D = exportScene;

  const scaleFactor = customScale / 100.0;
  const zScale = scaleZProportionally ? scaleFactor : 1.0;
  exportScene.scale.set(scaleFactor, scaleFactor, zScale);
  exportScene.updateMatrixWorld(true);

  if (mergeBeforeExport) {
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    let meshesParent: THREE.Object3D | null = null;

    exportScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (!meshesParent) meshesParent = mesh.parent;

        mesh.updateMatrix();
        let geom = mesh.geometry.clone();
        geom = hardenExportGeometry(geom);
        geom.applyMatrix4(mesh.matrix);
        geometries.push(geom);
        materials.push(mesh.material as THREE.Material);
      }
    });

    if (geometries.length > 0 && meshesParent) {
      try {
        let mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, true);
        if (printFaceDown) {
          flipFaceDown(mergedGeometry);
          flipTriangleWinding(mergedGeometry);
        }
        const hardened = hardenExportGeometry(mergedGeometry, 1e-3);
        const mergedMesh = new THREE.Mesh(hardened, materials);

        const parent = meshesParent as THREE.Object3D;
        parent.clear();
        parent.add(mergedMesh);

        finalExportObject = exportScene;
      } catch (e) {
        console.error("Failed to merge geometries:", e);
        throw e;
      }
    }
  } else {
    exportScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        let geom = mesh.geometry.clone();
        if (printFaceDown) {
          flipFaceDown(geom);
          flipTriangleWinding(geom);
        }
        mesh.geometry = hardenExportGeometry(geom, 1e-3);
      }
    });
  }

  const exporter = new STLExporter();
  const result = exporter.parse(finalExportObject, { binary: true });
  const blob = new Blob([result], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = url;
  link.download = 'extruded_model.stl';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
