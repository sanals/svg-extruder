import React from 'react';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { useLoader } from '@react-three/fiber';
import polygonClipping from 'polygon-clipping';

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
  selectedMeshIndices: number[];
  meshDepths: Record<number, number>;
  onSelect: (index: number, shiftKey: boolean) => void;
  onVerticesCalculated?: (count: number) => void;
  onParseProgress?: (msg: string) => void;
  onParseComplete?: () => void;
}

export const SvgModel: React.FC<SvgModelProps> = ({ 
  svgUrl, selectedMeshIndices, meshDepths, onSelect, onVerticesCalculated, onParseProgress, onParseComplete 
}) => {
  const svgData = useLoader(SVGLoader, svgUrl);
  const groupRef = React.useRef<THREE.Group>(null);
  
  const [shapesWithColors, setShapesWithColors] = React.useState<{ color: THREE.Color; shapes: THREE.Shape[] }[]>([]);

  React.useEffect(() => {
    if (!svgData) return;

    // Small delay to allow React to paint the "Parsing" text
    const timeout1 = setTimeout(() => {
      try {
        // 1. Convert all SVG paths into MultiPolygons and clean them up
        const layerPolygons: MultiPolygon[] = [];
        svgData.paths.forEach((path) => {
          const shapes = SVGLoader.createShapes(path);
          let multiPoly: MultiPolygon = shapes.map(shapeToPolygon);
          
          // Try to clean up self-intersections (common in auto-traced images)
          try {
            // @ts-ignore
            multiPoly = polygonClipping.union(multiPoly);
          } catch(e) {
            console.warn("Could not clean up polygon:", e);
          }
          
          layerPolygons.push(multiPoly);
        });

        if (onParseProgress) onParseProgress("Step 4/4: Performing Boolean Subtraction...");

        // Small delay to allow React to paint the "Boolean" text before freezing
        const timeout2 = setTimeout(() => {
          try {
            // 2. Perform boolean subtraction from back to front
            const finalPolygons: MultiPolygon[] = [];
            for (let i = 0; i < layerPolygons.length; i++) {
              let result = layerPolygons[i];
              const abovePolys = layerPolygons.slice(i + 1);
              
              if (abovePolys.length > 0 && result.length > 0) {
                try {
                  // @ts-ignore
                  result = polygonClipping.difference(result, ...abovePolys);
                } catch (e) {
                  console.warn("Boolean subtraction failed for a layer:", e);
                }
              }
              finalPolygons.push(result);
            }

            // 3. Convert back to THREE.Shape and group by color
            const groups = new Map<string, { color: THREE.Color; shapes: THREE.Shape[] }>();
            
            finalPolygons.forEach((multiPoly, index) => {
              if (multiPoly.length === 0) return; // Completely obscured layer
              
              const color = svgData.paths[index].color;
              const colorHex = color.getHexString();
              
              if (!groups.has(colorHex)) {
                groups.set(colorHex, { color, shapes: [] });
              }
              
              const shapes = multiPolygonToShapes(multiPoly);
              groups.get(colorHex)!.shapes.push(...shapes);
            });
            
            const validGroups = Array.from(groups.values()).filter(g => g.shapes.length > 0);
            setShapesWithColors(validGroups);
            if (onParseComplete) onParseComplete();
            
          } catch(e) {
            console.error("Error during boolean step", e);
            if (onParseComplete) onParseComplete();
          }
        }, 50);
        
        return () => clearTimeout(timeout2);
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
              onSelect(index, e.shiftKey);
            }}
          >
            {depth === 0 ? (
              <shapeGeometry args={[item.shapes]} />
            ) : (
              <extrudeGeometry args={[item.shapes, { depth, bevelEnabled: false }]} />
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
