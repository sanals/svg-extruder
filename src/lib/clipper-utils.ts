import type { Polygon, MultiPolygon, Ring, Pair } from '../types';

import * as THREE from 'three';
import * as ClipperLib from 'clipper-lib';

export function shapeToPolygon(shape: THREE.Shape): Polygon {
  // Extract points (this resolves Bezier curves to line segments)
  const points = shape.extractPoints(12);
  const ring = points.shape.map(p => [p.x, p.y] as Pair);

  // polygon-clipping expects closed rings where first point === last point
  if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  const polygon: Polygon = [ring];

  for (const hole of points.holes) {
    const holeRing = hole.map(p => [p.x, p.y] as Pair);
    if (holeRing.length > 0 && (holeRing[0][0] !== holeRing[holeRing.length - 1][0] || holeRing[0][1] !== holeRing[holeRing.length - 1][1])) {
      holeRing.push([holeRing[0][0], holeRing[0][1]]);
    }
    polygon.push(holeRing);
  }
  return polygon;
}

export function multiPolygonToShapes(multiPoly: MultiPolygon): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];
  for (const poly of multiPoly) {
    if (!poly || poly.length === 0) continue;
    const shapeRing = poly[0];

    // A valid shape must have at least 3 points
    if (!shapeRing || shapeRing.length < 3) continue;

    const shape = new THREE.Shape();

    shape.moveTo(shapeRing[0][0], shapeRing[0][1]);
    for (let i = 1; i < shapeRing.length; i++) {
      shape.lineTo(shapeRing[i][0], shapeRing[i][1]);
    }

    // Add holes
    for (let h = 1; h < poly.length; h++) {
      const holeRing = poly[h];
      if (!holeRing || holeRing.length < 3) continue;

      const holePath = new THREE.Path();
      holePath.moveTo(holeRing[0][0], holeRing[0][1]);
      for (let i = 1; i < holeRing.length; i++) {
        holePath.lineTo(holeRing[i][0], holeRing[i][1]);
      }
      shape.holes.push(holePath);
    }
    shapes.push(shape);
  }
  return shapes;
}

export const getBoundingBox = (multiPoly: MultiPolygon) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of multiPoly) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
};

export const boxesIntersect = (b1: ReturnType<typeof getBoundingBox>, b2: ReturnType<typeof getBoundingBox>) => {
  return !(b2.minX > b1.maxX || b2.maxX < b1.minX || b2.minY > b1.maxY || b2.maxY < b1.minY);
};

export const performClipperBoolean = (subjMultiPoly: MultiPolygon, clipMultiPolys: MultiPolygon[], clipType: number): MultiPolygon => {
  const scale = 10000;
  const clipper = new ClipperLib.Clipper();

  const addMultiPoly = (multiPoly: MultiPolygon, polyType: number) => {
    for (const poly of multiPoly) {
      for (let i = 0; i < poly.length; i++) {
        const ring = poly[i];
        if (ring.length < 3) continue;
        const clipperPath = ring.map(p => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));

        // Enforce winding order based on array structure (poly[0] is outer, rest are holes)
        // This forces holes to have the opposite winding direction of outers, preserving them in pftNonZero
        const isOuter = (i === 0);
        const orient = ClipperLib.Clipper.Orientation(clipperPath);
        if (isOuter !== orient) {
          clipperPath.reverse();
        }

        // @ts-ignore
        clipper.AddPath(clipperPath, polyType, true);
      }
    }
  };

  addMultiPoly(subjMultiPoly, ClipperLib.PolyType.ptSubject);
  for (const clipPoly of clipMultiPolys) {
    addMultiPoly(clipPoly, ClipperLib.PolyType.ptClip);
  }

  // @ts-ignore
  const solutionTree = new ClipperLib.PolyTree();
  // @ts-ignore
  clipper.Execute(clipType, solutionTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  const resultMultiPoly: MultiPolygon = [];
  const parsePolyNode = (node: any, multiPoly: MultiPolygon) => {
    if (!node.IsHole()) {
      const ring: Ring = node.Contour().map((p: any) => [p.X / scale, p.Y / scale]);
      if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);

      if (ring.length >= 4) {
        const poly = [ring];
        node.Childs().forEach((child: any) => {
          const holeRing: Ring = child.Contour().map((p: any) => [p.X / scale, p.Y / scale]);
          if (holeRing.length > 0 && (holeRing[0][0] !== holeRing[holeRing.length - 1][0] || holeRing[0][1] !== holeRing[holeRing.length - 1][1])) holeRing.push([...holeRing[0]]);
          if (holeRing.length >= 4) poly.push(holeRing);

          child.Childs().forEach((nestedNode: any) => parsePolyNode(nestedNode, multiPoly));
        });
        multiPoly.push(poly);
      }
    }
  };

  // @ts-ignore
  solutionTree.Childs().forEach((child: any) => parsePolyNode(child, resultMultiPoly));
  return resultMultiPoly;
};
