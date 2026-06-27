import React from 'react';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { useLoader } from '@react-three/fiber';
import polygonClipping from 'polygon-clipping';
import ClipperLib from 'clipper-lib';

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

interface SvgModelProps {
  svgUrl: string;
  selectByColor: boolean;
  sealGaps: boolean;
  cutOverlaps: boolean;
  selectedMeshIndices: number[];
  meshDepths: Record<number, number>;
  onSelect: (indices: number[], shiftKey: boolean) => void;
  onVerticesCalculated?: (count: number) => void;
  onParseProgress?: (msg: string) => void;
  onParseComplete?: () => void;
}

export const SvgModel: React.FC<SvgModelProps> = ({ 
  svgUrl, selectByColor, sealGaps, cutOverlaps, selectedMeshIndices, meshDepths, onSelect, onVerticesCalculated, onParseProgress, onParseComplete 
}) => {
  const svgData = useLoader(SVGLoader, svgUrl);
  const groupRef = React.useRef<THREE.Group>(null);
  
  const [shapesWithColors, setShapesWithColors] = React.useState<{ color: THREE.Color; colorHex: string; shapes: THREE.Shape[] }[]>([]);

  React.useEffect(() => {
    if (!svgData) return;

    // Small delay to allow React to paint the "Parsing" text
    const timeout1 = setTimeout(() => {
      try {
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

        const newSvgDataPaths: any[] = [];
        const processedNodes = new Set();
        
        svgData.paths.forEach((path: any) => {
          // SVGLoader emits duplicate paths if an element has both a fill and stroke.
          // By tracking the DOM node, we process each element exactly once, generating both its fill and stroke in the correct Z-order!
          const node = path.userData?.node;
          if (node && processedNodes.has(node)) return;
          if (node) processedNodes.add(node);

          // Process FILL geometry
          let fillColor = path.userData?.style?.fill;
          if (fillColor === 'currentColor') fillColor = '#000000';
          if (fillColor !== undefined && fillColor !== 'none') {
            // @ts-ignore - Three.js types are outdated for ShapePath.toShapes
            const shapes = path.toShapes(true);
            let multiPoly: MultiPolygon = shapes.map(shapeToPolygon);
            try {
              // @ts-ignore
              multiPoly = polygonClipping.union(multiPoly);
            } catch(e) {}
            
            if (multiPoly.length > 0) {
              layerPolygons.push(multiPoly);
              layerBBoxes.push(getBoundingBox(multiPoly));
              // Clone path for fill
              const fillPath = Object.assign(Object.create(Object.getPrototypeOf(path)), path);
              fillPath.color = new THREE.Color().setStyle(fillColor);
              newSvgDataPaths.push(fillPath);
            }
          }

          // Process STROKE geometry natively via Polygon Buffering!
          let strokeColor = path.userData?.style?.stroke;
          if (strokeColor === 'currentColor') strokeColor = '#000000';
          let rawStrokeWidth = path.userData?.style?.strokeWidth;
          // Handle string stroke widths like "5px" or missing ones
          const strokeWidth = (rawStrokeWidth !== undefined && rawStrokeWidth !== null) ? parseFloat(rawStrokeWidth.toString()) : 1;
          
          if (strokeColor !== undefined && strokeColor !== 'none' && !isNaN(strokeWidth) && strokeWidth > 0) {
            const scale = 10000;
            const co = new ClipperLib.ClipperOffset();
            
            // Add all subpaths to ClipperOffset
            path.subPaths.forEach((subPath: any) => {
              const points = subPath.getPoints();
              if (points.length < 2) return;
              
              const clipperPath = points.map((p: any) => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
              // Is the subPath closed?
              const isClosed = points[0].distanceTo(points[points.length - 1]) < 0.01;
              const endType = isClosed ? ClipperLib.EndType.etClosedPolygon : ClipperLib.EndType.etOpenSquare;
              
              co.AddPath(clipperPath, ClipperLib.JoinType.jtMiter, endType);
            });
            
            // @ts-ignore
            const solutionTree = new ClipperLib.PolyTree();
            // Expand by strokeWidth / 2
            co.Execute(solutionTree, (strokeWidth / 2) * scale);
            
            if (solutionTree.ChildCount() > 0) {
              let strokeMultiPoly: MultiPolygon = [];
              
              // Helper to parse PolyTree into MultiPolygon
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
              
              // ClipperLib already unions the offset geometry, so we don't need polygonClipping.union
              if (strokeMultiPoly.length > 0) {
                layerPolygons.push(strokeMultiPoly);
                layerBBoxes.push(getBoundingBox(strokeMultiPoly));
                
                // Clone path for stroke
                const strokePath = Object.assign(Object.create(Object.getPrototypeOf(path)), path);
                strokePath.color = new THREE.Color().setStyle(strokeColor);
                newSvgDataPaths.push(strokePath);
              }
            }
          }
        });

        // Replace paths array so final geometry indexing matches perfectly
        svgData.paths = newSvgDataPaths;

        // Function to finalize geometry and set state
        const finalizePolygons = (finalPolys: MultiPolygon[]) => {
          const individualShapes: { color: THREE.Color, colorHex: string, shapes: THREE.Shape[] }[] = [];
          
          finalPolys.forEach((multiPoly, index) => {
            if (multiPoly.length === 0) return;
            const color = svgData.paths[index].color;
            const colorHex = color.getHexString();
            const shapes = multiPolygonToShapes(multiPoly);
            shapes.forEach(shape => {
              individualShapes.push({ color, colorHex, shapes: [shape] });
            });
          });
          
          const validGroups = individualShapes.filter(g => g.shapes.length > 0);
          setShapesWithColors(validGroups);
          if (onParseComplete) onParseComplete();
        };

        if (!cutOverlaps) {
          finalizePolygons(layerPolygons);
          return () => clearTimeout(timeout1);
        }

        // Asynchronous Boolean Subtraction Loop (to prevent freezing)
        const finalPolygons: MultiPolygon[] = [];
        const processLayer = (i: number) => {
          if (i >= layerPolygons.length) {
            finalizePolygons(finalPolygons);
            return;
          }

          // Throttle UI updates so we don't crash React with thousands of rapid state updates
          const updateInterval = Math.max(1, Math.floor(layerPolygons.length / 100));
          if (onParseProgress && i % updateInterval === 0) {
            onParseProgress(`Step 3/3: Cutting overlaps (Layer ${i + 1} of ${layerPolygons.length})...`);
          }
          
          // Yield to main thread for UI update
          setTimeout(() => {
            try {
              let result = layerPolygons[i];
              let resultBBox = layerBBoxes[i];
              
              // Only subtract polygons that actually physically overlap our bounding box!
              // This turns an O(N^2) global calculation into a highly targeted local calculation,
              // speeding up processing of 8000-layer SVGs by over 1000x.
              const overlappingAbovePolys: MultiPolygon[] = [];
              for (let j = i + 1; j < layerPolygons.length; j++) {
                if (boxesIntersect(resultBBox, layerBBoxes[j])) {
                  overlappingAbovePolys.push(layerPolygons[j]);
                }
              }
              
              if (overlappingAbovePolys.length > 0 && result.length > 0) {
                for (const abovePoly of overlappingAbovePolys) {
                  try {
                    // @ts-ignore
                    result = polygonClipping.difference(result, abovePoly);
                  } catch (e) {
                    console.warn(`Boolean subtraction of a layer failed for layer ${i}, skipping this specific overlap:`, e);
                  }
                  if (result.length === 0) break; // completely subtracted
                }
              }
              finalPolygons.push(result);
              
              // Process next layer
              processLayer(i + 1);
            } catch(e) {
              console.error("Error during boolean step", e);
              if (onParseComplete) onParseComplete();
            }
          }, 0);
        };

        // Start processing layer 0
        processLayer(0);
      } catch(e) {
        console.error("Error during parse step", e);
        if (onParseComplete) onParseComplete();
      }
    }, 50);

    return () => clearTimeout(timeout1);
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
        const isSelected = selectedMeshIndices.includes(index);
        const color = isSelected ? "hotpink" : item.color;
        const depth = meshDepths[index] ?? 0;

        // Base offset to prevent z-fighting (still slightly useful even after boolean subtraction due to precision issues)
        const baseZOffset = index * 0.001;
        // If selected, add an offset larger than the maximum possible base offset so it jumps to the front
        const selectedZOffset = shapesWithColors.length * 0.001 + 0.1;
        const zPosition = isSelected ? baseZOffset + selectedZOffset : baseZOffset;

        if (!item.shapes || item.shapes.length === 0) return null;

        return (
          <mesh 
            key={index} 
            position={[0, 0, zPosition]}
            onClick={(e) => {
              e.stopPropagation();
              const clickedItem = shapesWithColors[index];
              const indices = selectByColor 
                ? shapesWithColors.map((item, i) => item.colorHex === clickedItem.colorHex ? i : -1).filter(i => i !== -1)
                : [index];
              onSelect(indices, e.shiftKey);
            }}
          >
            {depth === 0 ? (
              <shapeGeometry args={[item.shapes]} />
            ) : (
              <extrudeGeometry 
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
              color={color} 
              side={THREE.DoubleSide} 
              emissive={isSelected ? new THREE.Color("hotpink") : new THREE.Color(0x000000)}
              emissiveIntensity={isSelected ? 0.5 : 0}
            />
          </mesh>
        );
      })}
    </group>
  );
};
