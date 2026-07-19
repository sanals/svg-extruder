import { buildMultiPlate3MF } from './generic-3mf-exporter';
import type { ShapeItem, MultiPolygon, Ring, PrintItem, PrintPlate } from '../types';
import { shapeToPolygon, multiPolygonToShapes, performClipperBoolean } from '../lib/clipper-utils';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import * as ClipperLib from 'clipper-lib';

const yieldThread = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

/** Weld verts + normals for slicer-friendly solids. Never bevel here. */
export function hardenExportGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geo;
  if (g.index) {
    g = g.toNonIndexed();
  }
  g = BufferGeometryUtils.mergeVertices(g, 1e-4);
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

function extrudeForExport(shapes: THREE.Shape[], totalDepth: number): THREE.BufferGeometry | null {
  if (totalDepth <= 0) {
    console.warn('Skipping zero-depth flat for export (open surface is not printable)');
    return null;
  }
  return new THREE.ExtrudeGeometry(shapes, {
    depth: totalDepth,
    curveSegments: 32,
    bevelEnabled: false,
  });
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
  let totalPositions = 0;
  geoms.forEach(g => {
    totalPositions += g.getAttribute('position').count;
  });
  const mergedPos = new Float32Array(totalPositions * 3);
  let offset = 0;
  geoms.forEach(g => {
    const pos = g.getAttribute('position');
    mergedPos.set(pos.array as Float32Array, offset);
    offset += pos.array.length;
  });
  const mergedGeo = new THREE.BufferGeometry();
  mergedGeo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
  return hardenExportGeometry(mergedGeo);
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
  printFaceDown: boolean = false
): Promise<Blob | null> {
  // _sealGaps is preview-only (viewport bevel); export never enables ExtrudeGeometry bevel.
  void _sealGaps;

  if (shapesWithColors.length === 0) return null;

  const heightsUniform = areExtrusionHeightsUniform(
    shapesWithColors.map(s => s.id),
    meshDepths
  );
  const doFlipFaceDown = printFaceDown && heightsUniform;

  onProgress("Analyzing model dimensions...");
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

  const buildScaledSolid = (shapes: THREE.Shape[], totalDepth: number): THREE.BufferGeometry | null => {
    const geom = extrudeForExport(shapes, totalDepth);
    if (!geom) return null;
    applyExportScale(geom);
    if (doFlipFaceDown) flipFaceDown(geom);
    return hardenExportGeometry(geom);
  };

  onProgress("Applying assembly clearance...");
  await yieldThread();

  const offsetShapes: Record<string, MultiPolygon> = {};
  const offsetAmountInClipper = clearance > 0 ? -(clearance / (0.1 * scaleFactor)) * clipperScale : 0;

  shapesWithColors.forEach(item => {
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
  });

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      onProgress(`Slicing quadrant ${r * gridCols + c + 1} of ${gridRows * gridCols}...`);
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

      shapesWithColors.forEach(item => {
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
      });

      const itemsForPlate: PrintItem[] = [];

      if (mergeByColor) {
        onProgress("Unioning shapes by color...");
        await yieldThread();

        const colorGroups: Record<string, ClippedPart[]> = {};
        clippedParts.forEach(part => {
          if (!colorGroups[part.colorHex]) colorGroups[part.colorHex] = [];
          colorGroups[part.colorHex].push(part);
        });

        for (const [hex, parts] of Object.entries(colorGroups)) {
          const maxDepth = Math.max(...parts.map(p => p.totalDepth));
          let geom: THREE.BufferGeometry | null = null;

          try {
            const united = unionMultiPolygons(parts.map(p => p.multiPoly));
            const shapes = multiPolygonToShapes(united);
            if (shapes.length > 0) {
              geom = buildScaledSolid(shapes, maxDepth);
            }
          } catch (err) {
            console.error("Failed to union geometries for color", hex, err);
          }

          if (!geom) {
            // Fallback: extrude each part, then buffer-concat
            const geoms: THREE.BufferGeometry[] = [];
            for (const part of parts) {
              const shapes = multiPolygonToShapes(part.multiPoly);
              if (shapes.length === 0) continue;
              const g = buildScaledSolid(shapes, part.totalDepth);
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
          const shapes = multiPolygonToShapes(part.multiPoly);
          if (shapes.length === 0) continue;
          const geom = buildScaledSolid(shapes, part.totalDepth);
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
  await yieldThread();

  if (plates.length > 0) {
    return await buildMultiPlate3MF(plates, {
      printerModel,
      groupIntoOneObject: mergeByColor
    });
  }
  return null;
}

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
        if (printFaceDown) flipFaceDown(mergedGeometry);
        const hardened = hardenExportGeometry(mergedGeometry);
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
        if (printFaceDown) flipFaceDown(geom);
        mesh.geometry = hardenExportGeometry(geom);
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
