import type { ShapeItem, MultiPolygon, Ring, Pair } from '../types';
import { shapeToPolygon, multiPolygonToShapes } from '../lib/clipper-utils';
import { getBoundingBox, boxesIntersect, performClipperBoolean } from '../lib/clipper-utils';
import * as THREE from 'three';
import * as ClipperLib from 'clipper-lib';

function parseCssColor(input: string | undefined | null): THREE.Color | null {
  if (!input || input === 'none') return null;
  const value = input === 'currentColor' ? '#000000' : input;
  try {
    return new THREE.Color().setStyle(value);
  } catch {
    return null;
  }
}

function colorsMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const ca = parseCssColor(a);
  const cb = parseCssColor(b);
  if (!ca || !cb) return false;
  return ca.getHex() === cb.getHex();
}

function offsetPathToMultiPoly(path: any, strokeWidth: number): MultiPolygon {
  const scale = 10000;
  const co = new ClipperLib.ClipperOffset();

  path.subPaths.forEach((subPath: any) => {
    const points = subPath.getPoints();
    if (points.length < 2) return;

    const clipperPath = points.map((p: any) => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
    const isClosed = points[0].distanceTo(points[points.length - 1]) < 0.01;
    const endType = isClosed ? ClipperLib.EndType.etClosedPolygon : ClipperLib.EndType.etOpenSquare;

    co.AddPath(clipperPath, ClipperLib.JoinType.jtMiter, endType);
  });

  // @ts-ignore
  const solutionTree = new ClipperLib.PolyTree();
  co.Execute(solutionTree, (strokeWidth / 2) * scale);

  const strokeMultiPoly: MultiPolygon = [];
  const parsePolyNode = (node: any, multiPoly: MultiPolygon) => {
    if (!node.IsHole()) {
      const ring: Ring = node.Contour().map((p: any) => [p.X / scale, p.Y / scale]);
      if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
      const poly = [ring];

      node.Childs().forEach((child: any) => {
        const holeRing: Ring = child.Contour().map((p: any) => [p.X / scale, p.Y / scale]);
        if (holeRing.length > 0 && (holeRing[0][0] !== holeRing[holeRing.length - 1][0] || holeRing[0][1] !== holeRing[holeRing.length - 1][1])) holeRing.push([...holeRing[0]]);
        poly.push(holeRing);

        child.Childs().forEach((nestedNode: any) => parsePolyNode(nestedNode, multiPoly));
      });
      if (poly[0].length > 0) multiPoly.push(poly);
    }
  };

  // @ts-ignore
  solutionTree.Childs().forEach((child: any) => parsePolyNode(child, strokeMultiPoly));
  return strokeMultiPoly;
}

function pushLayer(
  layerPolygons: MultiPolygon[],
  layerBBoxes: { minX: number, minY: number, maxX: number, maxY: number }[],
  newSvgDataPaths: any[],
  path: any,
  multiPoly: MultiPolygon,
  colorCss: string,
) {
  if (multiPoly.length === 0) return;
  layerPolygons.push(multiPoly);
  layerBBoxes.push(getBoundingBox(multiPoly));
  const layerPath = Object.assign(Object.create(Object.getPrototypeOf(path)), path);
  layerPath.color = new THREE.Color().setStyle(colorCss === 'currentColor' ? '#000000' : colorCss);
  newSvgDataPaths.push(layerPath);
}

export const processGeometry = async (
  svgData: any,
  cutOverlaps: boolean,
  onParseProgress?: (msg: string | null) => void,
  isCancelled: () => boolean = () => false
): Promise<ShapeItem[]> => {
  // Guarantee a frame render by combining requestAnimationFrame and setTimeout
  const yieldThread = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

  // 1. Convert all SVG paths into MultiPolygons and clean them up
  const layerPolygons: MultiPolygon[] = [];
  const layerBBoxes: { minX: number, minY: number, maxX: number, maxY: number }[] = [];
  const newSvgDataPaths: any[] = [];
  const processedNodes = new Set();

  if (onParseProgress) onParseProgress("Step 1/3: Extracting SVG layers...");
  await yieldThread();

  let pathIndex = 0;
  for (const path of svgData.paths) {
    if (isCancelled()) throw new Error("Cancelled");
    pathIndex++;

    if (onParseProgress && pathIndex % Math.max(1, Math.floor(svgData.paths.length / 10)) === 0) {
      onParseProgress(`Step 2/3: Converting shapes (${pathIndex}/${svgData.paths.length})...`);
      await yieldThread();
    }

    const node = path.userData?.node;
    if (node && processedNodes.has(node)) continue;
    if (node) processedNodes.add(node);

    let strokeColor = (path.userData?.style as any)?.stroke;
    if (strokeColor === 'currentColor') strokeColor = '#000000';
    let rawStrokeWidth = (path.userData?.style as any)?.strokeWidth;
    const strokeWidth = (rawStrokeWidth !== undefined && rawStrokeWidth !== null) ? parseFloat(rawStrokeWidth.toString()) : 1;

    let fillColor = (path.userData?.style as any)?.fill;
    if (fillColor === 'currentColor') fillColor = '#000000';

    let strokeMultiPoly: MultiPolygon = [];
    const hasStroke =
      strokeColor !== undefined &&
      strokeColor !== 'none' &&
      !isNaN(strokeWidth) &&
      strokeWidth > 0;
    if (hasStroke) {
      strokeMultiPoly = offsetPathToMultiPoly(path, strokeWidth);
    }

    let fillMultiPoly: MultiPolygon = [];
    const hasFill = fillColor !== undefined && fillColor !== 'none';
    if (hasFill) {
      // @ts-ignore
      const shapes = path.toShapes(true);
      fillMultiPoly = shapes.map(shapeToPolygon);
    }

    // Seam-seal strokes use stroke===fill. Merge them into one mesh so deleting
    // a color never leaves an orphan thin border / fragment strip behind.
    const seamStrokeMatchesFill = hasStroke && hasFill && colorsMatch(strokeColor, fillColor);

    if (seamStrokeMatchesFill) {
      let merged = fillMultiPoly;
      if (strokeMultiPoly.length > 0 && fillMultiPoly.length > 0) {
        try {
          merged = performClipperBoolean(fillMultiPoly, [strokeMultiPoly], ClipperLib.ClipType.ctUnion);
        } catch {
          merged = fillMultiPoly;
        }
      } else if (strokeMultiPoly.length > 0) {
        merged = strokeMultiPoly;
      }
      pushLayer(layerPolygons, layerBBoxes, newSvgDataPaths, path, merged, fillColor!);
      continue;
    }

    // Distinct stroke color (true outlines) stays its own layer.
    if (hasStroke && strokeMultiPoly.length > 0) {
      pushLayer(layerPolygons, layerBBoxes, newSvgDataPaths, path, strokeMultiPoly, strokeColor!);
    }
    if (hasFill && fillMultiPoly.length > 0) {
      pushLayer(layerPolygons, layerBBoxes, newSvgDataPaths, path, fillMultiPoly, fillColor!);
    }
  }

  if (isCancelled()) throw new Error("Cancelled");

  const finalizePolygons = (finalPolys: MultiPolygon[]): ShapeItem[] => {
    const individualShapes: ShapeItem[] = [];

    // Compute the bounding box center of ALL polygons so we can center them at the origin.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const multiPoly of finalPolys) {
      for (const poly of multiPoly) {
        for (const ring of poly) {
          for (const [x, y] of ring) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    finalPolys.forEach((multiPoly, index) => {
      if (multiPoly.length === 0) return;
      const color = newSvgDataPaths[index].color;
      const colorHex = color.getHexString();

      // Offset polygons so they are centered around (0,0) before creating shapes
      const centeredMultiPoly: MultiPolygon = multiPoly.map(poly =>
        poly.map(ring =>
          ring.map(([x, y]) => [x - cx, y - cy] as Pair)
        )
      );

      const shapes = multiPolygonToShapes(centeredMultiPoly);
      individualShapes.push({ id: `shape_${index}`, color, colorHex, shapes });
    });

    return individualShapes;
  };

  if (!cutOverlaps) {
    return finalizePolygons(layerPolygons);
  }

  // Asynchronous Boolean Subtraction Loop
  const finalPolygons: MultiPolygon[] = [];

  for (let i = 0; i < layerPolygons.length; i++) {
    if (isCancelled()) throw new Error("Cancelled");

    const updateInterval = Math.max(1, Math.floor(layerPolygons.length / 100));
    if (onParseProgress && i % updateInterval === 0) {
      onParseProgress(`Step 3/3: Cutting overlaps (Layer ${i + 1} of ${layerPolygons.length})...`);
      await yieldThread();
    }

    let result = layerPolygons[i];
    let resultBBox = layerBBoxes[i];

    const overlappingAbovePolys: MultiPolygon[] = [];
    for (let j = i + 1; j < layerPolygons.length; j++) {
      if (boxesIntersect(resultBBox, layerBBoxes[j])) {
        overlappingAbovePolys.push(layerPolygons[j]);
      }
    }

    if (overlappingAbovePolys.length > 0 && result.length > 0) {
      // Process overlaps in chunks of 50. 
      const chunkSize = 50;
      for (let k = 0; k < overlappingAbovePolys.length; k += chunkSize) {
        if (isCancelled()) throw new Error("Cancelled");
        const chunk = overlappingAbovePolys.slice(k, k + chunkSize);

        try {
          // @ts-ignore
          result = performClipperBoolean(result, chunk, ClipperLib.ClipType.ctDifference);
        } catch (e) {
          console.warn(`Boolean subtraction failed`, e);
        }

        if (result.length === 0) break;

        // Yield after every chunk of 50 overlapping polygons to guarantee UI stays responsive
        await yieldThread();
      }
    }
    finalPolygons.push(result);
  }

  if (isCancelled()) throw new Error("Cancelled");
  return finalizePolygons(finalPolygons);
};
