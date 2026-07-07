import React from 'react';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import * as ClipperLib from 'clipper-lib';
import type { PrintPlate, PrintItem } from '../lib/generic-3mf-exporter';
import { buildMultiPlate3MF } from '../lib/generic-3mf-exporter';
import { useLoader } from '@react-three/fiber';

// --- HELPER TYPES FOR POLYGON CLIPPING ---
type Pair = [number, number];
type Ring = Pair[];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

function shapeToPolygon(shape: THREE.Shape): Polygon {
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

function multiPolygonToShapes(multiPoly: MultiPolygon): THREE.Shape[] {
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

// --- MAIN COMPONENT ---

export interface SvgModelProps {
  svgUrl: string;
  selectByColor: boolean;
  sealGaps?: boolean;
  cutOverlaps?: boolean;
  highlightStyle?: 'dashed' | 'solid';
  selectedMeshIds: string[];
  meshDepths: Record<string, number>;
  meshColorOverrides: Record<string, string>;
  onSelect: (ids: string[], multi: boolean) => void;
  onVerticesCalculated?: (count: number) => void;
  onParseProgress?: (msg: string | null) => void;
  onParseComplete?: (extractedColors: { id: string, colorHex: string }[]) => void;
  previewMeshIds?: string[];
}

export interface SvgModelRef {
  fuseSelected: (idsToFuse: string[], targetColorHex: string, forceMergeAll: boolean, onProgress: (msg: string) => void) => Promise<string[] | null>;
  absorbShards: (selectedIds: string[], maxArea: number, onProgress: (msg: string) => void) => Promise<string[]>;
  smoothSelected: (selectedIds: string[], amount: number, onProgress: (msg: string) => void) => Promise<string[] | null>;
  splitDisjoint: (selectedIds: string[], onProgress: (msg: string) => void) => Promise<string[] | null>;
  expandSelected: (selectedIds: string[], amount: number, onProgress: (msg: string) => void) => Promise<string[] | null>;
  sliceAndExport: (buildPlateSize: number, gridSize: string, printerModel: string, mergeByColor: boolean, customScale: number, clearance: number, scaleZProportionally: boolean, onProgress: (msg: string) => void) => Promise<Blob | null>;
  getShapes: () => { id: string; color: THREE.Color; colorHex: string; shapes: THREE.Shape[] }[];
  setShapes: (shapes: { id: string; color: THREE.Color; colorHex: string; shapes: THREE.Shape[] }[]) => void;
}

const DashedEdges = ({ shapes, color, depth }: { shapes: THREE.Shape[], color: string, depth: number }) => {
  const lineRef = React.useRef<THREE.LineSegments>(null);
  
  const edgesGeometry = React.useMemo(() => {
    const points: THREE.Vector3[] = [];
    shapes.forEach(shape => {
      // get outer points
      const shapePoints = shape.getPoints();
      for (let i = 0; i < shapePoints.length; i++) {
        const p1 = shapePoints[i];
        const p2 = shapePoints[(i + 1) % shapePoints.length];
        points.push(new THREE.Vector3(p1.x, p1.y, depth + 0.1));
        points.push(new THREE.Vector3(p2.x, p2.y, depth + 0.1));
      }
      
      // get hole points
      shape.holes.forEach(hole => {
        const holePoints = hole.getPoints();
        for (let i = 0; i < holePoints.length; i++) {
          const p1 = holePoints[i];
          const p2 = holePoints[(i + 1) % holePoints.length];
          points.push(new THREE.Vector3(p1.x, p1.y, depth + 0.1));
          points.push(new THREE.Vector3(p2.x, p2.y, depth + 0.1));
        }
      });
    });
    
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [shapes, depth]);

  React.useLayoutEffect(() => {
    if (lineRef.current) {
      lineRef.current.computeLineDistances();
    }
  }, [edgesGeometry]);

  return (
    <lineSegments ref={lineRef} geometry={edgesGeometry}>
      <lineDashedMaterial color={color} dashSize={0.5} gapSize={0.5} linewidth={2} depthTest={false} />
    </lineSegments>
  );
};

const createStripeTexture = (color: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 128, 128);
    ctx.lineWidth = 16;
    ctx.strokeStyle = color;
    for(let i = -128; i < 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 128);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.05, 0.05);
  return tex;
};

const whiteStripes = createStripeTexture('rgba(255,255,255,0.7)');
const blackStripes = createStripeTexture('rgba(0,0,0,0.5)');

export const SvgModel = React.forwardRef<SvgModelRef, SvgModelProps>(({
  svgUrl, selectByColor, sealGaps, cutOverlaps, highlightStyle = 'dashed', selectedMeshIds, previewMeshIds = [], meshDepths, meshColorOverrides = {}, onSelect, onVerticesCalculated, onParseProgress, onParseComplete
}, ref) => {
  const svgData = useLoader(SVGLoader, svgUrl);
  const groupRef = React.useRef<THREE.Group>(null);

  const [shapesWithColors, setShapesWithColors] = React.useState<{ id: string; color: THREE.Color; colorHex: string; shapes: THREE.Shape[] }[]>([]);

  React.useImperativeHandle(ref, () => ({
    getShapes: () => shapesWithColors,
    setShapes: (newShapes) => setShapesWithColors(newShapes),
    
    
    absorbShards: async (selectedIds: string[], maxArea: number, onProgress: (msg: string) => void) => {
      const rootItems = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 0);
      if (rootItems.length === 0) return [];
      
      onProgress("Analyzing geometry...");
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

      // Extract bounds of roots
      const rootBounds: THREE.Box2[] = [];
      rootItems.forEach(root => {
         const bounds = new THREE.Box2();
         root.shapes.forEach(shape => {
            const pts = shape.getPoints();
            if (pts.length > 2) {
               pts.forEach(p => bounds.expandByPoint(p));
            }
         });
         // expand bounds slightly to catch touching things
         bounds.expandByScalar(0.01);
         rootBounds.push(bounds);
      });

      // Find shards that are touching root bounds and smaller than maxArea
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
           // Check if it touches any root bounds
           for (const rb of rootBounds) {
             if (rb.intersectsBox(bounds)) {
               shardsFound.push(item.id);
               break;
             }
           }
        }
      });
      
      return shardsFound;
    },
smoothSelected: async (selectedIds: string[], amount: number, onProgress: (msg: string) => void) => {
      const itemsToSmooth = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 0);
      if (itemsToSmooth.length === 0) return null;

      onProgress("Applying morphological smoothing...");
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

      const scale = 10000;
      const amountScaled = amount * scale;
      const co = new ClipperLib.ClipperOffset();
      
      const newIds: string[] = [];
      const newItems: any[] = [];
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
        
        // Shrink
        // @ts-ignore
        const shrunkTree = new ClipperLib.PolyTree();
        co.Execute(shrunkTree, -amountScaled);

        if (shrunkTree.ChildCount() > 0) {
           // Grow
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

      setShapesWithColors(prev => {
        const next = [...prev];
        originalIdsToRemove.forEach(id => {
          const idx = next.findIndex(n => n.id === id);
          if (idx !== -1) next[idx] = { ...next[idx], shapes: [] };
        });
        next.push(...newItems);
        return next;
      });

      return newIds;
    },
    expandSelected: async (selectedIds: string[], amount: number, onProgress: (msg: string) => void) => {
      const itemsToExpand = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 0);
      if (itemsToExpand.length === 0) return null;

      onProgress("Expanding selected shapes to fill gaps...");
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

      const scale = 10000;
      const amountScaled = amount * scale;
      const co = new ClipperLib.ClipperOffset();
      
      const newIds: string[] = [];
      const newItems: any[] = [];
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
        
        // Grow
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

      setShapesWithColors(prev => {
        const next = [...prev];
        originalIdsToRemove.forEach(id => {
          const idx = next.findIndex(n => n.id === id);
          if (idx !== -1) next[idx] = { ...next[idx], shapes: [] };
        });
        next.push(...newItems);
        return next;
      });

      return newIds;
    },
    splitDisjoint: async (selectedIds: string[], onProgress: (msg: string) => void) => {
      const itemsToSplit = shapesWithColors.filter(item => selectedIds.includes(item.id) && item.shapes.length > 1);
      if (itemsToSplit.length === 0) return null;

      onProgress("Separating disjoint parts...");
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

      const newIds: string[] = [];
      const newItems: any[] = [];
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

      setShapesWithColors(prev => {
        const next = [...prev];
        originalIdsToRemove.forEach(id => {
          const idx = next.findIndex(n => n.id === id);
          if (idx !== -1) next[idx] = { ...next[idx], shapes: [] };
        });
        next.push(...newItems);
        return next;
      });

      return newIds;
    },
    fuseSelected: async (idsToFuse: string[], targetColorHex: string, forceMergeAll: boolean = false, onProgress: (msg: string) => void) => {
      const itemsToFuse = shapesWithColors.filter(item => idsToFuse.includes(item.id) && item.shapes.length > 0);
      if (itemsToFuse.length === 0) return null;

      onProgress(forceMergeAll ? "Absorbing shards into main shape..." : "Extracting geometry...");
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

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
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

      // @ts-ignore
      const solutionTree = new ClipperLib.PolyTree();
      // @ts-ignore
      clipper.Execute(ClipperLib.ClipType.ctUnion, solutionTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

      onProgress("Rebuilding fused meshes...");
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

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
      const newItems: any[] = [];
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
        setShapesWithColors(prev => {
          const next = [...prev];
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
          return next;
        });
      }
      return newIds.length > 0 ? newIds : null;
    },
    sliceAndExport: async (buildPlateSize: number, gridSize: string, printerModel: string, mergeByColor: boolean, customScale: number, clearance: number, scaleZProportionally: boolean, onProgress: (msg: string) => void) => {
      if (shapesWithColors.length === 0) return null;

      onProgress("Analyzing model dimensions...");
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

      // 1. Calculate raw SVG bounding box
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

        // Cap at 2x2 max
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

      // Final physical size of the SVG
      const finalPhysicalWidth = rawWidth * 0.1 * scaleFactor;
      const finalPhysicalHeight = rawHeight * 0.1 * scaleFactor;

      // Offset to center the SVG on the logical grid
      const gridPhysicalWidth = gridCols * buildPlateSize;
      const gridPhysicalHeight = gridRows * buildPlateSize;
      const offsetX = (gridPhysicalWidth - finalPhysicalWidth) / 2;
      const offsetY = (gridPhysicalHeight - finalPhysicalHeight) / 2;

      // Size of each grid cell in raw SVG space
      const cellSvgWidth = buildPlateSize / (0.1 * scaleFactor);
      const cellSvgHeight = buildPlateSize / (0.1 * scaleFactor);

      // Svg offset
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
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

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
          await new Promise(res => requestAnimationFrame(() => setTimeout(res, 0)));

          // Calculate clip rectangle in SVG coordinate space
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
              let geom: THREE.BufferGeometry;
              if (depth === 0) {
                geom = new THREE.ShapeGeometry(clippedShapes);
              } else {
                geom = new THREE.ExtrudeGeometry(clippedShapes, {
                  depth,
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
                  mergedItems.push({ geometry: geoms[0], colorHex: hex, name: `ColorGroup_${hex}` });
                } else {
                  try {
                    // Robust position-only manual merge for 3MF!
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
                    mergedItems.push({ geometry: mergedGeo, colorHex: hex, name: `ColorGroup_${hex}` });
                  } catch (err) {
                    console.error("Failed to merge geometries for color", hex, err);
                    // Fallback to unmerged
                    geoms.forEach((g, idx) => mergedItems.push({ geometry: g, colorHex: hex, name: `ColorGroup_${hex}_${idx}` }));
                  }
                }
              });
            } else {
              mergedItems = itemsForPlate;
            }

            plates.push({
              name: `Plate_R${r + 1}_C${c + 1}`,
              items: mergedItems
            });
          }
        }
      }

      onProgress("Assembling 3MF archive...");
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

      if (plates.length > 0) {
        return await buildMultiPlate3MF(plates, {
          printerModel,
          groupIntoOneObject: mergeByColor
        });
      }
      return null;
    }
  }), [shapesWithColors, meshDepths, meshColorOverrides, sealGaps]);

  React.useEffect(() => {
    if (shapesWithColors.length > 0 && onParseComplete) {
      onParseComplete(shapesWithColors.map(s => ({ id: s.id, colorHex: s.colorHex })));
    }
  }, [shapesWithColors]);

  React.useEffect(() => {
    if (!svgData) return;

    let isMounted = true;

    const processGeometry = async () => {
      try {
        // Guarantee a frame render by combining requestAnimationFrame and setTimeout
        const yieldThread = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

        // 1. Convert all SVG paths into MultiPolygons and clean them up
        const layerPolygons: MultiPolygon[] = [];
        const layerBBoxes: { minX: number, minY: number, maxX: number, maxY: number }[] = [];

        // Helper to compute bounding box
        const getBoundingBox = (multiPoly: MultiPolygon) => {
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

        const boxesIntersect = (b1: ReturnType<typeof getBoundingBox>, b2: ReturnType<typeof getBoundingBox>) => {
          return !(b2.minX > b1.maxX || b2.maxX < b1.minX || b2.minY > b1.maxY || b2.maxY < b1.minY);
        };

        const performClipperBoolean = (subjMultiPoly: MultiPolygon, clipMultiPolys: MultiPolygon[], clipType: number): MultiPolygon => {
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

        const newSvgDataPaths: any[] = [];
        const processedNodes = new Set();

        if (onParseProgress) onParseProgress("Step 1/3: Extracting SVG layers...");
        await yieldThread();

        let pathIndex = 0;
        for (const path of svgData.paths) {
          if (!isMounted) return;
          pathIndex++;

          if (onParseProgress && pathIndex % Math.max(1, Math.floor(svgData.paths.length / 10)) === 0) {
            onParseProgress(`Step 2/3: Converting shapes (${pathIndex}/${svgData.paths.length})...`);
            await yieldThread();
          }

          const node = path.userData?.node;
          if (node && processedNodes.has(node)) continue;
          if (node) processedNodes.add(node);

          // Process STROKE geometry natively via Polygon Buffering!
          let strokeColor = (path.userData?.style as any)?.stroke;
          if (strokeColor === 'currentColor') strokeColor = '#000000';
          let rawStrokeWidth = (path.userData?.style as any)?.strokeWidth;
          const strokeWidth = (rawStrokeWidth !== undefined && rawStrokeWidth !== null) ? parseFloat(rawStrokeWidth.toString()) : 1;

          if (strokeColor !== undefined && strokeColor !== 'none' && !isNaN(strokeWidth) && strokeWidth > 0) {
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

            if (solutionTree.ChildCount() > 0) {
              let strokeMultiPoly: MultiPolygon = [];

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

              if (strokeMultiPoly.length > 0) {
                layerPolygons.push(strokeMultiPoly);
                layerBBoxes.push(getBoundingBox(strokeMultiPoly));
                const strokePath = Object.assign(Object.create(Object.getPrototypeOf(path)), path);
                strokePath.color = new THREE.Color().setStyle(strokeColor);
                newSvgDataPaths.push(strokePath);
              }
            }
          }

          // Process FILL geometry
          let fillColor = (path.userData?.style as any)?.fill;
          if (fillColor === 'currentColor') fillColor = '#000000';
          if (fillColor !== undefined && fillColor !== 'none') {
            // @ts-ignore
            const shapes = path.toShapes(true);
            let multiPoly: MultiPolygon = shapes.map(shapeToPolygon);

            if (multiPoly.length > 0) {
              layerPolygons.push(multiPoly);
              layerBBoxes.push(getBoundingBox(multiPoly));
              const fillPath = Object.assign(Object.create(Object.getPrototypeOf(path)), path);
              fillPath.color = new THREE.Color().setStyle(fillColor);
              newSvgDataPaths.push(fillPath);
            }
          }
        }

        if (!isMounted) return;
        svgData.paths = newSvgDataPaths;

        const finalizePolygons = (finalPolys: MultiPolygon[]) => {
          const individualShapes: { id: string, color: THREE.Color, colorHex: string, shapes: THREE.Shape[] }[] = [];

          finalPolys.forEach((multiPoly, index) => {
            if (multiPoly.length === 0) return;
            const color = svgData.paths[index].color;
            const colorHex = color.getHexString();
            const shapes = multiPolygonToShapes(multiPoly);
            individualShapes.push({ id: `shape_${index}`, color, colorHex, shapes });
          });

          setShapesWithColors(individualShapes);

          if (onParseComplete) {
            onParseComplete(individualShapes.map(item => ({
              id: item.id,
              colorHex: item.colorHex
            })));
          }
        };

        if (!cutOverlaps) {
          finalizePolygons(layerPolygons);
          return;
        }

        // Asynchronous Boolean Subtraction Loop
        const finalPolygons: MultiPolygon[] = [];

        for (let i = 0; i < layerPolygons.length; i++) {
          if (!isMounted) return;

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
            // Passing all 8000 to Clipper at once causes exponential slowdowns.
            // Processing 1 at a time is too slow. 50 is the sweet spot for performance!
            const chunkSize = 50;
            for (let k = 0; k < overlappingAbovePolys.length; k += chunkSize) {
              if (!isMounted) return;
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

        if (!isMounted) return;
        finalizePolygons(finalPolygons);

      } catch (e) {
        console.error("Error during parse step", e);
        if (onParseComplete) onParseComplete([]);
      }
    };

    processGeometry();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgData]);

  React.useEffect(() => {
    if (groupRef.current && onVerticesCalculated) {
      let vertices = 0;
      groupRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const geom = (child as THREE.Mesh).geometry;
          if (geom && geom.attributes.position) {
            vertices += geom.attributes.position.count;
          }
        }
      });
      onVerticesCalculated(vertices);
    }
  }, [shapesWithColors, onVerticesCalculated, meshDepths]);

  return (
    <group ref={groupRef} scale={[0.1, -0.1, 0.1]} position={[-5, 5, 0]}>
      {shapesWithColors.map((item, index) => {
        if (!item.shapes || item.shapes.length === 0) return null;

        const isSelected = selectedMeshIds.includes(item.id);

        // Apply color overrides if they exist
        const overriddenHex = meshColorOverrides[item.id];
        const baseColorHex = overriddenHex ?? item.colorHex;
        const baseColor = overriddenHex ? new THREE.Color(`#${overriddenHex}`) : item.color;

        const getLuminance = (hex: string) => {
          const rgb = parseInt(hex.replace('#', ''), 16);
          const r = (rgb >> 16) & 0xff;
          const g = (rgb >> 8) & 0xff;
          const b = (rgb >> 0) & 0xff;
          return 0.299 * r + 0.587 * g + 0.114 * b;
        };
        const isLight = getLuminance(baseColorHex) > 180;
        const contrastColor = isLight ? "black" : "white";

        const depth = meshDepths[item.id] ?? 0;

        // Base offset to prevent z-fighting (still slightly useful even after boolean subtraction due to precision issues)
        const baseZOffset = index * 0.001;
        // If selected, add an offset larger than the maximum possible base offset so it jumps to the front
        const selectedZOffset = shapesWithColors.length * 0.001 + 0.1;
        const isPreviewed = previewMeshIds.includes(item.id);
        const zPosition = (isSelected || isPreviewed) ? baseZOffset + selectedZOffset : baseZOffset;

        if (!item.shapes || item.shapes.length === 0) return null;

        return (
          <mesh
            key={item.id}
            position={[0, 0, zPosition]}
            userData={{ originalColorHex: baseColorHex, originalZPosition: baseZOffset }}
            onClick={(e) => {
              e.stopPropagation();
              const ids = selectByColor
                ? shapesWithColors.filter(it => (meshColorOverrides[it.id] ?? it.colorHex) === baseColorHex).map(it => it.id)
                : [item.id];
              onSelect(ids, e.shiftKey);
            }}
          >
            {depth === 0 ? (
              <shapeGeometry args={[item.shapes]} />
            ) : (
              <extrudeGeometry
                key={`extrude-${sealGaps}-${depth}`}
                args={[item.shapes, {
                  depth,
                  bevelEnabled: sealGaps,
                  bevelSize: sealGaps ? 0.2 : 0,
                  bevelThickness: sealGaps ? 0.05 : 0,
                  bevelSegments: sealGaps ? 1 : 0
                }]}
              />
            )}
            <meshStandardMaterial
              color={baseColor}
              side={THREE.DoubleSide}
            />
            {isSelected && highlightStyle === 'dashed' && <DashedEdges shapes={item.shapes} color={contrastColor} depth={depth} />}
            {isPreviewed && <DashedEdges shapes={item.shapes} color="#ef4444" depth={depth} />}
            {isSelected && highlightStyle === 'solid' && (
              <mesh position={[0, 0, depth + 0.1]}>
                {depth === 0 ? (
                  <shapeGeometry args={[item.shapes]} />
                ) : (
                  <extrudeGeometry
                    key={`extrude-overlay-${sealGaps}-${depth}`}
                    args={[item.shapes, {
                      depth,
                      bevelEnabled: sealGaps,
                      bevelSize: sealGaps ? 0.2 : 0,
                      bevelThickness: sealGaps ? 0.05 : 0,
                      bevelSegments: sealGaps ? 1 : 0
                    }]}
                  />
                )}
                <meshBasicMaterial 
                  map={contrastColor === 'white' ? whiteStripes : blackStripes} 
                  transparent={true} 
                  depthTest={false}
                />
              </mesh>
            )}
          </mesh>
        );
      })}
    </group>
  );
});
