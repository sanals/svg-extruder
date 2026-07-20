import type { ShapeItem, MultiPolygon } from '../types';
import { shapeToPolygon } from './clipper-utils';
import * as ClipperLib from 'clipper-lib';

const CLIPPER_SCALE = 10000;
const DEFAULT_THRESHOLD_MM = 0.4;
/** Flag if post-inset area is under this fraction of pre-inset area. */
const AREA_COLLAPSE_RATIO = 0.05;

export type ThinWallPart = { id: string; colorHex: string };

export type ExportScaleInput = {
  shapes: ShapeItem[];
  buildPlateSize: number;
  gridSize: string;
  /** Same units as sliceAndExport: already divided by 100 when from UI %. */
  customScale: number;
};

/**
 * Matches scaleFactor computation in sliceAndExport so thin-wall warnings
 * reflect the physical size that will actually be printed.
 */
export function estimateExportScaleFactor(input: ExportScaleInput): number {
  const { shapes, buildPlateSize, gridSize, customScale } = input;
  if (shapes.length === 0) return customScale;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  shapes.forEach(item => {
    item.shapes.forEach(shape => {
      shape.getPoints().forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      });
    });
  });

  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;
  if (!(rawWidth > 0) || !(rawHeight > 0)) return customScale;

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
    const [colsStr, rowsStr] = gridSize.split('x');
    gridCols = parseInt(colsStr, 10) || 1;
    gridRows = parseInt(rowsStr, 10) || 1;
  }

  const targetMaxWidth = usablePlateSize * gridCols;
  const targetMaxHeight = usablePlateSize * gridRows;
  const scaleX = targetMaxWidth / (rawWidth * 0.1);
  const scaleY = targetMaxHeight / (rawHeight * 0.1);
  let scaleFactor = Math.min(scaleX, scaleY);

  if (gridSize === 'auto') {
    scaleFactor = Math.min(customScale, scaleFactor);
  }

  return scaleFactor;
}

function mmToClipperDelta(mm: number, scaleFactor: number): number {
  return (mm / (0.1 * scaleFactor)) * CLIPPER_SCALE;
}

function addPolygonToOffset(co: ClipperLib.ClipperOffset, multiPoly: MultiPolygon) {
  multiPoly.forEach(polygon => {
    for (let i = 0; i < polygon.length; i++) {
      const ring = polygon[i];
      if (ring.length < 3) continue;
      const path = ring.map(p => ({
        X: Math.round(p[0] * CLIPPER_SCALE),
        Y: Math.round(p[1] * CLIPPER_SCALE),
      }));
      const isOuter = i === 0;
      const orient = ClipperLib.Clipper.Orientation(path);
      if (isOuter !== orient) path.reverse();
      // @ts-ignore
      co.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    }
  });
}

function offsetMultiPoly(multiPoly: MultiPolygon, deltaClipper: number): MultiPolygon {
  if (multiPoly.length === 0) return [];
  const co = new ClipperLib.ClipperOffset();
  addPolygonToOffset(co, multiPoly);
  // @ts-ignore
  const tree = new ClipperLib.PolyTree();
  // @ts-ignore
  co.Execute(tree, deltaClipper);

  const result: MultiPolygon = [];
  const parsePolyNode = (node: any) => {
    if (!node.IsHole()) {
      const ring = node.Contour().map((p: any) => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE]);
      if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
        ring.push([...ring[0]]);
      }
      if (ring.length >= 4) {
        const poly = [ring];
        node.Childs().forEach((child: any) => {
          const holeRing = child.Contour().map((p: any) => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE]);
          if (holeRing.length > 0 && (holeRing[0][0] !== holeRing[holeRing.length - 1][0] || holeRing[0][1] !== holeRing[holeRing.length - 1][1])) {
            holeRing.push([...holeRing[0]]);
          }
          if (holeRing.length >= 4) poly.push(holeRing);
          child.Childs().forEach((nested: any) => parsePolyNode(nested));
        });
        result.push(poly);
      }
    }
  };
  // @ts-ignore
  tree.Childs().forEach((child: any) => parsePolyNode(child));
  return result;
}

function clipperAreaAbs(multiPoly: MultiPolygon): number {
  let area = 0;
  multiPoly.forEach(polygon => {
    for (let i = 0; i < polygon.length; i++) {
      const ring = polygon[i];
      if (ring.length < 3) continue;
      const path = ring.map(p => ({
        X: Math.round(p[0] * CLIPPER_SCALE),
        Y: Math.round(p[1] * CLIPPER_SCALE),
      }));
      const a = ClipperLib.Clipper.Area(path);
      area += i === 0 ? Math.abs(a) : -Math.abs(a);
    }
  });
  return Math.abs(area);
}

