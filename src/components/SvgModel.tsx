import type { ShapeItem } from '../types';
import { forwardRef, useImperativeHandle, useState, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { useLoader, useThree } from '@react-three/fiber';
import { processGeometry } from '../lib/svg-parser';
import { DashedEdges } from './DashedEdges';
import {
  extractInnerParts, createBasePlate, absorbShards, smoothSelected,
  generateUniformLineArt, expandSelected, createUniformBorder, splitDisjoint, fuseSelected,
  getAdjacentColors
} from '../lib/geometry-ops';
import { sliceAndExport } from '../lib/export-utils';
import { getShapeAreas as computeShapeAreas } from '../lib/shape-areas';

export interface SvgModelProps {
  svgUrl: string;
  sealGaps?: boolean;
  cutOverlaps?: boolean;
  highlightStyle?: 'dashed' | 'solid';
  backingDepth?: number;
  selectedMeshIds: string[];
  meshDepths: Record<string, number>;
  meshColorOverrides: Record<string, string>;
  onSelect: (ids: string[], multi: boolean) => void;
  onVerticesCalculated?: (count: number) => void;
  onParseProgress?: (msg: string | null) => void;
  onParseComplete?: (extractedColors: { id: string, colorHex: string }[]) => void;
    onInitialLoadComplete?: () => void;
  previewMeshIds?: string[];
}

export interface SvgModelRef {
  fuseSelected: (idsToFuse: string[], targetColorHex: string, forceMergeAll: boolean, onProgress: (msg: string) => void) => Promise<string[] | null>;
  absorbShards: (selectedIds: string[], maxArea: number, onProgress: (msg: string) => void) => Promise<string[]>;
  smoothSelected: (selectedIds: string[], amount: number, onProgress: (msg: string) => void) => Promise<string[] | null>;
  splitDisjoint: (selectedIds: string[], onProgress: (msg: string) => void) => Promise<string[] | null>;
  expandSelected: (selectedIds: string[], amount: number, onProgress: (msg: string) => void) => Promise<string[] | null>;
  createUniformBorder: (selectedIds: string[], width: number, borderMode: 'inner' | 'outer' | 'both' | 'custom', customColorHex: string | null, onProgress: (msg: string) => void) => Promise<string[] | null>;
  getAdjacentColors: (selectedIds: string[]) => Promise<string[]>;
  generateUniformLineArt: (width: number, lightShapeIds: string[], darkShapeIds: string[], onProgress: (msg: string) => void) => Promise<string[] | null>;
  sliceAndExport: (buildPlateSize: number, gridSize: string, printerModel: string, mergeByColor: boolean, customScale: number, clearance: number, scaleZProportionally: boolean, onProgress: (msg: string) => void, printFaceDown?: boolean, faceColorDepthMm?: number, baseColorHex?: string) => Promise<Blob | null>;
  getShapes: () => ShapeItem[];
  setShapes: (shapes: ShapeItem[]) => void;
  getShapeAreas: () => { id: string; area: number }[];
  extractInnerParts: (selectedIds: string[], onProgress: (msg: string) => void) => Promise<string[] | null>;
  createBasePlate: (selectedIds: string[], onProgress: (msg: string) => void) => Promise<string[] | null>;
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

export const SvgModel = forwardRef<SvgModelRef, SvgModelProps>(({
  svgUrl, sealGaps = true, cutOverlaps = false, highlightStyle = 'solid',
  backingDepth = 0, selectedMeshIds, meshDepths, meshColorOverrides,
  onSelect, onVerticesCalculated, onParseProgress, onParseComplete, onInitialLoadComplete, previewMeshIds = []
}, ref) => {
  const [shapesWithColors, setShapesWithColors] = useState<ShapeItem[]>([]);
  const svgData = useLoader(SVGLoader, svgUrl);
  const { invalidate } = useThree();

  const handleUpdatedShapes = (result: { updatedShapes: ShapeItem[], newIds: string[] } | null): string[] | null => {
     if (result) {
       setShapesWithColors(result.updatedShapes);
       return result.newIds;
     }
     return null;
  };

  useImperativeHandle(ref, () => ({
    getAdjacentColors: async (selectedIds) => {
      return getAdjacentColors(shapesWithColors, selectedIds);
    },
    getShapes: () => shapesWithColors,
    setShapes: (shapes) => setShapesWithColors(shapes),
    getShapeAreas: () => {
      return computeShapeAreas(shapesWithColors);
    },
    fuseSelected: async (idsToFuse, targetColorHex, forceMergeAll, onProgress) => {
      const res = await fuseSelected(shapesWithColors, idsToFuse, targetColorHex, forceMergeAll, meshColorOverrides, onProgress);
      return handleUpdatedShapes(res);
    },
    absorbShards: async (selectedIds, maxArea, onProgress) => {
      return await absorbShards(shapesWithColors, selectedIds, maxArea, onProgress);
    },
    smoothSelected: async (selectedIds, amount, onProgress) => {
      const res = await smoothSelected(shapesWithColors, selectedIds, amount, meshColorOverrides, onProgress);
      return handleUpdatedShapes(res);
    },
    expandSelected: async (selectedIds, amount, onProgress) => {
      const res = await expandSelected(shapesWithColors, selectedIds, amount, meshColorOverrides, onProgress);
      return handleUpdatedShapes(res);
    },
    createUniformBorder: async (selectedIds, width, borderMode, customColorHex, onProgress) => {
      const res = await createUniformBorder(shapesWithColors, selectedIds, width, borderMode, customColorHex, onProgress);
      return handleUpdatedShapes(res);
    },
    generateUniformLineArt: async (width, lightShapeIds, darkShapeIds, onProgress) => {
      const res = await generateUniformLineArt(shapesWithColors, width, lightShapeIds, darkShapeIds, onProgress);
      return handleUpdatedShapes(res);
    },
    splitDisjoint: async (selectedIds, onProgress) => {
      const res = await splitDisjoint(shapesWithColors, selectedIds, meshColorOverrides, onProgress);
      return handleUpdatedShapes(res);
    },
    extractInnerParts: async (selectedIds, onProgress) => {
      const res = await extractInnerParts(shapesWithColors, selectedIds, onProgress);
      return handleUpdatedShapes(res);
    },
    createBasePlate: async (selectedIds, onProgress) => {
      const res = await createBasePlate(shapesWithColors, selectedIds, onProgress);
      return handleUpdatedShapes(res);
    },
    sliceAndExport: async (buildPlateSize, gridSize, printerModel, mergeByColor, customScale, clearance, scaleZProportionally, onProgress, printFaceDown = false, faceColorDepthMm = 0, baseColorHex = 'ffffff') => {
      return await sliceAndExport(shapesWithColors, buildPlateSize, gridSize, printerModel, mergeByColor, customScale, clearance, scaleZProportionally, meshDepths, sealGaps, meshColorOverrides, backingDepth, onProgress, printFaceDown, faceColorDepthMm, baseColorHex);
    }
  }), [shapesWithColors, meshDepths, meshColorOverrides, sealGaps, backingDepth]);

  useEffect(() => {
    if (shapesWithColors.length > 0 && onParseComplete) {
      onParseComplete(shapesWithColors.map(s => ({ id: s.id, colorHex: s.colorHex })));
    }
  }, [shapesWithColors]);

  const geomCache = useRef(new Map<string, { geometry: THREE.BufferGeometry, visualDepth: number, sealGaps: boolean }>());

  useEffect(() => {
    if (!svgData) return;
    let isMounted = true;
    (async () => {
      const shapes = await processGeometry(svgData, cutOverlaps, (msg) => {
        if (isMounted && onParseProgress) onParseProgress(msg);
      });
      if (isMounted && shapes.length > 0) {
        setShapesWithColors(shapes);
        geomCache.current.clear(); // Clear cache when shapes change
        if (onInitialLoadComplete) onInitialLoadComplete();
        if (onParseProgress) onParseProgress(null);
      }
    })();
    return () => { isMounted = false; };
  }, [svgData, cutOverlaps]);

    const geometries = useMemo(() => {
      let totalVertices = 0;
      
      const items = shapesWithColors.map((item, index) => {
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
              bevelSegments: sealGaps ? 1 : 0
            });
          }
          geomCache.current.set(cacheKey, { geometry, visualDepth, sealGaps });
        }
        
        totalVertices += geometry.attributes.position.count;
        
        return { id: item.id, color, geometry, originalColorHex: overriddenHex || item.colorHex, depth, visualDepth };
      }).filter(Boolean) as { id: string; color: THREE.Color; geometry: THREE.BufferGeometry; originalColorHex: string; depth: number; visualDepth: number }[];
      
      if (onVerticesCalculated) onVerticesCalculated(totalVertices);
      
      return items;
    }, [shapesWithColors, meshDepths, meshColorOverrides, sealGaps, backingDepth, onVerticesCalculated]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => { invalidate(); }, [geometries, hoveredId, selectedMeshIds, invalidate]);

  return (
    <group scale={[0.1, -0.1, 0.1]}>
      {geometries.map(({ id, color, geometry, originalColorHex, depth, visualDepth }, index) => {
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
        const contrastColor = isLight ? "#000000" : "#ffffff";
        const stripeTexture = isLight ? darkStripeTexture : lightStripeTexture;

        const baseZOffset = index * 0.001 - backingDepth;
        const selectedZOffset = shapesWithColors.length * 0.001 + 0.1;
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
                shapes={shapesWithColors.find(s => s.id === id)!.shapes}
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
});

SvgModel.displayName = 'SvgModel';
