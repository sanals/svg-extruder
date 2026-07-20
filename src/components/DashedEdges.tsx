import React from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

interface DashedEdgesProps {
  shapes: THREE.Shape[];
  color: string;
  depth: number;
  variant?: 'hover' | 'selected';
}

const HOVER_STYLE = { dashSize: 0.65, gapSize: 0.4, opacity: 1.0, zOffset: 0.5 } as const;
const SELECTED_GLOW = { dashSize: 2.0, gapSize: 0.3, opacity: 0.45, color: '#3b82f6', zOffset: 0.5 } as const;
const SELECTED_FOREGROUND = { dashSize: 1.6, gapSize: 0.2, opacity: 1.0, zOffset: 0.55 } as const;

function buildEdgesGeometry(shapes: THREE.Shape[], depth: number, zOffset: number): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  const z = depth + zOffset;
  shapes.forEach(shape => {
    const shapePoints = shape.getPoints();
    for (let i = 0; i < shapePoints.length; i++) {
      const p1 = shapePoints[i];
      const p2 = shapePoints[(i + 1) % shapePoints.length];
      points.push(new THREE.Vector3(p1.x, p1.y, z));
      points.push(new THREE.Vector3(p2.x, p2.y, z));
    }

    shape.holes.forEach(hole => {
      const holePoints = hole.getPoints();
      for (let i = 0; i < holePoints.length; i++) {
        const p1 = holePoints[i];
        const p2 = holePoints[(i + 1) % holePoints.length];
        points.push(new THREE.Vector3(p1.x, p1.y, z));
        points.push(new THREE.Vector3(p2.x, p2.y, z));
      }
    });
  });

  return new THREE.BufferGeometry().setFromPoints(points);
}

function DashedLineLayer({
  geometry,
  color,
  dashSize,
  gapSize,
  opacity,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  dashSize: number;
  gapSize: number;
  opacity: number;
}) {
  const lineRef = React.useRef<THREE.LineSegments>(null);
  const { invalidate } = useThree();

  React.useLayoutEffect(() => {
    if (lineRef.current) {
      lineRef.current.computeLineDistances();
      invalidate();
    }
  }, [geometry, invalidate]);

  return (
    <lineSegments ref={lineRef} geometry={geometry} renderOrder={999}>
      <lineDashedMaterial
        color={color}
        dashSize={dashSize}
        gapSize={gapSize}
        linewidth={2}
        depthTest={false}
        depthWrite={false}
        transparent={true}
        opacity={opacity}
      />
    </lineSegments>
  );
}

export const DashedEdges: React.FC<DashedEdgesProps> = ({ shapes, color, depth, variant = 'hover' }) => {
  const hoverGeometry = React.useMemo(
    () => buildEdgesGeometry(shapes, depth, HOVER_STYLE.zOffset),
    [shapes, depth],
  );

  const glowGeometry = React.useMemo(
    () => buildEdgesGeometry(shapes, depth, SELECTED_GLOW.zOffset),
    [shapes, depth],
  );

  const foregroundGeometry = React.useMemo(
    () => buildEdgesGeometry(shapes, depth, SELECTED_FOREGROUND.zOffset),
    [shapes, depth],
  );

  if (variant === 'hover') {
    return (
      <DashedLineLayer
        geometry={hoverGeometry}
        color={color}
        dashSize={HOVER_STYLE.dashSize}
        gapSize={HOVER_STYLE.gapSize}
        opacity={HOVER_STYLE.opacity}
      />
    );
  }

  return (
    <>
      <DashedLineLayer
        geometry={glowGeometry}
        color={SELECTED_GLOW.color}
        dashSize={SELECTED_GLOW.dashSize}
        gapSize={SELECTED_GLOW.gapSize}
        opacity={SELECTED_GLOW.opacity}
      />
      <DashedLineLayer
        geometry={foregroundGeometry}
        color={color}
        dashSize={SELECTED_FOREGROUND.dashSize}
        gapSize={SELECTED_FOREGROUND.gapSize}
        opacity={SELECTED_FOREGROUND.opacity}
      />
    </>
  );
};