function shapesToMultiPoly(item: ShapeItem): MultiPolygon {
  const multi: MultiPolygon = [];
  item.shapes.forEach(shape => {
    const poly = shapeToPolygon(shape);
    if (poly.length > 0) multi.push(poly);
  });
  return multi;
}

/**
 * Parts whose XY footprint collapses under an inward offset of threshold/2
 * (after optional assembly clearance), i.e. thinner than thresholdMm at export scale.
 */
export function findThinWallParts(
  shapes: ShapeItem[],
  opts: {
    scaleFactor: number;
    clearanceMm: number;
    thresholdMm?: number;
  }
): ThinWallPart[] {
  const thresholdMm = opts.thresholdMm ?? DEFAULT_THRESHOLD_MM;
  const { scaleFactor, clearanceMm } = opts;
  if (!(scaleFactor > 0) || shapes.length === 0) return [];

  const thin: ThinWallPart[] = [];
  const clearanceDelta = clearanceMm > 0 ? -mmToClipperDelta(clearanceMm, scaleFactor) : 0;
  const halfThresholdDelta = -mmToClipperDelta(thresholdMm / 2, scaleFactor);

  for (const item of shapes) {
    if (!item.shapes.length) continue;

    let multi = shapesToMultiPoly(item);
    if (multi.length === 0) continue;

    if (clearanceDelta !== 0) {
      multi = offsetMultiPoly(multi, clearanceDelta);
      if (multi.length === 0) {
        thin.push({ id: item.id, colorHex: item.colorHex });
        continue;
      }
    }

    const areaBefore = clipperAreaAbs(multi);
    const afterInset = offsetMultiPoly(multi, halfThresholdDelta);

    // @ts-ignore — ChildCount via empty result
    const vanished = afterInset.length === 0;
    const areaAfter = vanished ? 0 : clipperAreaAbs(afterInset);
    const collapsed =
      vanished ||
      (areaBefore > 0 && areaAfter / areaBefore < AREA_COLLAPSE_RATIO);

    if (collapsed) {
      thin.push({ id: item.id, colorHex: item.colorHex });
    }
  }

  return thin;
}

const THIN_WALL_YIELD_EVERY = 8;

/** Async thin-wall scan that yields so the export dialog stays responsive. */
export async function findThinWallPartsAsync(
  shapes: ShapeItem[],
  opts: {
    scaleFactor: number;
    clearanceMm: number;
    thresholdMm?: number;
  },
  signal?: AbortSignal,
): Promise<ThinWallPart[]> {
  const thresholdMm = opts.thresholdMm ?? DEFAULT_THRESHOLD_MM;
  const { scaleFactor, clearanceMm } = opts;
  if (!(scaleFactor > 0) || shapes.length === 0) return [];

  const thin: ThinWallPart[] = [];
  const clearanceDelta = clearanceMm > 0 ? -mmToClipperDelta(clearanceMm, scaleFactor) : 0;
  const halfThresholdDelta = -mmToClipperDelta(thresholdMm / 2, scaleFactor);
  let checked = 0;

  for (const item of shapes) {
    if (signal?.aborted) return thin;
    if (!item.shapes.length) continue;

    let multi = shapesToMultiPoly(item);
    if (multi.length === 0) continue;

    if (clearanceDelta !== 0) {
      multi = offsetMultiPoly(multi, clearanceDelta);
      if (multi.length === 0) {
        thin.push({ id: item.id, colorHex: item.colorHex });
        checked += 1;
        if (checked % THIN_WALL_YIELD_EVERY === 0) {
          await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        }
        continue;
      }
    }

    const areaBefore = clipperAreaAbs(multi);
    const afterInset = offsetMultiPoly(multi, halfThresholdDelta);

    const vanished = afterInset.length === 0;
    const areaAfter = vanished ? 0 : clipperAreaAbs(afterInset);
    const collapsed =
      vanished ||
      (areaBefore > 0 && areaAfter / areaBefore < AREA_COLLAPSE_RATIO);

    if (collapsed) {
      thin.push({ id: item.id, colorHex: item.colorHex });
    }

    checked += 1;
    if (checked % THIN_WALL_YIELD_EVERY === 0) {
      await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }
  }

  return thin;
}

export const THIN_WALL_THRESHOLD_MM = DEFAULT_THRESHOLD_MM;
