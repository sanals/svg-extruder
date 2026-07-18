import React from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

interface DashedEdgesProps {
  shapes: THREE.Shape[];
  color: string;
  depth: number;
}

export const DashedEdges: React.FC<DashedEdgesProps> = ({ shapes, color, depth }) => {
  const lineRef = React.useRef<THREE.LineSegments>(null);
  const { invalidate } = useThree();
  
  const edgesGeometry = React.useMemo(() => {
    const points: THREE.Vector3[] = [];
    shapes.forEach(shape => {
      // get outer points
      const shapePoints = shape.getPoints();
      for (let i = 0; i < shapePoints.length; i++) {
        const p1 = shapePoints[i];
        const p2 = shapePoints[(i + 1) % shapePoints.length];
        points.push(new THREE.Vector3(p1.x, p1.y, depth + 0.5));
        points.push(new THREE.Vector3(p2.x, p2.y, depth + 0.5));
      }
      
      // get hole points
      shape.holes.forEach(hole => {
        const holePoints = hole.getPoints();
        for (let i = 0; i < holePoints.length; i++) {
          const p1 = holePoints[i];
          const p2 = holePoints[(i + 1) % holePoints.length];
          points.push(new THREE.Vector3(p1.x, p1.y, depth + 0.5));
          points.push(new THREE.Vector3(p2.x, p2.y, depth + 0.5));
        }
      });
    });
    
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [shapes, depth]);

  React.useLayoutEffect(() => {
    if (lineRef.current) {
      lineRef.current.computeLineDistances();
      // With frameloop="demand", computeLineDistances() runs after the frame was
      // already rendered. We must invalidate to trigger another render with
      // the correct line distances so dashes actually appear.
      invalidate();
    }
  }, [edgesGeometry, invalidate]);

  return (
    <lineSegments ref={lineRef} geometry={edgesGeometry} renderOrder={999}>
      <lineDashedMaterial color={color} dashSize={0.5} gapSize={0.5} linewidth={2} depthTest={false} depthWrite={false} transparent={true} />
    </lineSegments>
  );
};
