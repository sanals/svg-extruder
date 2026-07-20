import * as THREE from 'three';
import type { ShapeItem } from '../types';

export function getShapeAreas(shapes: ShapeItem[]): { id: string; area: number }[] {
  return shapes.map((item) => {
    let area = 0;
    item.shapes.forEach((shape) => {
      const pts = shape.getPoints();
      if (pts.length > 2) area += THREE.ShapeUtils.area(pts);
      shape.holes.forEach((hole) => {
        const hPts = hole.getPoints();
        if (hPts.length > 2) area -= THREE.ShapeUtils.area(hPts);
      });
    });
    return { id: item.id, area: Math.abs(area) };
  });
}
