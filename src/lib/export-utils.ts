import { buildMultiPlate3MF } from './generic-3mf-exporter';
import type { ShapeItem, Polygon, MultiPolygon, Ring, PrintItem, PrintPlate } from '../types';
import { shapeToPolygon, multiPolygonToShapes } from '../lib/clipper-utils';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import * as ClipperLib from 'clipper-lib';

const yieldThread = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

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
  sealGaps: boolean,
  meshColorOverrides: Record<string, string>,
  backingDepth: number,
  onProgress: (msg: string) => void
): Promise<Blob | null> {
  if (shapesWithColors.length === 0) return null;

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

      const itemsForPlate: PrintItem[] = [];

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
        const clippedShapes = multiPolygonToShapes(resultMultiPoly);

        if (clippedShapes.length > 0) {
          const depth = meshDepths[item.id] ?? 0;
          const totalDepth = depth + backingDepth;
          let geom: THREE.BufferGeometry;
          if (totalDepth === 0) {
            geom = new THREE.ShapeGeometry(clippedShapes, 32);
          } else {
            geom = new THREE.ExtrudeGeometry(clippedShapes, {
              depth: totalDepth,
              curveSegments: 32,
              bevelEnabled: sealGaps,
              bevelSize: sealGaps ? 0.2 : 0,
              bevelThickness: sealGaps ? 0.05 : 0,
              bevelSegments: sealGaps ? 1 : 0
            });
          }

          if (geom.index) {
            geom = geom.toNonIndexed();
          }
          geom.deleteAttribute('normal');
          geom.deleteAttribute('uv');

          const matrix = new THREE.Matrix4().makeScale(
            0.1 * scaleFactor,
            -0.1 * scaleFactor,
            scaleZProportionally ? 0.1 * scaleFactor : 0.1
          );
          geom.applyMatrix4(matrix);

          const overriddenHex = meshColorOverrides[item.id];
          const hex = overriddenHex ?? item.colorHex;

          itemsForPlate.push({
            id: item.id,
            geometry: geom,
            colorHex: `#${hex}`,
            name: `Part_${item.id}`
          });
        }
      });

      if (itemsForPlate.length > 0) {
        let mergedItems: PrintItem[] = [];

        if (mergeByColor) {
          const colorGroups: Record<string, THREE.BufferGeometry[]> = {};
          itemsForPlate.forEach(item => {
            const hex = item.colorHex || "#CCCCCC";
            if (!colorGroups[hex]) colorGroups[hex] = [];
            colorGroups[hex].push(item.geometry);
          });

          Object.entries(colorGroups).forEach(([hex, geoms]) => {
            if (geoms.length === 1) {
              mergedItems.push({
 id: Math.random().toString(36).substring(7),
 geometry: geoms[0], colorHex: hex, name: `ColorGroup_${hex}` });
            } else {
              try {
                let totalPositions = 0;
                geoms.forEach(g => {
                  totalPositions += g.getAttribute('position').count;
                });

                const mergedPos = new Float32Array(totalPositions * 3);
                let offset = 0;
                geoms.forEach(g => {
                  const pos = g.getAttribute('position');
                  mergedPos.set(pos.array, offset);
                  offset += pos.array.length;
                });

                const mergedGeo = new THREE.BufferGeometry();
                mergedGeo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
                mergedItems.push({
 id: Math.random().toString(36).substring(7),
 geometry: mergedGeo, colorHex: hex, name: `ColorGroup_${hex}` });
              } catch (err) {
                console.error("Failed to merge geometries for color", hex, err);
                geoms.forEach((g, idx) => mergedItems.push({
 id: Math.random().toString(36).substring(7),
 geometry: g, colorHex: hex, name: `ColorGroup_${hex}_${idx}` }));
              }
            }
          });
        } else {
          mergedItems = itemsForPlate;
        }

        plates.push({
          name: `Plate_R${r + 1}_C${c + 1}`, items: mergedItems, width: buildPlateSize, height: buildPlateSize
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
  mergeBeforeExport: boolean
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

        if (geom.index) {
          geom = geom.toNonIndexed();
        }

        const attrs = Object.keys(geom.attributes);
        attrs.forEach(key => {
          if (key !== 'position' && key !== 'normal' && key !== 'uv') {
            geom.deleteAttribute(key);
          }
        });
        if (!geom.attributes.normal) geom.computeVertexNormals();
        if (!geom.attributes.uv) {
          const count = geom.attributes.position.count;
          geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        }

        geom.applyMatrix4(mesh.matrix);
        geometries.push(geom);
        materials.push(mesh.material as THREE.Material);
      }
    });

    if (geometries.length > 0 && meshesParent) {
      try {
        const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, true);
        const mergedMesh = new THREE.Mesh(mergedGeometry, materials);

        const parent = meshesParent as THREE.Object3D;
        parent.clear();
        parent.add(mergedMesh);

        finalExportObject = exportScene;
      } catch (e) {
        console.error("Failed to merge geometries:", e);
        throw e;
      }
    }
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

