import * as THREE from 'three';
import type { ShapeItem } from '../types';

export const getLuminance = (hex: string) => {
  const rgb = parseInt(hex, 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = (rgb >> 0) & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

const calculateThinness = (shape: THREE.Shape) => {
  let area = 0;
  let perimeter = 0;
  const getP = (pts: THREE.Vector2[]) => {
    let p = 0;
    for (let i = 1; i < pts.length; i++) p += pts[i].distanceTo(pts[i - 1]);
    if (pts.length > 0) p += pts[0].distanceTo(pts[pts.length - 1]);
    return p;
  };
  const pts = shape.getPoints();
  if (pts.length > 2) area += Math.abs(THREE.ShapeUtils.area(pts));
  perimeter += getP(pts);
  shape.holes.forEach(hole => {
    const hpts = hole.getPoints();
    if (hpts.length > 2) area -= Math.abs(THREE.ShapeUtils.area(hpts));
    perimeter += getP(hpts);
  });
  if (perimeter === 0) return 999999;
  return (2 * area) / perimeter;
};

export const computeAutoExtrudeDepths = (allShapes: ShapeItem[], meshColorOverrides: Record<string, string>) => {
  const colorSet = Array.from(new Set(allShapes.map(s => meshColorOverrides[s.id] ?? s.colorHex)));
  colorSet.sort((a, b) => getLuminance(b) - getLuminance(a));
  const darkestColor = colorSet[colorSet.length - 1];
  const minLuminance = getLuminance(darkestColor);

  const darkColors = new Set(colorSet.filter(c => getLuminance(c) <= minLuminance + 60));
  const newDepths: Record<string, number> = {};

  allShapes.forEach(s => {
    const effectiveColor = meshColorOverrides[s.id] ?? s.colorHex;
    let minThickness = 999999;
    s.shapes.forEach(shape => {
      const thickness = calculateThinness(shape);
      if (thickness < minThickness) minThickness = thickness;
    });

    const isDark = darkColors.has(effectiveColor);
    const isStroke = minThickness < 15;

    if (isDark || isStroke) {
      newDepths[s.id] = 3;
    } else {
      newDepths[s.id] = 1;
    }
  });

  return newDepths;
};

export const calculateLineArtParams = (allShapes: ShapeItem[], meshColorOverrides: Record<string, string>, borderWidth: number) => {
  const colorSet = Array.from(new Set(allShapes.map(s => meshColorOverrides[s.id] ?? s.colorHex)));
  colorSet.sort((a, b) => getLuminance(b) - getLuminance(a));
  const darkestColor = colorSet[colorSet.length - 1];
  const minLuminance = getLuminance(darkestColor);
  
  const darkColors = new Set(colorSet.filter(c => getLuminance(c) <= minLuminance + 80));
  const newDepths: Record<string, number> = {};
  const newColors: Record<string, string> = {};
  const lightShapeIds: string[] = [];
  const darkShapeIds: string[] = [];
  const outlineThicknesses: number[] = [];

  allShapes.forEach(s => {
    const effectiveColor = meshColorOverrides[s.id] ?? s.colorHex;
    let minThickness = 999999;
    s.shapes.forEach(shape => {
      const thickness = calculateThinness(shape);
      if (thickness < minThickness) minThickness = thickness;
    });

    const isStroke = minThickness < 15;

    if (darkColors.has(effectiveColor) || isStroke) {
      newDepths[s.id] = 3;
      newColors[s.id] = '000000';
      darkShapeIds.push(s.id);

      if (isStroke) {
        s.shapes.forEach(shape => {
          if (shape.holes.length > 0) outlineThicknesses.push(calculateThinness(shape));
        });
      }
    } else {
      newDepths[s.id] = 1;
      newColors[s.id] = 'ffffff';
      lightShapeIds.push(s.id);
    }
  });

  let targetWidth = borderWidth;
  if (outlineThicknesses.length > 0) {
    outlineThicknesses.sort((a, b) => a - b);
    const medianThickness = outlineThicknesses[Math.floor(outlineThicknesses.length / 2)];
    if (medianThickness > 0 && medianThickness < 30) {
      targetWidth = medianThickness;
    }
  }

  return { newDepths, newColors, lightShapeIds, darkShapeIds, targetWidth };
};

export const generateSVGFromShapes = (shapesData: ShapeItem[], meshColorOverrides: Record<string, string>) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const paths = shapesData.map(data => {
    let d = '';
    data.shapes.forEach(shape => {
      const points = shape.extractPoints(12);

      const processRing = (ring: any) => {
        if (ring.length === 0) return '';
        let pathStr = `M ${ring[0].x} ${ring[0].y} `;
        minX = Math.min(minX, ring[0].x); minY = Math.min(minY, ring[0].y);
        maxX = Math.max(maxX, ring[0].x); maxY = Math.max(maxY, ring[0].y);

        for (let i = 1; i < ring.length; i++) {
          pathStr += `L ${ring[i].x} ${ring[i].y} `;
          minX = Math.min(minX, ring[i].x); minY = Math.min(minY, ring[i].y);
          maxX = Math.max(maxX, ring[i].x); maxY = Math.max(maxY, ring[i].y);
        }
        return pathStr + 'Z ';
      };

      d += processRing(points.shape);
      points.holes.forEach(hole => {
        d += processRing(hole);
      });
    });
    
    let finalColor = data.colorHex;
    if (meshColorOverrides[data.id]) {
      finalColor = meshColorOverrides[data.id];
    }
    if (!d.trim()) return '';
    return `<path d="${d.trim()}" fill="#${finalColor}" />`;
  }).filter(Boolean);

  if (minX === Infinity) return null; 

  const width = maxX - minX;
  const height = maxY - minY;
  const padding = Math.max(width, height) * 0.05;
  const viewBox = `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n  ${paths.join('\n  ')}\n</svg>`;
};
