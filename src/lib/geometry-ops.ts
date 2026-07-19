import type { ShapeItem, Polygon, MultiPolygon, Ring, Pair } from '../types';
import { shapeToPolygon, multiPolygonToShapes } from '../lib/clipper-utils';
import * as THREE from 'three';
import * as ClipperLib from 'clipper-lib';

const yieldThread = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

export async function extractInnerParts(
  shapesWithColors: ShapeItem[],
  selectedIds: string[],
  onProgress: (msg: string) => void
): Promise<{ updatedShapes: ShapeItem[], newIds: string[] } | null> {
  onProgress("Extracting inner holes...");
  await yieldThread();

  const newParts: ShapeItem[] = [];
  const nextShapes = [...shapesWithColors];
  const newIds: string[] = [];

  selectedIds.forEach(id => {
    const item = nextShapes.find(n => n.id === id);
    if (item) {
      item.shapes.forEach(shape => {
        shape.holes.forEach(hole => {
          const pts = hole.getPoints();
          if (pts.length > 2) {
            if (THREE.ShapeUtils.isClockWise(pts)) {
              pts.reverse();
            }
            const newShape = new THREE.Shape(pts);
            const newId = `inner_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            newIds.push(newId);
            newParts.push({
              id: newId,
              color: new THREE.Color(0xffffff),
              colorHex: "ffffff",
              shapes: [newShape]
            });
          }
        });
      });
    }
  });

  if (newParts.length > 0) {
    return { updatedShapes: [...nextShapes, ...newParts], newIds };
  }
  return null;
}

export async function createBasePlate(
  shapesWithColors: ShapeItem[],
  selectedIds: string[],
  onProgress: (msg: string) => void
): Promise<{ updatedShapes: ShapeItem[], newIds: string[] } | null> {
  onProgress("Fusing and tracing silhouette...");
  await yieldThread();

  const itemsToFuse = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 0);
  if (itemsToFuse.length === 0) return null;

  const clipper = new ClipperLib.Clipper();
  const CLIPPER_SCALE = 10000;
  
  itemsToFuse.forEach(item => {
    item.shapes.forEach(shape => {
      const pts = shape.getPoints();
      if (pts.length > 2) {
        const path = pts.map(p => ({ X: Math.round(p.x * CLIPPER_SCALE), Y: Math.round(p.y * CLIPPER_SCALE) }));
        clipper.AddPath(path, ClipperLib.PolyType.ptSubject, true);
      }
      shape.holes.forEach(hole => {
        const hPts = hole.getPoints();
        if (hPts.length > 2) {
          const hPath = hPts.map(p => ({ X: Math.round(p.x * CLIPPER_SCALE), Y: Math.round(p.y * CLIPPER_SCALE) }));
          clipper.AddPath(hPath, ClipperLib.PolyType.ptSubject, true);
        }
      });
    });
  });

  const strokesUnion = new ClipperLib.PolyTree();
  clipper.Execute(ClipperLib.ClipType.ctUnion, strokesUnion, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  const solidSilhouettePaths: any[] = [];
  // @ts-ignore
  strokesUnion.Childs().forEach((child: any) => {
    solidSilhouettePaths.push(child.Contour());
  });

  const diffClipper = new ClipperLib.Clipper();
  diffClipper.AddPaths(solidSilhouettePaths, ClipperLib.PolyType.ptSubject, true);
  const strokesPaths = ClipperLib.Clipper.PolyTreeToPaths(strokesUnion);
  diffClipper.AddPaths(strokesPaths, ClipperLib.PolyType.ptClip, true);

  const finalSolution = new ClipperLib.PolyTree();
  diffClipper.Execute(ClipperLib.ClipType.ctDifference, finalSolution, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  const finalMultiPoly: MultiPolygon = [];
  
  const addNodeToMultiPoly = (node: any) => {
    if (!node.IsHole()) {
      const poly: Polygon = [];
      const outerRing: Pair[] = node.Contour().map((pt: any) => [pt.X / CLIPPER_SCALE, pt.Y / CLIPPER_SCALE] as Pair);
      
      if (outerRing.length > 2) {
        if (THREE.ShapeUtils.isClockWise(outerRing.map(p => new THREE.Vector2(p[0], p[1])))) {
          outerRing.reverse();
        }
        poly.push(outerRing);
        
        node.Childs().forEach((holeNode: any) => {
          const holeRing: Pair[] = holeNode.Contour().map((pt: any) => [pt.X / CLIPPER_SCALE, pt.Y / CLIPPER_SCALE] as Pair);
          if (holeRing.length > 2) {
            if (!THREE.ShapeUtils.isClockWise(holeRing.map(p => new THREE.Vector2(p[0], p[1])))) {
              holeRing.reverse();
            }
            poly.push(holeRing);
          }
        });
        finalMultiPoly.push(poly);
      }
    }
    node.Childs().forEach((child: any) => addNodeToMultiPoly(child));
  };
  
  // @ts-ignore
  finalSolution.Childs().forEach((child: any) => addNodeToMultiPoly(child));

  const shapes = multiPolygonToShapes(finalMultiPoly);

  if (shapes.length > 0) {
    const id = `baseplate_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newItem = { id, color: new THREE.Color(0xffffff), colorHex: "ffffff", shapes };
    return { updatedShapes: [...shapesWithColors, newItem], newIds: [id] };
  }

  return null;
}

export async function absorbShards(
  shapesWithColors: ShapeItem[],
  selectedIds: string[],
  maxArea: number,
  onProgress: (msg: string) => void
): Promise<string[]> {
  const rootItems = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 0);
  if (rootItems.length === 0) return [];
  
  onProgress("Analyzing geometry...");
  await yieldThread();

  const rootBounds: THREE.Box2[] = [];
  rootItems.forEach(root => {
     const bounds = new THREE.Box2();
     root.shapes.forEach(shape => {
        const pts = shape.getPoints();
        if (pts.length > 2) {
           pts.forEach(p => bounds.expandByPoint(p));
        }
     });
     bounds.expandByScalar(0.01);
     rootBounds.push(bounds);
  });

  const shardsFound: string[] = [];
  shapesWithColors.forEach(item => {
    if (selectedIds.includes(item.id)) return;
    if (item.shapes.length === 0) return;
    
    let area = 0;
    const bounds = new THREE.Box2();
    let hasBounds = false;
    
    item.shapes.forEach(shape => {
      const pts = shape.getPoints();
      if (pts.length > 2) {
        area += THREE.ShapeUtils.area(pts);
        if (!hasBounds) {
          bounds.setFromPoints(pts);
          hasBounds = true;
        } else {
          pts.forEach(p => bounds.expandByPoint(p));
        }
      }
      shape.holes.forEach(hole => {
        const hPts = hole.getPoints();
        if (hPts.length > 2) area -= THREE.ShapeUtils.area(hPts);
      });
    });
    
    area = Math.abs(area);
    
    if (area <= maxArea) {
       for (const rb of rootBounds) {
         if (rb.intersectsBox(bounds)) {
           shardsFound.push(item.id);
           break;
         }
       }
    }
  });
  
  return shardsFound;
}

export async function smoothSelected(
  shapesWithColors: ShapeItem[],
  selectedIds: string[],
  amount: number,
  meshColorOverrides: Record<string, string>,
  onProgress: (msg: string) => void
): Promise<{ updatedShapes: ShapeItem[], newIds: string[] } | null> {
  const itemsToSmooth = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 0);
  if (itemsToSmooth.length === 0) return null;

  onProgress("Applying morphological smoothing...");
  await yieldThread();

  const scale = 10000;
  const amountScaled = amount * scale;
  const co = new ClipperLib.ClipperOffset();
  
  const newIds: string[] = [];
  const newItems: ShapeItem[] = [];
  const originalIdsToRemove = new Set<string>();

  itemsToSmooth.forEach((item, itemIndex) => {
    originalIdsToRemove.add(item.id);
    const originalColorHex = meshColorOverrides[item.id] || item.colorHex;

    const subjectPolygons: any[] = [];
    item.shapes.forEach(shape => {
      const points = shape.extractPoints(10).shape;
      if (points.length < 3) return;
      const clipperPath = points.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
      ClipperLib.Clipper.Orientation(clipperPath) ? null : clipperPath.reverse();
      subjectPolygons.push(clipperPath);
    });

    // @ts-ignore
    co.Clear();
    // @ts-ignore
    co.AddPaths(subjectPolygons, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    
    // @ts-ignore
    const shrunkTree = new ClipperLib.PolyTree();
    co.Execute(shrunkTree, -amountScaled);

    if (shrunkTree.ChildCount() > 0) {
       const shrunkPolygons: any[] = [];
       const getPolys = (node: any) => {
          if (!node.IsHole()) shrunkPolygons.push(node.Contour());
          node.Childs().forEach(getPolys);
       };
       shrunkTree.Childs().forEach(getPolys);

       // @ts-ignore
       co.Clear();
       // @ts-ignore
       co.AddPaths(shrunkPolygons, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
       
       // @ts-ignore
       const grownTree = new ClipperLib.PolyTree();
       co.Execute(grownTree, amountScaled);

       const shapes: THREE.Shape[] = [];
       const parsePolyNode = (node: any) => {
         if (!node.IsHole()) {
           const ring = node.Contour().map((p: any) => [p.X / scale, p.Y / scale]);
           if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
           if (ring.length >= 4) {
             const shape = new THREE.Shape();
             shape.moveTo(ring[0][0], ring[0][1]);
             for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
             shapes.push(shape);
           }
         }
         node.Childs().forEach((child: any) => {
           if (child.IsHole()) child.Childs().forEach(parsePolyNode);
         });
       };
       // @ts-ignore
       grownTree.Childs().forEach((child: any) => parsePolyNode(child));

       if (shapes.length > 0) {
         const id = `smoothed_${Date.now()}_${itemIndex}_${Math.random().toString(36).substring(2, 6)}`;
         newIds.push(id);
         newItems.push({ id, color: item.color, colorHex: originalColorHex, shapes });
       }
    }
  });

  const next = [...shapesWithColors];
  originalIdsToRemove.forEach(id => {
    const idx = next.findIndex(n => n.id === id);
    if (idx !== -1) next[idx] = { ...next[idx], shapes: [] };
  });
  next.push(...newItems);

  return { updatedShapes: next, newIds };
}

export async function expandSelected(
  shapesWithColors: ShapeItem[],
  selectedIds: string[],
  amount: number,
  meshColorOverrides: Record<string, string>,
  onProgress: (msg: string) => void
): Promise<{ updatedShapes: ShapeItem[], newIds: string[] } | null> {
  const itemsToExpand = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 0);
  if (itemsToExpand.length === 0) return null;

  onProgress("Expanding selected shapes to fill gaps...");
  await yieldThread();

  const scale = 10000;
  const amountScaled = amount * scale;
  const co = new ClipperLib.ClipperOffset();
  
  const newIds: string[] = [];
  const newItems: ShapeItem[] = [];
  const originalIdsToRemove = new Set<string>();

  itemsToExpand.forEach((item, itemIndex) => {
    originalIdsToRemove.add(item.id);
    const originalColorHex = meshColorOverrides[item.id] || item.colorHex;

    const subjectPolygons: any[] = [];
    item.shapes.forEach(shape => {
      const points = shape.extractPoints(10).shape;
      if (points.length < 3) return;
      const clipperPath = points.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
      ClipperLib.Clipper.Orientation(clipperPath) ? null : clipperPath.reverse();
      subjectPolygons.push(clipperPath);
    });

    // @ts-ignore
    co.Clear();
    // @ts-ignore
    co.AddPaths(subjectPolygons, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    
    // @ts-ignore
    const grownTree = new ClipperLib.PolyTree();
    co.Execute(grownTree, amountScaled);

    const shapes: THREE.Shape[] = [];
    const parsePolyNode = (node: any) => {
      if (!node.IsHole()) {
        const ring = node.Contour().map((p: any) => [p.X / scale, p.Y / scale]);
        if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
        if (ring.length >= 4) {
          const shape = new THREE.Shape();
          shape.moveTo(ring[0][0], ring[0][1]);
          for (let i = 1; i < ring.length; i++) shape.lineTo(ring[i][0], ring[i][1]);
          shapes.push(shape);
        }
      }
      node.Childs().forEach((child: any) => {
        if (child.IsHole()) child.Childs().forEach(parsePolyNode);
      });
    };
    // @ts-ignore
    grownTree.Childs().forEach((child: any) => parsePolyNode(child));

    if (shapes.length > 0) {
      const id = `expanded_${Date.now()}_${itemIndex}_${Math.random().toString(36).substring(2, 6)}`;
      newIds.push(id);
      newItems.push({ id, color: item.color, colorHex: originalColorHex, shapes });
    }
  });

  const next = [...shapesWithColors];
  originalIdsToRemove.forEach(id => {
    const idx = next.findIndex(n => n.id === id);
    if (idx !== -1) next[idx] = { ...next[idx], shapes: [] };
  });
  next.push(...newItems);

  return { updatedShapes: next, newIds };
}

export async function createUniformBorder(
  shapesWithColors: ShapeItem[],
  selectedIds: string[],
  widthAmount: number,
  borderMode: 'inner' | 'outer' | 'both' | 'custom',
  customColorHex: string | null,
  onProgress: (msg: string) => void
): Promise<{ updatedShapes: ShapeItem[], newIds: string[] } | null> {
  const itemsToBorder = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 0);
  if (itemsToBorder.length === 0) return null;

  onProgress("Calculating uniform border outline...");
  await yieldThread();

  const scale = 10000;
  const widthScaled = widthAmount * scale;
  const clipper = new ClipperLib.Clipper();
  
  itemsToBorder.forEach(item => {
    item.shapes.forEach(shape => {
      const polygon = shapeToPolygon(shape);
      for (let i = 0; i < polygon.length; i++) {
         const ring = polygon[i];
         if (ring.length < 3) continue;
         const clipperPath = ring.map(p => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));
         const isOuter = (i === 0);
         if (isOuter !== ClipperLib.Clipper.Orientation(clipperPath)) clipperPath.reverse();
         // @ts-ignore
         clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
      }
    });
  });

  // @ts-ignore
  const unionTree = new ClipperLib.PolyTree();
  // @ts-ignore
  clipper.Execute(ClipperLib.ClipType.ctUnion, unionTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  const unionPaths: any[] = [];
  const getPolys = (node: any) => {
     if (!node.IsHole()) unionPaths.push(node.Contour());
     node.Childs().forEach(getPolys);
  };
  unionTree.Childs().forEach(getPolys);

  const co = new ClipperLib.ClipperOffset();
  // @ts-ignore
  co.AddPaths(unionPaths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  
  // @ts-ignore
  const expandedTree = new ClipperLib.PolyTree();
  co.Execute(expandedTree, widthScaled);

  const borderClipper = new ClipperLib.Clipper();
  
  const expandedPaths: any[] = [];
  const getExpandedPolys = (node: any) => {
     expandedPaths.push(node.Contour());
     node.Childs().forEach(getExpandedPolys);
  };
  expandedTree.Childs().forEach(getExpandedPolys);
  // @ts-ignore
  borderClipper.AddPaths(expandedPaths, ClipperLib.PolyType.ptSubject, true);

  // @ts-ignore
  borderClipper.AddPaths(unionPaths, ClipperLib.PolyType.ptClip, true);

  // Calculate the raw border ring (expanded - original)
  const borderRingTree = new ClipperLib.PolyTree();
  // @ts-ignore
  borderClipper.Execute(ClipperLib.ClipType.ctDifference, borderRingTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  let finalTree = borderRingTree;

  if (borderMode === 'outer' || borderMode === 'inner' || borderMode === 'custom') {
     onProgress(borderMode === 'outer' ? "Removing internal adjacencies..." : "Processing adjacencies...");
     
     const otherPaths: any[] = [];
     shapesWithColors.forEach(item => {
       if (!selectedIds.includes(item.id)) {
         // In 'custom' mode, only include shapes of the target color
         if (borderMode === 'custom' && item.colorHex !== customColorHex) return;
         
         item.shapes.forEach(shape => {
           const polygon = shapeToPolygon(shape);
           for (let i = 0; i < polygon.length; i++) {
             const ring = polygon[i];
             if (ring.length < 3) continue;
             const clipperPath = ring.map(p => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));
             const isOuter = (i === 0);
             if (isOuter !== ClipperLib.Clipper.Orientation(clipperPath)) clipperPath.reverse();
             otherPaths.push(clipperPath);
           }
         });
       }
     });

     if (otherPaths.length > 0) {
       const getPaths = (tree: any): any[] => {
         const paths: any[] = [];
         const collect = (node: any) => {
            const contour = node.Contour();
            if (contour.length > 0) paths.push(contour);
            node.Childs().forEach(collect);
         };
         tree.Childs().forEach(collect);
         return paths;
       };

       const borderPaths = getPaths(borderRingTree);
       
       const modeClipper = new ClipperLib.Clipper();
       // @ts-ignore
       modeClipper.AddPaths(borderPaths, ClipperLib.PolyType.ptSubject, true);
       // @ts-ignore
       modeClipper.AddPaths(otherPaths, ClipperLib.PolyType.ptClip, true);
       
       finalTree = new ClipperLib.PolyTree();
       // In custom and inner modes, we use intersection. In outer mode, difference.
       const clipType = borderMode === 'outer' ? ClipperLib.ClipType.ctDifference : ClipperLib.ClipType.ctIntersection;
       // @ts-ignore
       modeClipper.Execute(clipType, finalTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
     }
  }

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

  const finalMultiPoly: MultiPolygon = [];
  // @ts-ignore
  finalTree.Childs().forEach((child: any) => parsePolyNode(child, finalMultiPoly));

  const shapes = multiPolygonToShapes(finalMultiPoly);

  if (shapes.length > 0) {
    const id = `border_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newItem = { id, color: itemsToBorder[0].color, colorHex: "000000", shapes };
    return { updatedShapes: [...shapesWithColors, newItem], newIds: [id] };
  }

  return null;
}

export async function getAdjacentColors(
  shapesWithColors: ShapeItem[],
  selectedIds: string[]
): Promise<string[]> {
  const itemsToBorder = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 0);
  if (itemsToBorder.length === 0) return [];

  const scale = 10000;
  const widthScaled = 2 * scale; // expand by 2 pixels to find adjacency

  // 1. Union selected shapes
  const clipper = new ClipperLib.Clipper();
  itemsToBorder.forEach(item => {
    item.shapes.forEach(shape => {
      const polygon = shapeToPolygon(shape);
      for (let i = 0; i < polygon.length; i++) {
         const ring = polygon[i];
         if (ring.length < 3) continue;
         const clipperPath = ring.map(p => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));
         const isOuter = (i === 0);
         if (isOuter !== ClipperLib.Clipper.Orientation(clipperPath)) clipperPath.reverse();
         // @ts-ignore
         clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
      }
    });
  });

  // @ts-ignore
  const unionTree = new ClipperLib.PolyTree();
  // @ts-ignore
  clipper.Execute(ClipperLib.ClipType.ctUnion, unionTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  const getPaths = (tree: any): any[] => {
    const paths: any[] = [];
    const collect = (node: any) => {
       const contour = node.Contour();
       if (contour.length > 0) paths.push(contour);
       node.Childs().forEach(collect);
    };
    tree.Childs().forEach(collect);
    return paths;
  };
  
  const unionPaths = getPaths(unionTree);

  // 2. Expand
  const co = new ClipperLib.ClipperOffset();
  // @ts-ignore
  co.AddPaths(unionPaths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  // @ts-ignore
  const expandedTree = new ClipperLib.PolyTree();
  co.Execute(expandedTree, widthScaled);
  const expandedPaths = getPaths(expandedTree);

  // 3. For every unselected shape, check intersection with expandedPaths
  const adjacentColors = new Set<string>();

  for (const item of shapesWithColors) {
    if (selectedIds.includes(item.id)) continue;
    if (adjacentColors.has(item.colorHex)) continue; // Already found

    const otherClipper = new ClipperLib.Clipper();
    // @ts-ignore
    otherClipper.AddPaths(expandedPaths, ClipperLib.PolyType.ptSubject, true);
    
    // add item paths
    let hasPaths = false;
    item.shapes.forEach(shape => {
      const polygon = shapeToPolygon(shape);
      for (let i = 0; i < polygon.length; i++) {
        const ring = polygon[i];
        if (ring.length < 3) continue;
        const clipperPath = ring.map(p => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));
        const isOuter = (i === 0);
        if (isOuter !== ClipperLib.Clipper.Orientation(clipperPath)) clipperPath.reverse();
        // @ts-ignore
        otherClipper.AddPath(clipperPath, ClipperLib.PolyType.ptClip, true);
        hasPaths = true;
      }
    });

    if (hasPaths) {
      // @ts-ignore
      const intersectionTree = new ClipperLib.PolyTree();
      // @ts-ignore
      otherClipper.Execute(ClipperLib.ClipType.ctIntersection, intersectionTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      if (getPaths(intersectionTree).length > 0) {
        adjacentColors.add(item.colorHex);
      }
    }
  }

  return Array.from(adjacentColors);
}

export async function splitDisjoint(
  shapesWithColors: ShapeItem[],
  selectedIds: string[],
  meshColorOverrides: Record<string, string>,
  onProgress: (msg: string) => void
): Promise<{ updatedShapes: ShapeItem[], newIds: string[] } | null> {
  const itemsToSplit = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 1);
  if (itemsToSplit.length === 0) return null;

  onProgress("Separating disjoint parts...");
  await yieldThread();

  const newIds: string[] = [];
  const newItems: ShapeItem[] = [];
  const originalIdsToRemove = new Set<string>();

  itemsToSplit.forEach((item, itemIndex) => {
    originalIdsToRemove.add(item.id);
    const originalColorHex = meshColorOverrides[item.id] || item.colorHex;
    
    item.shapes.forEach((shape, shapeIndex) => {
      const id = `split_${Date.now()}_${itemIndex}_${shapeIndex}_${Math.random().toString(36).substring(2, 6)}`;
      newIds.push(id);
      newItems.push({
        id,
        color: item.color,
        colorHex: originalColorHex,
        shapes: [shape]
      });
    });
  });

  const next = [...shapesWithColors];
  originalIdsToRemove.forEach(id => {
    const idx = next.findIndex(n => n.id === id);
    if (idx !== -1) next[idx] = { ...next[idx], shapes: [] };
  });
  next.push(...newItems);

  return { updatedShapes: next, newIds };
}

export async function fuseSelected(
  shapesWithColors: ShapeItem[],
  idsToFuse: string[],
  targetColorHex: string,
  forceMergeAll: boolean,
  meshColorOverrides: Record<string, string>,
  onProgress: (msg: string) => void
): Promise<{ updatedShapes: ShapeItem[], newIds: string[] } | null> {
  const itemsToFuse = shapesWithColors.filter(item => idsToFuse.includes(item.id) && item.shapes.length > 0);
  if (itemsToFuse.length === 0) return null;

  onProgress(forceMergeAll ? "Absorbing shards into main shape..." : "Extracting geometry...");
  await yieldThread();

  const scale = 10000;
  const clipper = new ClipperLib.Clipper();
  
  const unconsumedItems = new Set<{id: string, area: number, bounds: THREE.Box2, item: any}>();
  itemsToFuse.forEach(item => {
    let totalArea = 0;
    let bounds = new THREE.Box2();
    let hasBounds = false;
    
    item.shapes.forEach(shape => {
      const points = shape.getPoints();
      if (points.length > 2) {
        totalArea += THREE.ShapeUtils.area(points);
        if (!hasBounds) {
          bounds.setFromPoints(points);
          hasBounds = true;
        } else {
          points.forEach(p => bounds.expandByPoint(p));
        }
      }
      shape.holes.forEach(hole => {
        const hPoints = hole.getPoints();
        if (hPoints.length > 2) totalArea -= THREE.ShapeUtils.area(hPoints);
      });
      
      const polygon = shapeToPolygon(shape);
      for (let i = 0; i < polygon.length; i++) {
         const ring = polygon[i];
         if (ring.length < 3) continue;
         const clipperPath = ring.map(p => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));
         const isOuter = (i === 0);
         if (isOuter !== ClipperLib.Clipper.Orientation(clipperPath)) clipperPath.reverse();
         // @ts-ignore
         clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
      }
    });
    
    unconsumedItems.add({ id: item.id, item, area: Math.abs(totalArea), bounds });
  });

  onProgress("Mathematically fusing shapes...");
  await yieldThread();

  // @ts-ignore
  const solutionTree = new ClipperLib.PolyTree();
  // @ts-ignore
  clipper.Execute(ClipperLib.ClipType.ctUnion, solutionTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  onProgress("Rebuilding fused meshes...");
  await yieldThread();

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

  const newIds: string[] = [];
  const newItems: ShapeItem[] = [];
  const targetItem = itemsToFuse.find(i => (meshColorOverrides[i.id] || i.colorHex) === targetColorHex) || itemsToFuse[0];

  if (forceMergeAll) {
     const allShapes: THREE.Shape[] = [];
     // @ts-ignore
     solutionTree.Childs().forEach((child: any) => {
        const individualMultiPoly: MultiPolygon = [];
        parsePolyNode(child, individualMultiPoly);
        allShapes.push(...multiPolygonToShapes(individualMultiPoly));
     });

     if (allShapes.length > 0) {
        const id = `fused_${Date.now()}_force`;
        newIds.push(id);
        newItems.push({ id, color: targetItem.color, colorHex: targetColorHex, shapes: allShapes });
     }
     unconsumedItems.clear();
  } else {
    // @ts-ignore
    solutionTree.Childs().forEach((child: any, childIndex: number) => {
      const individualMultiPoly: MultiPolygon = [];
      parsePolyNode(child, individualMultiPoly);
      const shapes = multiPolygonToShapes(individualMultiPoly);
      
      let childArea = 0;
      let childBounds = new THREE.Box2();
      let hasBounds = false;
      
      shapes.forEach(shape => {
        const points = shape.getPoints();
        if (points.length > 2) {
          childArea += THREE.ShapeUtils.area(points);
          if (!hasBounds) {
            childBounds.setFromPoints(points);
            hasBounds = true;
          } else {
            points.forEach(p => childBounds.expandByPoint(p));
          }
        }
        shape.holes.forEach(hole => {
          const hPoints = hole.getPoints();
          if (hPoints.length > 2) childArea -= THREE.ShapeUtils.area(hPoints);
        });
      });
      
      childArea = Math.abs(childArea);
      
      let matchedIsolatedItem = null;
      const expandedChildBounds = childBounds.clone().expandByScalar(0.01);
      
      for (const unconsumed of Array.from(unconsumedItems)) {
        if (expandedChildBounds.intersectsBox(unconsumed.bounds)) {
          const diffRatio = Math.abs(unconsumed.area - childArea) / Math.max(unconsumed.area, 0.00001);
          if (diffRatio < 0.005) {
            matchedIsolatedItem = unconsumed;
            break;
          }
        }
      }
      
      if (matchedIsolatedItem) {
         unconsumedItems.delete(matchedIsolatedItem);
      } else {
        const id = `fused_${Date.now()}_${childIndex}_${Math.random().toString(36).substring(2, 6)}`;
        newIds.push(id);
        newItems.push({ id, color: targetItem.color, colorHex: targetColorHex, shapes });
      }
    });
  }

  if (newItems.length > 0) {
    const next = [...shapesWithColors];
    if (forceMergeAll) {
       itemsToFuse.forEach(item => {
         const itemIdx = next.findIndex(n => n.id === item.id);
         if (itemIdx !== -1) next[itemIdx] = { ...next[itemIdx], shapes: [] };
       });
    } else {
       Array.from(unconsumedItems).forEach(unconsumed => {
         const itemIdx = next.findIndex(n => n.id === unconsumed.item.id);
         if (itemIdx !== -1) next[itemIdx] = { ...next[itemIdx], shapes: [] };
       });
    }
    next.push(...newItems);
    return { updatedShapes: next, newIds };
  }
  return newIds.length > 0 ? { updatedShapes: shapesWithColors, newIds } : null;
}

export async function generateUniformLineArt(
  shapesWithColors: ShapeItem[],
  widthAmount: number,
  lightShapeIds: string[],
  darkShapeIds: string[],
  onProgress: (msg: string) => void
): Promise<{ updatedShapes: ShapeItem[], newIds: string[] } | null> {
  if (shapesWithColors.length === 0) return null;

  onProgress("Generating uniform line art...");
  await yieldThread();

  const scale = 10000;
  const widthScaled = (widthAmount / 2) * scale;

  // Collect all paths from a PolyTree (outers + holes with their native winding)
  const getPaths = (tree: any): any[] => {
    const paths: any[] = [];
    const collect = (node: any) => {
       const contour = node.Contour();
       if (contour.length > 0) paths.push(contour);
       node.Childs().forEach(collect);
    };
    tree.Childs().forEach(collect);
    return paths;
  };

  // --- Step 1: Expand each light shape outward ---
  const expandedLightShapes: any[][][] = [];

  shapesWithColors.forEach(item => {
    if (!lightShapeIds.includes(item.id)) return;
    
    item.shapes.forEach(shape => {
      const polygon = shapeToPolygon(shape);
      const co = new ClipperLib.ClipperOffset();
      let hasValidRings = false;
      for (let i = 0; i < polygon.length; i++) {
         const ring = polygon[i];
         if (ring.length < 3) continue;
         hasValidRings = true;
         const clipperPath = ring.map(p => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));
         const isOuter = (i === 0);
         if (isOuter !== ClipperLib.Clipper.Orientation(clipperPath)) clipperPath.reverse();
         co.AddPath(clipperPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
      }
      if (hasValidRings) {
        const tree = new ClipperLib.PolyTree();
        co.Execute(tree, widthScaled);
        const paths = getPaths(tree);
        if (paths.length > 0) expandedLightShapes.push(paths);
      }
    });
  });

  // --- Step 2: Find overlaps between expanded light shapes (= color separation borders) ---
  const processShapes = (shapes: any[][][]): { union: any[], overlaps: any[] } => {
      if (shapes.length === 0) return { union: [], overlaps: [] };
      if (shapes.length === 1) return { union: shapes[0], overlaps: [] };
      if (shapes.length === 2) {
          const cUnion = new ClipperLib.Clipper();
          cUnion.AddPaths(shapes[0], ClipperLib.PolyType.ptSubject, true);
          cUnion.AddPaths(shapes[1], ClipperLib.PolyType.ptClip, true);
          const tUnion = new ClipperLib.PolyTree();
          cUnion.Execute(ClipperLib.ClipType.ctUnion, tUnion, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
          
          const cInt = new ClipperLib.Clipper();
          cInt.AddPaths(shapes[0], ClipperLib.PolyType.ptSubject, true);
          cInt.AddPaths(shapes[1], ClipperLib.PolyType.ptClip, true);
          const tInt = new ClipperLib.PolyTree();
          cInt.Execute(ClipperLib.ClipType.ctIntersection, tInt, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
          
          return { union: getPaths(tUnion), overlaps: getPaths(tInt) };
      }
      
      const mid = Math.floor(shapes.length / 2);
      const left = processShapes(shapes.slice(0, mid));
      const right = processShapes(shapes.slice(mid));
      
      const cUnion = new ClipperLib.Clipper();
      cUnion.AddPaths(left.union, ClipperLib.PolyType.ptSubject, true);
      cUnion.AddPaths(right.union, ClipperLib.PolyType.ptClip, true);
      const tUnion = new ClipperLib.PolyTree();
      cUnion.Execute(ClipperLib.ClipType.ctUnion, tUnion, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      
      const cInt = new ClipperLib.Clipper();
      cInt.AddPaths(left.union, ClipperLib.PolyType.ptSubject, true);
      cInt.AddPaths(right.union, ClipperLib.PolyType.ptClip, true);
      const tInt = new ClipperLib.PolyTree();
      cInt.Execute(ClipperLib.ClipType.ctIntersection, tInt, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      
      const cOverUnion1 = new ClipperLib.Clipper();
      cOverUnion1.AddPaths(left.overlaps, ClipperLib.PolyType.ptSubject, true);
      cOverUnion1.AddPaths(right.overlaps, ClipperLib.PolyType.ptClip, true);
      const tOver1 = new ClipperLib.PolyTree();
      cOverUnion1.Execute(ClipperLib.ClipType.ctUnion, tOver1, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      
      const cOverUnion2 = new ClipperLib.Clipper();
      cOverUnion2.AddPaths(getPaths(tOver1), ClipperLib.PolyType.ptSubject, true);
      cOverUnion2.AddPaths(getPaths(tInt), ClipperLib.PolyType.ptClip, true);
      const tOver2 = new ClipperLib.PolyTree();
      cOverUnion2.Execute(ClipperLib.ClipType.ctUnion, tOver2, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
      
      return { union: getPaths(tUnion), overlaps: getPaths(tOver2) };
  };

  const result = processShapes(expandedLightShapes);

  // --- Step 3: Subtract existing dark shapes to avoid double-bordering ---
  // Collect all dark shape paths as clip geometry
  const darkPaths: any[] = [];
  shapesWithColors.forEach(item => {
    if (!darkShapeIds.includes(item.id)) return;
    item.shapes.forEach(shape => {
      const polygon = shapeToPolygon(shape);
      for (let i = 0; i < polygon.length; i++) {
        const ring = polygon[i];
        if (ring.length < 3) continue;
        const clipperPath = ring.map(p => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));
        const isOuter = (i === 0);
        if (isOuter !== ClipperLib.Clipper.Orientation(clipperPath)) clipperPath.reverse();
        darkPaths.push(clipperPath);
      }
    });
  });

  let finalTree = new ClipperLib.PolyTree();

  if (result.overlaps.length > 0) {
    // First union all overlaps
    const overlapClipper = new ClipperLib.Clipper();
    overlapClipper.AddPaths(result.overlaps, ClipperLib.PolyType.ptSubject, true);

    if (darkPaths.length > 0) {
      // Subtract dark shapes from the generated borders
      overlapClipper.AddPaths(darkPaths, ClipperLib.PolyType.ptClip, true);
      overlapClipper.Execute(ClipperLib.ClipType.ctDifference, finalTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    } else {
      overlapClipper.Execute(ClipperLib.ClipType.ctUnion, finalTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    }
  }

  // --- Step 4: Subtract the line art from all light shapes to "cut the model" ---
  const lineArtPaths = getPaths(finalTree);
  let updatedShapesWithColors = shapesWithColors;

  const minAreaScaled = 50 * scale * scale;

  const parsePolyNode = (node: any, multiPoly: MultiPolygon) => {
    if (!node.IsHole()) {
      const contour = node.Contour();
      const area = Math.abs(ClipperLib.Clipper.Area(contour));
      if (area < minAreaScaled) return; // Skip tiny artifacts

      const ring = contour.map((p: any) => [p.X / scale, p.Y / scale]);
      if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([...ring[0]]);
      if (ring.length >= 4) {
        const poly = [ring];
        node.Childs().forEach((child: any) => {
          const holeRing = child.Contour().map((p: any) => [p.X / scale, p.Y / scale]);
          if (holeRing.length > 0 && (holeRing[0][0] !== holeRing[holeRing.length - 1][0] || holeRing[0][1] !== holeRing[holeRing.length - 1][1])) holeRing.push([...holeRing[0]]);
          if (holeRing.length >= 4) poly.push(holeRing);
          child.Childs().forEach((nestedNode: any) => parsePolyNode(nestedNode, multiPoly));
        });
        multiPoly.push(poly);
      }
    }
  };

  if (lineArtPaths.length > 0) {
      updatedShapesWithColors = shapesWithColors.map(item => {
         if (!lightShapeIds.includes(item.id)) return item;
         
         const clipper = new ClipperLib.Clipper();
         let hasSubject = false;
         item.shapes.forEach(shape => {
             const polygon = shapeToPolygon(shape);
             for (let i = 0; i < polygon.length; i++) {
                 const ring = polygon[i];
                 if (ring.length < 3) continue;
                 const clipperPath = ring.map(p => ({ X: Math.round(p[0] * scale), Y: Math.round(p[1] * scale) }));
                 const isOuter = (i === 0);
                 if (isOuter !== ClipperLib.Clipper.Orientation(clipperPath)) clipperPath.reverse();
                 // @ts-ignore
                 clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
                 hasSubject = true;
             }
         });
         
         if (!hasSubject) return item;
         
         // @ts-ignore
         clipper.AddPaths(lineArtPaths, ClipperLib.PolyType.ptClip, true);
         // @ts-ignore
         const clippedTree = new ClipperLib.PolyTree();
         // @ts-ignore
         clipper.Execute(ClipperLib.ClipType.ctDifference, clippedTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
         
         const multiPoly: MultiPolygon = [];
         // @ts-ignore
         clippedTree.Childs().forEach((child: any) => parsePolyNode(child, multiPoly));
         return { ...item, shapes: multiPolygonToShapes(multiPoly) };
      });
  }

  // --- Step 5: Convert to shapes, filtering out tiny artifacts ---
  const finalMultiPoly: MultiPolygon = [];
  // @ts-ignore
  finalTree.Childs().forEach((child: any) => parsePolyNode(child, finalMultiPoly));

  const shapes = multiPolygonToShapes(finalMultiPoly);

  if (shapes.length > 0) {
    const id = `lineart_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newItem = { id, color: new THREE.Color(0x000000), colorHex: "000000", shapes };
    return { updatedShapes: [...updatedShapesWithColors, newItem], newIds: [id] };
  }

  return null;
}

