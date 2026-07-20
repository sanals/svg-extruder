import type { ShapeItem } from '../types';
import { useState, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { DashedEdges } from './DashedEdges';

export interface SvgModelProps {
  shapes: ShapeItem[];
  highlightStyle?: 'dashed' | 'solid';
  backingDepth?: number;
  sealGaps?: boolean;
  selectedMeshIds: string[];
  meshDepths: Record<string, number>;
  meshColorOverrides: Record<string, string>;
  onSelect: (ids: string[], multi: boolean) => void;
  onVerticesCalculated?: (count: number) => void;
  previewMeshIds?: string[];
}

const createStripeTexture = (color: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'transparent';
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = color;
    ctx.lineWidth = 12;
    for (let i = -64; i < 128; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 64, 64);
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.1, 0.1);
  return texture;
};

const lightStripeTexture = createStripeTexture('rgba(255, 255, 255, 0.4)');
const darkStripeTexture = createStripeTexture('rgba(0, 0, 0, 0.4)');

export function SvgModel({
  shapes,
  highlightStyle = 'solid',
  backingDepth = 0,
  sealGaps = true,
  selectedMeshIds,
  meshDepths,
  meshColorOverrides,
  onSelect,
  onVerticesCalculated,
  previewMeshIds = [],
}: SvgModelProps) {
  const { invalidate } = useThree();
  const geomCache = useRef(new Map<string, { geometry: THREE.BufferGeometry; visualDepth: number; sealGaps: boolean }>());

  useEffect(() => {
    geomCache.current.clear();
  }, [shapes]);

  const geometries = useMemo(() => {
    let totalVertices = 0;

    const items = shapes.map((item, index) => {
      if (!item.shapes || item.shapes.length === 0) return null;

      let color = new THREE.Color();
      const overriddenHex = meshColorOverrides[item.id];
      if (overriddenHex) {
        color.setHex(parseInt(overriddenHex.replace('#', ''), 16));
      } else {
        color.setHex(parseInt(item.colorHex.replace('#', ''), 16));
      }

      const depth = meshDepths[item.id] ?? 0;
      const visualDepth = depth + backingDepth;

      let geometry: THREE.BufferGeometry;
      const cacheKey = item.id;
      const cached = geomCache.current.get(cacheKey);

      if (cached && cached.visualDepth === visualDepth && cached.sealGaps === sealGaps) {
        geometry = cached.geometry;
      } else {
        if (visualDepth === 0) {
          geometry = new THREE.ShapeGeometry(item.shapes, 32);
        } else {
          geometry = new THREE.ExtrudeGeometry(item.shapes, {
            depth: visualDepth,
            curveSegments: 32,
            bevelEnabled: sealGaps,
            bevelSize: sealGaps ? 0.2 : 0,
            bevelThickness: sealGaps ? 0.05 : 0,
            bevelSegments: sealGaps ? 1 : 0,
          });
        }
        geomCache.current.set(cacheKey, { geometry, visualDepth, sealGaps });
      }

      totalVertices += geometry.attributes.position.count;

      return { id: item.id, color, geometry, originalColorHex: overriddenHex || item.colorHex, depth, visualDepth, index };
    }).filter(Boolean) as {
      id: string;
      color: THREE.Color;
      geometry: THREE.BufferGeometry;
      originalColorHex: string;
      depth: number;
      visualDepth: number;
      index: number;
    }[];

    if (onVerticesCalculated) onVerticesCalculated(totalVertices);

    return items;
  }, [shapes, meshDepths, meshColorOverrides, sealGaps, backingDepth, onVerticesCalculated]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    invalidate();
  }, [geometries, hoveredId, selectedMeshIds, invalidate]);

  return (
    <group scale={[0.1, -0.1, 0.1]}>
      {geometries.map(({ id, color, geometry, originalColorHex, visualDepth, index }) => {
        const isSelected = selectedMeshIds.includes(id);
        const isHovered = hoveredId === id;
        const isPreview = previewMeshIds.includes(id);

        let displayColor = color;
        if (isPreview) {
          displayColor = new THREE.Color(0xff0000);
        }

        const getLuminance = (hex: string) => {
          const rgb = parseInt(hex.replace('#', ''), 16);
          const r = (rgb >> 16) & 0xff;
          const g = (rgb >> 8) & 0xff;
          const b = (rgb >> 0) & 0xff;
          return 0.299 * r + 0.587 * g + 0.114 * b;
        };
        const isLight = getLuminance(originalColorHex) > 180;
        const contrastColor = isLight ? '#000000' : '#ffffff';
        const stripeTexture = isLight ? darkStripeTexture : lightStripeTexture;

        const baseZOffset = index * 0.001 - backingDepth;
        const selectedZOffset = shapes.length * 0.001 + 0.1;
        const zPosition = isSelected ? baseZOffset + selectedZOffset : baseZOffset;

        return (
          <group key={id}>
            <mesh
              geometry={geometry}
              userData={{ id, originalColorHex }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect([id], e.shiftKey);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHoveredId(id);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                setHoveredId(null);
                document.body.style.cursor = 'default';
              }}
              position={[0, 0, zPosition]}
            >
              <meshStandardMaterial
                color={displayColor}
                side={THREE.DoubleSide}
                polygonOffset={true}
                polygonOffsetFactor={1}
                polygonOffsetUnits={1}
              />
            </mesh>

            {(isSelected || isHovered) && highlightStyle === 'solid' && (
              <mesh geometry={geometry} position={[0, 0, visualDepth + zPosition + 0.1]}>
                <meshBasicMaterial
                  map={stripeTexture}
                  transparent={true}
                  opacity={isSelected ? 1 : 0.38}
                  depthTest={false}
                  side={THREE.DoubleSide}
                />
              </mesh>
            )}

            {(isSelected || isHovered) && highlightStyle === 'dashed' && (
              <DashedEdges
                shapes={shapes.find((s) => s.id === id)!.shapes}
                variant={isSelected ? 'selected' : 'hover'}
                color={isSelected ? contrastColor : '#60a5fa'}
                depth={visualDepth + zPosition}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}
