import { useState, useRef, Suspense, useEffect, useCallback } from 'react';
import { Upload, Download, Undo, Redo, Settings, LayoutGrid, Droplet, MoveVertical, Zap, Trash2, SplitSquareHorizontal, LayoutTemplate, Network, WrapText, Combine } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import ImageTracer from 'imagetracerjs';
import { SvgModel, type SvgModelRef } from './components/SvgModel';
import './index.css';

const HoverSlider = ({ min, max, step, value, onChange, onPointerDown, disabled, style, id, displayFormat = (v: number) => v.toFixed(1) }: any) => {
  const [hoverVal, setHoverVal] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLInputElement>) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    let x = e.clientX - rect.left;

    // Adjust for thumb width (approx 20px)
    const thumbWidth = 20;
    const clickableWidth = rect.width - thumbWidth;
    let adjustedX = x - (thumbWidth / 2);
    adjustedX = Math.max(0, Math.min(adjustedX, clickableWidth));

    const percentage = clickableWidth > 0 ? adjustedX / clickableWidth : 0;
    const minVal = parseFloat(min);
    const maxVal = parseFloat(max);
    const stepVal = parseFloat(step) || 1;
    let val = minVal + percentage * (maxVal - minVal);

    // Snap to step
    const inv = 1.0 / stepVal;
    val = Math.round(val * inv) / inv;
    // ensure it stays in bounds
    val = Math.max(minVal, Math.min(maxVal, val));

    setHoverVal(val);

    // Map the hoverX percentage relative to the entire track for positioning the tooltip
    // Tooltip should center over the thumb's center
    const tooltipX = (adjustedX + (thumbWidth / 2)) / rect.width * 100;
    setHoverX(tooltipX);
  };

  return (
    <div style={{ position: 'relative', width: '100%', ...style }} ref={containerRef}>
      {hoverVal !== null && (
        <div style={{
          position: 'absolute',
          top: '-28px',
          left: `${hoverX}%`,
          transform: 'translateX(-50%)',
          backgroundColor: '#3b82f6',
          color: 'white',
          padding: '2px 8px',
          borderRadius: '6px',
          fontSize: '0.75rem',
          fontWeight: 'bold',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 10,
          boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.2)'
        }}>
          {displayFormat(hoverVal)}
          <div style={{
            position: 'absolute',
            bottom: '-5px',
            left: '50%',
            transform: 'translateX(-50%)',
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid #3b82f6',
          }} />
        </div>
      )}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        onPointerDown={onPointerDown}
        disabled={disabled}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverVal(null)}
        style={{ width: '100%', margin: 0 }}
      />
    </div>
  );
};

function App() {
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [rawSvgContent, setRawSvgContent] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [colorCount, setColorCount] = useState<number>(8);
  const [selectedMeshIds, setSelectedMeshIds] = useState<string[]>([]);
  const [meshDepths, setMeshDepths] = useState<Record<string, number>>({});
  const [vertexCount, setVertexCount] = useState<number>(0);
  const [isTracing, setIsTracing] = useState<string | null>(null);
  const [highlightStyle, setHighlightStyle] = useState<'dashed' | 'solid'>('dashed');
  const [sealGaps, setSealGaps] = useState<boolean>(true);
  const [cutOverlaps, setCutOverlaps] = useState<boolean>(true);
  const [selectSizeThreshold, setSelectSizeThreshold] = useState<number>(0);
  const [shapeAreasCache, setShapeAreasCache] = useState<{ id: string, area: number }[] | null>(null);
  const [mergeBeforeExport, setMergeBeforeExport] = useState<boolean>(false);
  const [history, setHistory] = useState<any[]>([]);
  const [redoHistory, setRedoHistory] = useState<any[]>([]);
  const [meshColors, setMeshColors] = useState<{ id: string, colorHex: string }[]>([]);
  const [meshColorOverrides, setMeshColorOverrides] = useState<Record<string, string>>({});
  const [mergeColors3MF, setMergeColors3MF] = useState<boolean>(true);
  const [isMerging, setIsMerging] = useState(false);
  const [isFusingSelection, setIsFusingSelection] = useState(false);
  const [fuseStatus, setFuseStatus] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState<string | null>(null);
  const [isBasePlating, setIsBasePlating] = useState(false);
  const [basePlateStatus, setBasePlateStatus] = useState<string | null>(null);

  const [printerProfile, setPrinterProfile] = useState<'A1 Mini (180x180)' | 'X1/P1/A1 (256x256)'>('X1/P1/A1 (256x256)');
  const [gridSize, setGridSize] = useState<string>("auto");
  const buildPlateSize = printerProfile === 'A1 Mini (180x180)' ? 180 : 256;
  const printerModel = printerProfile === 'A1 Mini (180x180)' ? 'a1_mini' : 'x1c';
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [customScale, setCustomScale] = useState<number>(100);
  const [scaleZProportionally, setScaleZProportionally] = useState<boolean>(false);
  const [clearance, setClearance] = useState<number>(0.0);

  const sceneRef = useRef<THREE.Group>(null);
  const svgModelRef = useRef<SvgModelRef>(null);
  const colorChangeTimeout = useRef<number | null>(null);

  const currentMeshColors = meshColors.map(m => ({
    id: m.id,
    colorHex: meshColorOverrides[m.id] || m.colorHex
  }));

  const getLuminance = (hex: string) => {
    const rgb = parseInt(hex, 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = (rgb >> 0) & 0xff;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };

  const uniqueColors = Array.from(new Set(currentMeshColors.map(m => m.colorHex)))
    .sort((a, b) => getLuminance(b) - getLuminance(a)); // Lightest to darkest

  const toggleColorSelection = (colorHex: string) => {
    const idsOfColor = currentMeshColors.filter(m => m.colorHex === colorHex).map(m => m.id);

    // Check if all of these are already selected
    const allSelected = idsOfColor.every(id => selectedMeshIds.includes(id));

    if (allSelected) {
      // Unselect them
      setSelectedMeshIds(prev => prev.filter(id => !idsOfColor.includes(id)));
    } else {
      // Select them (append to existing selection)
      setSelectedMeshIds(prev => [...new Set([...prev, ...idsOfColor])]);
    }
  };

  const removeColorFromSelection = (colorHex: string) => {
    const idsOfColor = currentMeshColors.filter(m => m.colorHex === colorHex).map(m => m.id);
    setSelectedMeshIds(prev => prev.filter(id => !idsOfColor.includes(id)));
  };

  const selectedUniqueColors = Array.from(new Set(
    selectedMeshIds.map(id => currentMeshColors.find(m => m.id === id)?.colorHex).filter(Boolean) as string[]
  ));

  const getColorDistance = (hex1: string, hex2: string) => {
    const r1 = (parseInt(hex1, 16) >> 16) & 0xff;
    const g1 = (parseInt(hex1, 16) >> 8) & 0xff;
    const b1 = (parseInt(hex1, 16) >> 0) & 0xff;

    const r2 = (parseInt(hex2, 16) >> 16) & 0xff;
    const g2 = (parseInt(hex2, 16) >> 8) & 0xff;
    const b2 = (parseInt(hex2, 16) >> 0) & 0xff;

    return (r1 - r2) * (r1 - r2) + (g1 - g2) * (g1 - g2) + (b1 - b2) * (b1 - b2);
  };

  const handleAutoSelectSimilar = () => {
    if (selectedUniqueColors.length !== 1) return;
    const baseColor = selectedUniqueColors[0];
    const threshold = 2500; // About ~50 value diff per channel

    const similarColors = uniqueColors.filter(c => getColorDistance(baseColor, c) < threshold);

    const idsToSelect = currentMeshColors
      .filter(m => similarColors.includes(m.colorHex))
      .map(m => m.id);

    setSelectedMeshIds(prev => [...new Set([...prev, ...idsToSelect])]);
  };

  const pushToHistory = () => {
    if (!svgModelRef.current) return;
    setShapeAreasCache(null); // Clear size cache when operations occur
    setHistory(prev => [
      ...prev,
      {
        meshDepths: { ...meshDepths },
        meshColorOverrides: { ...meshColorOverrides },
        meshColors: [...meshColors],
        shapes: svgModelRef.current?.getShapes()
      }
    ]);
  };

  const initiateFuse = () => {
    if (selectedUniqueColors.length > 1) {
      setIsFusingSelection(true);
    } else {
      executeFuse(selectedUniqueColors[0] || "000000");
    }
  };

  const executeFuse = async (targetColorHex: string) => {
    setIsFusingSelection(false);
    setIsMerging(false);
    if (!svgModelRef.current) return;

    pushToHistory();
    setFuseStatus("Initializing fusion...");
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    const newIds = await svgModelRef.current.fuseSelected(selectedMeshIds, targetColorHex, false, (msg: string) => {
      setFuseStatus(msg);
    });

    if (newIds && newIds.length > 0) {
      // Apply the selected color override to the new fused parts
      setMeshColorOverrides(prev => {
        const next = { ...prev };
        newIds.forEach(id => {
          next[id] = targetColorHex;
        });
        return next;
      });
      setSelectedMeshIds([...newIds]);
    }

    setFuseStatus(null);
  };

  const executeMergeColors = (targetColorHex: string) => {
    if (selectedMeshIds.length === 0) return;
    pushToHistory();
    setMeshColorOverrides(prev => {
      const next = { ...prev };
      selectedMeshIds.forEach(id => {
        next[id] = targetColorHex;
      });
      return next;
    });
    setIsMerging(false);
  };

  const handleExport3MF = async () => {
    if (!svgModelRef.current) return;

    try {
      const zipBlob = await svgModelRef.current.sliceAndExport(
        buildPlateSize, gridSize, printerModel, mergeColors3MF, customScale / 100.0, mergeColors3MF ? 0 : clearance, scaleZProportionally,
        (msg) => setExportStatus(msg)
      );

      if (zipBlob) {
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.style.display = 'none';
        link.href = url;
        link.download = 'extruded_model.3mf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert("Nothing to export.");
      }
    } catch (e) {
      console.error("Export 3MF failed", e);
      alert("Failed to export 3MF");
    } finally {
      setExportStatus(null);
    }
  };

  const generateSVGFromCurrentShapes = () => {
    if (!svgModelRef.current) return rawSvgContent; // fallback
    const shapesData = svgModelRef.current.getShapes();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const paths = shapesData.map(data => {
      let d = '';
      data.shapes.forEach(shape => {
        const points = shape.extractPoints(12);

        const processRing = (ring: any) => {
          if (ring.length === 0) return '';
          let pathStr = `M ${ring[0].x} ${-ring[0].y} `;
          minX = Math.min(minX, ring[0].x); minY = Math.min(minY, -ring[0].y);
          maxX = Math.max(maxX, ring[0].x); maxY = Math.max(maxY, -ring[0].y);

          for (let i = 1; i < ring.length; i++) {
            pathStr += `L ${ring[i].x} ${-ring[i].y} `;
            minX = Math.min(minX, ring[i].x); minY = Math.min(minY, -ring[i].y);
            maxX = Math.max(maxX, ring[i].x); maxY = Math.max(maxY, -ring[i].y);
          }
          return pathStr + 'Z ';
        };

        d += processRing(points.shape);
        points.holes.forEach(hole => {
          d += processRing(hole);
        });
      });
      // Merge color overrides if they exist
      let finalColor = data.colorHex;
      if (meshColorOverrides[data.id]) {
        finalColor = meshColorOverrides[data.id];
      }
      if (!d.trim()) return '';
      return `<path d="${d.trim()}" fill="#${finalColor}" />`;
    }).filter(Boolean);

    if (minX === Infinity) return rawSvgContent; // fallback if empty

    const width = maxX - minX;
    const height = maxY - minY;
    const padding = Math.max(width, height) * 0.05;
    const viewBox = `${minX - padding} ${minY - padding} ${width + padding * 2} ${height + padding * 2}`;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n  ${paths.join('\n  ')}\n</svg>`;
  };

  const handleSaveProject = () => {
    if (!rawSvgContent) { alert("No active model to save."); return; }
    const projectData = {
      rawSvgContent, colorCount, meshDepths, meshColorOverrides, selectedMeshIds,
      highlightStyle, sealGaps, cutOverlaps, customScale, clearance, printerProfile, gridSize, mergeColors3MF
    };
    const jsonString = JSON.stringify(projectData);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = "model.svgproj";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleLoadProject = (e: any) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const jsonString = event.target?.result;
        const projectData = JSON.parse(jsonString as string);
        if (!projectData.rawSvgContent) { alert("Invalid project file."); return; }
        const blob = new Blob([projectData.rawSvgContent], { type: 'image/svg+xml' });
        const svgBlobUrl = URL.createObjectURL(blob);
        setIsTracing("Loading Project...");
        setTimeout(() => {
          setRawSvgContent(projectData.rawSvgContent); setSvgUrl(svgBlobUrl);
          setColorCount(projectData.colorCount || 8); setMeshDepths(projectData.meshDepths || {});
          setMeshColorOverrides(projectData.meshColorOverrides || {}); setSelectedMeshIds(projectData.selectedMeshIds || []);
          setHighlightStyle(projectData.highlightStyle || 'dashed'); setSealGaps(projectData.sealGaps ?? true);
          setCutOverlaps(projectData.cutOverlaps ?? true);
          if (projectData.customScale) setCustomScale(projectData.customScale);
          if (projectData.clearance !== undefined) setClearance(projectData.clearance);
          if (projectData.printerProfile) setPrinterProfile(projectData.printerProfile);
          if (projectData.gridSize) setGridSize(projectData.gridSize);
          if (projectData.mergeColors3MF !== undefined) setMergeColors3MF(projectData.mergeColors3MF);
          setHistory([]); setMeshColors([]); setVertexCount(0); setIsMerging(false); setIsTracing(null);
        }, 50);
      } catch (err) { alert("Failed to load project file."); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const shardSizeSlider = 100;
  const [pendingShards, setPendingShards] = useState<Record<string, string[]> | null>(null);
  const [ignoredShardColors, setIgnoredShardColors] = useState<string[]>([]);
  const [isAbsorbingShards, setIsAbsorbingShards] = useState(false);
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitStatus, setSplitStatus] = useState<string | null>(null);
  const [isExpanding, setIsExpanding] = useState(false);
  const [expandAmount, setExpandAmount] = useState(1.0);
  const [expandStatus, setExpandStatus] = useState<string | null>(null);

  const [isSmoothing, setIsSmoothing] = useState(false);
  const [smoothAmount, setSmoothAmount] = useState(1.0);
  const [smoothStatus, setSmoothStatus] = useState<string | null>(null);

  const [isBordering, setIsBordering] = useState(false);
  const [borderWidth, setBorderWidth] = useState(2.0);
  const [borderStatus, setBorderStatus] = useState<string | null>(null);

  const handlePreviewShards = async () => {
    if (selectedMeshIds.length === 0 || !svgModelRef.current) return;
    setIsAbsorbingShards(true);
    try {
      const absorbedIds = await svgModelRef.current.absorbShards(selectedMeshIds, shardSizeSlider, () => { });
      if (absorbedIds && absorbedIds.length > 0) {
        const shapes = svgModelRef.current.getShapes();
        const shardsByColor: Record<string, string[]> = {};
        absorbedIds.forEach((id: string) => {
          const shape = shapes.find(s => s.id === id);
          if (shape) {
            const hex = meshColorOverrides[id] || shape.colorHex;
            if (!shardsByColor[hex]) shardsByColor[hex] = [];
            shardsByColor[hex].push(id);
          }
        });
        setPendingShards(shardsByColor); setIgnoredShardColors([]);
      } else { alert("No edge shards found touching this part."); }
    } catch (e) { alert("Failed to preview shards."); } finally { setIsAbsorbingShards(false); }
  };

  const confirmAbsorbShards = async () => {
    if (!pendingShards || !svgModelRef.current) return;
    const targetColorHex = selectedUniqueColors[0] || "000000";
    const idsToAbsorb = Object.entries(pendingShards).filter(([colorHex]) => !ignoredShardColors.includes(colorHex)).flatMap(([_, ids]) => ids);
    if (idsToAbsorb.length > 0) {
      pushToHistory(); setIsAbsorbingShards(true); setFuseStatus("Fusing shards...");
      try {
        const allIdsToFuse = [...new Set([...selectedMeshIds, ...idsToAbsorb])];
        const newIds = await svgModelRef.current.fuseSelected(allIdsToFuse, targetColorHex, true, (msg: string) => setFuseStatus(msg));
        if (newIds && newIds.length > 0) {
          setMeshColorOverrides(prev => {
            const next = { ...prev };
            newIds.forEach(id => next[id] = targetColorHex);
            return next;
          });
          setSelectedMeshIds(newIds);
        }
      } catch (e) { alert("Failed to fuse shards."); } finally { setIsAbsorbingShards(false); setFuseStatus(null); }
    }
    setPendingShards(null); setIgnoredShardColors([]);
  };

  const handleSplitDisjoint = async () => {
    if (selectedMeshIds.length === 0 || !svgModelRef.current) return;
    pushToHistory(); setIsSplitting(true); setSplitStatus("Splitting...");
    try {
      const newIds = await svgModelRef.current.splitDisjoint(selectedMeshIds, (msg: string) => setSplitStatus(msg));
      if (newIds && newIds.length > 0) {
        const avgDepth = selectedMeshIds.reduce((sum, id) => sum + (meshDepths[id] ?? 0), 0) / selectedMeshIds.length;
        setMeshDepths(prev => {
          const next = { ...prev };
          newIds.forEach(id => next[id] = avgDepth || 0);
          return next;
        });
        const firstColor = meshColorOverrides[selectedMeshIds[0]];
        if (firstColor) {
          setMeshColorOverrides(prev => {
            const next = { ...prev };
            newIds.forEach(id => next[id] = firstColor);
            return next;
          });
        }
        setSelectedMeshIds(newIds);
      } else { alert("No disjoint parts found."); }
    } catch (e) { alert("Failed to split."); } finally { setIsSplitting(false); setSplitStatus(null); }
  };


  const handleExtractInner = async () => {
    if (selectedMeshIds.length === 0 || !svgModelRef.current) return;
    pushToHistory(); setIsExtracting(true); setExtractStatus("Extracting...");
    try {
      const newIds = await svgModelRef.current.extractInnerParts(selectedMeshIds, (msg: string) => setExtractStatus(msg));
      if (newIds && newIds.length > 0) {
        inheritProperties(newIds);
        setSelectedMeshIds(newIds);
      } else { alert("No empty spaces found inside the selected parts."); }
    } catch (e) { alert("Failed to extract inner parts."); } finally { setIsExtracting(false); setExtractStatus(null); }
  };

  const handleCreateBasePlate = async () => {
    if (selectedMeshIds.length === 0 || !svgModelRef.current) return;
    pushToHistory(); setIsBasePlating(true); setBasePlateStatus("Tracing silhouette...");
    try {
      const newIds = await svgModelRef.current.createBasePlate(selectedMeshIds, (msg: string) => setBasePlateStatus(msg));
      if (newIds && newIds.length > 0) {
        const avgDepth = selectedMeshIds.reduce((sum, id) => sum + (meshDepths[id] ?? 0), 0) / selectedMeshIds.length;
        setMeshDepths(prev => {
          const next = { ...prev };
          newIds.forEach(id => next[id] = (avgDepth / 2) || 1);
          return next;
        });
        setSelectedMeshIds(newIds);
      } else { alert("Failed to generate base plate."); }
    } catch (e) { alert("Error generating base plate."); } finally { setIsBasePlating(false); setBasePlateStatus(null); }
  };

  const inheritProperties = (newIds: string[]) => {
    if (newIds && newIds.length > 0) {
      const avgDepth = selectedMeshIds.reduce((sum, id) => sum + (meshDepths[id] ?? 0), 0) / selectedMeshIds.length;
      setMeshDepths(prev => {
        const next = { ...prev };
        newIds.forEach(id => next[id] = avgDepth || 0);
        return next;
      });
      const firstColor = meshColorOverrides[selectedMeshIds[0]];
      if (firstColor) {
        setMeshColorOverrides(prev => {
          const next = { ...prev };
          newIds.forEach(id => next[id] = firstColor);
          return next;
        });
      }
      setSelectedMeshIds(newIds);
    }
  };

  const handleExpandSelected = async () => {
    if (selectedMeshIds.length === 0 || !svgModelRef.current) return;
    pushToHistory(); setIsExpanding(true); setExpandStatus("Expanding...");
    try {
      const newIds = await svgModelRef.current.expandSelected(selectedMeshIds, expandAmount, (msg: string) => setExpandStatus(msg));
      if (newIds) inheritProperties(newIds);
    } catch (e) { alert("Failed to expand."); } finally { setIsExpanding(false); setExpandStatus(null); }
  };

  const handleSmoothSelected = async () => {
    if (selectedMeshIds.length === 0 || !svgModelRef.current) return;
    pushToHistory(); setIsSmoothing(true); setSmoothStatus("Smoothing...");
    try {
      const newIds = await svgModelRef.current.smoothSelected(selectedMeshIds, smoothAmount, (msg: string) => setSmoothStatus(msg));
      if (newIds) inheritProperties(newIds);
    } catch (e) { alert("Failed to smooth."); } finally { setIsSmoothing(false); setSmoothStatus(null); }
  };

  const handleCreateBorder = async () => {
    if (selectedMeshIds.length === 0 || !svgModelRef.current) return;
    pushToHistory(); setIsBordering(true); setBorderStatus("Creating border...");
    try {
      const newIds = await svgModelRef.current.createUniformBorder(selectedMeshIds, borderWidth, (msg: string) => setBorderStatus(msg));
      if (newIds && newIds.length > 0) {
        const avgDepth = selectedMeshIds.reduce((sum, id) => sum + (meshDepths[id] ?? 0), 0) / selectedMeshIds.length;
        setMeshDepths(prev => {
          const next = { ...prev };
          newIds.forEach(id => next[id] = avgDepth || 0);
          return next;
        });
        setMeshColorOverrides(prev => {
          const next = { ...prev };
          newIds.forEach(id => next[id] = "202020");
          return next;
        });
        setSelectedMeshIds(newIds);
      }
    } catch (e) { alert("Failed to create border."); } finally { setIsBordering(false); setBorderStatus(null); }
  };

  const traceImage = (dataUrl: string, colors: number) => {
    setIsTracing("Step 2/3: Vectorizing Pixels to SVG...");
    setTimeout(() => {
      ImageTracer.imageToSVG(
        dataUrl,
        (svgStr: string) => {
          const blob = new Blob([svgStr], { type: 'image/svg+xml' });
          const svgBlobUrl = URL.createObjectURL(blob);

          setIsTracing("Step 3/3: Parsing 2D Geometry...");
          setRawSvgContent(svgStr);
          setSvgUrl(svgBlobUrl);
          setSelectedMeshIds([]);
          setMeshDepths({});
          setVertexCount(0);
          setHistory([]);
          setMeshColors([]);
          setMeshColorOverrides({});
          setIsMerging(false);
          setImageDataUrl(dataUrl);
        },
        {
          numberofcolors: colors,
          colorquantcycles: 15, // Increased from default 3 to improve k-means convergence and consistency
          mincolorratio: 0.005, // Lowered from 0.02 (2%) to 0.5% so small details (like stripes) aren't discarded as "noise" when colors increase
          strokewidth: 0,
          viewbox: true,
          blurradius: 2,
          blurdelta: 20
        }
      );
    }, 50);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type === 'image/svg+xml') {
        const url = URL.createObjectURL(file);
        setIsTracing("Loading SVG Geometry...");

        // Yield to allow React to paint the loading screen before blocking the thread
        setTimeout(() => {
          setSvgUrl(url);
          setImageDataUrl(null);
          setSelectedMeshIds([]);
          setMeshDepths({});
          setVertexCount(0); // Reset vertices
          setHistory([]); // Reset history
          setMeshColors([]); // Reset colors
          setMeshColorOverrides({});
          setIsMerging(false);
        }, 50);
      } else if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp') {
        const url = URL.createObjectURL(file);
        setIsTracing("Step 1/3: Loading Image...");
        setSvgUrl(null); // Clear canvas

        const img = new Image();
        img.onload = () => {
          setIsTracing("Step 1/3: Optimizing Image Resolution...");
          setTimeout(() => {
            let width = img.width;
            let height = img.height;
            const maxDim = 400; // Reduced to 400px to ensure the boolean engine doesn't get overloaded

            if (width > maxDim || height > maxDim) {
              const ratio = Math.min(maxDim / width, maxDim / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              const dataUrl = canvas.toDataURL("image/png");
              traceImage(dataUrl, colorCount);
            }
          }, 50);
        };
        img.src = url;
      } else {
        alert("Please upload a valid SVG, PNG, or JPG file.");
      }
    }
  };

  const handleDepthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const depth = parseFloat(e.target.value);
    setMeshDepths(prev => {
      const newDepths = { ...prev };
      selectedMeshIds.forEach(id => {
        newDepths[id] = depth;
      });
      return newDepths;
    });
  };

  const handleDepthPointerDown = () => {
    pushToHistory();
  };

  const handleDeleteSelected = () => {
    if (selectedMeshIds.length === 0 || !svgModelRef.current) return;
    pushToHistory();
    const currentShapes = svgModelRef.current.getShapes();
    const newShapes = currentShapes.filter(item => !selectedMeshIds.includes(item.id));
    svgModelRef.current.setShapes(newShapes);
    setSelectedMeshIds([]);
  };

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedMeshIds.length === 0) return;
    const newColorHex = e.target.value.replace('#', '');
    setMeshColorOverrides(prev => {
      const next = { ...prev };
      selectedMeshIds.forEach(id => next[id] = newColorHex);
      return next;
    });
  };

  const previewMeshIds = pendingShards
    ? Object.entries(pendingShards)
      .filter(([colorHex]) => !ignoredShardColors.includes(colorHex))
      .flatMap(([_, ids]) => ids)
    : [];

  const handleColorCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColors = parseInt(e.target.value);
    setColorCount(newColors);

    if (colorChangeTimeout.current) {
      window.clearTimeout(colorChangeTimeout.current);
    }

    colorChangeTimeout.current = window.setTimeout(() => {
      if (imageDataUrl) {
        traceImage(imageDataUrl, newColors);
      }
    }, 400);
  };

  const handleUndo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];

      // Delay side effects out of the pure updater function to ensure React batches them correctly
      setTimeout(() => {
        setMeshDepths(snapshot.meshDepths);
        setMeshColorOverrides(snapshot.meshColorOverrides);
        setMeshColors(snapshot.meshColors);
        if (svgModelRef.current && snapshot.shapes) {
          svgModelRef.current.setShapes(snapshot.shapes);
        }
        setSelectedMeshIds([]); // Clear selection to prevent ghosting
      }, 0);

      return prev.slice(0, -1);
    });
  }, []);

  // Handle hotkeys (Undo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelectBySizeChange = (val: number) => {
    setSelectSizeThreshold(val);
    let cache = shapeAreasCache;
    if (!cache) {
      if (svgModelRef.current) {
        cache = svgModelRef.current.getShapeAreas();
        setShapeAreasCache(cache);
      } else {
        return;
      }
    }
    if (val === 0) {
      setSelectedMeshIds([]);
    } else {
      const ids = cache.filter(item => item.area <= val).map(item => item.id);
      setSelectedMeshIds(ids);
    }
  };

  const handleExport = () => {
    if (!sceneRef.current) return;

    // Clone the scene so we don't modify the live React components
    const exportScene = sceneRef.current.clone();

    // Reset selection state (pink color, emissive, and raised Z-position) back to original before exporting
    exportScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.userData.originalColorHex !== undefined) {
          mesh.material = (mesh.material as THREE.Material).clone();
          const mat = mesh.material as THREE.MeshStandardMaterial;
          mat.color = new THREE.Color("#" + mesh.userData.originalColorHex);
          mat.emissive = new THREE.Color(0x000000);
          mat.emissiveIntensity = 0;
        }
        // Force Z-position to 0 during export so all parts share the exact same base plane for 3D printing!
        mesh.position.z = 0;
      }
    });

    let finalExportObject: THREE.Object3D = exportScene;

    const scaleFactor = customScale / 100.0;
    const zScale = scaleZProportionally ? scaleFactor : 1.0;
    exportScene.scale.set(scaleFactor, scaleFactor, zScale);
    exportScene.updateMatrixWorld(true);

    if (mergeBeforeExport) {
      const geometries: THREE.BufferGeometry[] = [];
      const materials: THREE.Material[] = [];
      let meshesParent: THREE.Object3D | null = null;

      exportScene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (!meshesParent) meshesParent = mesh.parent;

          // Apply local transform to geometry so it's baked in relative to the group
          mesh.updateMatrix();
          let geom = mesh.geometry.clone();

          // mergeGeometries requires all geometries to have the exact same attributes (indexed vs non-indexed)
          // ExtrudeGeometry is indexed, ShapeGeometry (depth=0) is non-indexed. Force all to be non-indexed!
          if (geom.index) {
            geom = geom.toNonIndexed();
          }

          // Normalize attributes to prevent merge failures
          const attrs = Object.keys(geom.attributes);
          attrs.forEach(key => {
            if (key !== 'position' && key !== 'normal' && key !== 'uv') {
              geom.deleteAttribute(key);
            }
          });
          if (!geom.attributes.normal) geom.computeVertexNormals();
          if (!geom.attributes.uv) {
            const count = geom.attributes.position.count;
            geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
          }

          geom.applyMatrix4(mesh.matrix);
          geometries.push(geom);
          materials.push(mesh.material as THREE.Material);
        }
      });

      if (geometries.length > 0 && meshesParent) {
        try {
          // true flag tells it to create groups for multi-materials, preserving original colors!
          const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, true);
          const mergedMesh = new THREE.Mesh(mergedGeometry, materials);

          // Replace all individual meshes with the single merged mesh
          // This perfectly preserves the parent's scale (which flips the SVG right-side up)
          const parent = meshesParent as THREE.Object3D;
          parent.clear();
          parent.add(mergedMesh);

          finalExportObject = exportScene;
        } catch (e) {
          console.error("Failed to merge geometries:", e);
          alert("Failed to merge geometries. Exporting as separate parts.");
        }
      }
    }

    const exporter = new STLExporter();
    const result = exporter.parse(finalExportObject, { binary: true });
    const blob = new Blob([result], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = 'extruded_model.stl';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Calculate current average depth of selected meshes to display on the slider
  const currentDepth = selectedMeshIds.length > 0
    ? selectedMeshIds.reduce((sum, id) => sum + (meshDepths[id] ?? 0), 0) / selectedMeshIds.length
    : 0;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeElement = document.activeElement;
        const isInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA' || activeElement?.tagName === 'SELECT';
        if (!isInput && selectedMeshIds.length > 0) {
          handleDeleteSelected();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMeshIds, handleDeleteSelected]);

  return (
    <>
      <div className="top-nav">
        <h1 className="sidebar-header" style={{ margin: 0, fontSize: '1.25rem' }}>SVG Extruder 3D</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {vertexCount > 0 && (
            <div style={{ padding: '0.25rem 0.75rem', borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: vertexCount > 100000 ? '#ef4444' : '#e2e8f0' }}>{vertexCount.toLocaleString()} Vertices</div>
            </div>
          )}
          <button
            onClick={handleUndo}
            disabled={history.length === 0}
            style={{
              padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem',
              backgroundColor: history.length > 0 ? '#3b82f6' : 'transparent',
              color: history.length > 0 ? 'white' : '#64748b',
              border: history.length > 0 ? 'none' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px', cursor: history.length > 0 ? 'pointer' : 'not-allowed'
            }}
            title="Undo last change (Ctrl+Z)"
          >
            <Undo size={14} /> Undo
          </button>
        </div>
      </div>

      <div className="app-main">
        {/* LEFT SIDEBAR */}
        <div className="left-sidebar">

          <div className="card">
            <div className="card-header"><Settings size={14} style={{ marginRight: '6px' }} /> Input & Setup</div>
            <div className="card-body">
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <label style={{ flex: 1, fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#334155', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #475569' }}>
                  Load Project
                  <input type="file" accept=".svgproj" onChange={handleLoadProject} style={{ display: 'none' }} />
                </label>
                <button onClick={handleSaveProject} disabled={!rawSvgContent} style={{ flex: 1, fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#334155', borderRadius: '4px', color: 'white', border: '1px solid #475569', cursor: rawSvgContent ? 'pointer' : 'not-allowed', opacity: rawSvgContent ? 1 : 0.5 }}>
                  Save Project
                </button>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <label htmlFor="image-upload" style={{ flex: 1, cursor: 'pointer' }}>
                  <div role="button" className="btn-upload" style={{
                    backgroundColor: '#3b82f6', color: 'white', padding: '0.6em 0', borderRadius: '8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 500, fontSize: '0.85rem',
                    transition: 'background-color 0.2s'
                  }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2563eb'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}>
                    <Upload size={16} /> Image
                  </div>
                  <input id="image-upload" type="file" accept=".png, .jpg, .jpeg, .webp" onChange={handleFileUpload} style={{ display: 'none' }} />
                </label>

                <label htmlFor="svg-upload" style={{ flex: 1, cursor: 'pointer' }}>
                  <div role="button" className="btn-upload" style={{
                    backgroundColor: '#10b981', color: 'white', padding: '0.6em 0', borderRadius: '8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 500, fontSize: '0.85rem',
                    transition: 'background-color 0.2s'
                  }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#059669'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#10b981'}>
                    <Upload size={16} /> SVG
                  </div>
                  <input id="svg-upload" type="file" accept=".svg" onChange={handleFileUpload} style={{ display: 'none' }} />
                </label>
              </div>

              {svgUrl && (
                <button
                  onClick={() => {
                    const currentSvgStr = generateSVGFromCurrentShapes();
                    const blob = new Blob([currentSvgStr || rawSvgContent || ''], { type: 'image/svg+xml' });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = 'modified_vectorized.svg';
                    link.click();
                  }}
                  style={{
                    width: '100%', padding: '0.4rem', backgroundColor: '#334155', color: 'white', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: '0.4rem', transition: 'background-color 0.2s', marginTop: '0.5rem'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#475569'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                >
                  <Download size={14} /> Download 2D SVG
                </button>
              )}

              {imageDataUrl && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    <label htmlFor="color-count">Image Colors To Extract</label>
                    <span>{colorCount}</span>
                  </div>
                  <HoverSlider id="color-count" min="2" max="256" step="1" value={colorCount} onChange={handleColorCountChange} displayFormat={(v: number) => Math.round(v).toString()} />
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><LayoutGrid size={14} style={{ marginRight: '6px' }} /> Geometry Settings</div>
            <div className="card-body" style={{ gap: '0.5rem' }}>
              <label className="checkbox-label" htmlFor="seal-gaps">
                <input id="seal-gaps" type="checkbox" checked={sealGaps} onChange={(e) => setSealGaps(e.target.checked)} />
                Seal gaps (adds slight bevel)
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label className="checkbox-label" htmlFor="cut-overlaps" style={{ cursor: svgUrl ? 'not-allowed' : 'pointer', opacity: svgUrl ? 0.5 : 1 }}>
                  <input id="cut-overlaps" type="checkbox" checked={cutOverlaps} onChange={(e) => setCutOverlaps(e.target.checked)} disabled={!!svgUrl} />
                  Cut overlaps (puzzle pieces)
                </label>
                {svgUrl && (
                  <span style={{ fontSize: '0.65rem', color: '#ef4444', paddingLeft: '1.5rem' }}>
                    Must be set before uploading SVG.
                  </span>
                )}
              </div>
              <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '0.5rem 0' }} />
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px', color: '#cbd5e1' }}>
                  <span>Quick Select by Size</span>
                  <span>{selectSizeThreshold}</span>
                </div>
                <HoverSlider
                  min="0"
                  max="10000"
                  step="10"
                  value={selectSizeThreshold}
                  onChange={(e: any) => handleSelectBySizeChange(parseFloat(e.target.value))}
                  displayFormat={(v: number) => Math.round(v).toString()}
                />
              </div>
            </div>
          </div>

          {uniqueColors.length > 0 && (
            <div className="card">
              <div className="card-header"><Droplet size={14} style={{ marginRight: '6px' }} /> Global Color Palette</div>
              <div className="card-body">
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button onClick={() => setSelectedMeshIds(currentMeshColors.map(m => m.id))} style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', flex: 1, backgroundColor: '#3b82f6' }}>Select All</button>
                  <button onClick={() => setSelectedMeshIds([])} style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', flex: 1, backgroundColor: '#64748b' }}>Deselect All</button>
                </div>
                <div className="colors-scroll-container" style={{
                  display: 'flex', flexWrap: 'wrap', gap: '0.5rem', height: '140px', minHeight: '60px', maxHeight: '40vh',
                  overflowY: 'auto', alignContent: 'flex-start', padding: '0.5rem', resize: 'vertical',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.2)'
                }}>
                  {uniqueColors.map(colorHex => {
                    const idsOfColor = currentMeshColors.filter(m => m.colorHex === colorHex).map(m => m.id);
                    const isAllSelected = idsOfColor.length > 0 && idsOfColor.every(id => selectedMeshIds.includes(id));
                    const isPartiallySelected = !isAllSelected && idsOfColor.some(id => selectedMeshIds.includes(id));

                    return (
                      <div
                        key={colorHex}
                        onClick={() => toggleColorSelection(colorHex)}
                        style={{
                          width: '28px', height: '28px', backgroundColor: `#${colorHex}`, borderRadius: '6px',
                          cursor: 'pointer', border: isAllSelected ? '2px solid #fff' : isPartiallySelected ? '2px solid #60a5fa' : '1px solid rgba(255,255,255,0.2)',
                          boxShadow: (isAllSelected || isPartiallySelected) ? '0 0 0 2px rgba(59,130,246,0.5)' : 'none',
                          position: 'relative', boxSizing: 'border-box', transition: 'transform 0.1s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        title={`#${colorHex}`}
                      >
                        {isAllSelected && (
                          <div style={{
                            position: 'absolute', top: '-6px', right: '-6px', background: '#3b82f6', color: 'white',
                            borderRadius: '50%', width: '14px', height: '14px', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: '9px', fontWeight: 'bold'
                          }}>✓</div>
                        )}
                        {isPartiallySelected && (
                          <div style={{
                            position: 'absolute', top: '-6px', right: '-6px', background: '#64748b', color: 'white',
                            borderRadius: '50%', width: '14px', height: '14px', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', lineHeight: 1
                          }}>-</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {selectedUniqueColors.length === 1 && !isMerging && (
                  <button onClick={handleAutoSelectSimilar} style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#10b981', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }}>
                    Auto-Select Similar Colors
                  </button>
                )}

                {/* --- MOVED FROM RIGHT SIDEBAR --- */}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Custom Color Override:</div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', opacity: selectedMeshIds.length > 0 ? 1 : 0.5, pointerEvents: selectedMeshIds.length > 0 ? 'auto' : 'none' }}>
                    <input
                      type="color"
                      value={`#${selectedUniqueColors.length === 1 ? selectedUniqueColors[0] : 'ffffff'}`}
                      onBlur={handleCustomColorChange}
                      onChange={() => { }}
                      style={{ width: '32px', height: '32px', border: 'none', padding: 0, background: 'transparent', cursor: 'pointer' }}
                      title="Pick a custom color (applies when picker is closed)"
                    />
                    <div style={{ flex: 1, display: 'flex', gap: '4px', overflowX: 'auto', padding: '2px 0' }}>
                      {uniqueColors.slice(0, 10).map(colorHex => (
                        <div
                          key={`palette-${colorHex}`}
                          onClick={() => {
                            if (selectedMeshIds.length === 0) return;
                            setMeshColorOverrides(prev => {
                              const next = { ...prev };
                              selectedMeshIds.forEach(id => next[id] = colorHex);
                              return next;
                            });
                            pushToHistory();
                          }}
                          style={{
                            minWidth: '20px', height: '20px', backgroundColor: `#${colorHex}`, borderRadius: '4px', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.2)'
                          }}
                          title={`Apply #${colorHex}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                  <button
                    onClick={initiateFuse}
                    disabled={selectedMeshIds.length <= 1 || isMerging || isFusingSelection}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', fontSize: '0.7rem', padding: '0.5rem', backgroundColor: '#f97316', color: 'white', border: 'none', borderRadius: '4px', opacity: selectedMeshIds.length > 1 ? 1 : 0.5, cursor: selectedMeshIds.length > 1 ? 'pointer' : 'not-allowed' }}
                    title="Fuse Touching Parts"
                  >
                    <Combine size={14} /> Fuse Parts
                  </button>
                  <button
                    onClick={() => setIsMerging(true)}
                    disabled={selectedUniqueColors.length <= 1 || isMerging}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', fontSize: '0.7rem', padding: '0.5rem', backgroundColor: '#8b5cf6', color: 'white', border: 'none', borderRadius: '4px', opacity: selectedUniqueColors.length > 1 ? 1 : 0.5, cursor: selectedUniqueColors.length > 1 ? 'pointer' : 'not-allowed' }}
                  >
                    <WrapText size={14} /> Merge Colors
                  </button>
                </div>

                {isMerging && (
                  <div style={{ marginTop: '0.75rem', backgroundColor: 'rgba(51,65,85,0.5)', padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: '0.75rem', marginBottom: '0.75rem', color: '#cbd5e1' }}>Select target color to merge into:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                      {selectedUniqueColors.map(colorHex => (
                        <div key={`target-${colorHex}`} style={{ position: 'relative' }}>
                          <div
                            onClick={() => executeMergeColors(colorHex)}
                            style={{
                              width: '32px', height: '32px', backgroundColor: `#${colorHex}`, borderRadius: '50%',
                              cursor: 'pointer', border: '2px solid rgba(255,255,255,0.2)', transition: 'transform 0.1s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            title={`Merge into #${colorHex}`}
                          />
                          <div
                            onClick={(e) => { e.stopPropagation(); removeColorFromSelection(colorHex); }}
                            style={{
                              position: 'absolute', top: '-4px', right: '-4px', width: '16px', height: '16px',
                              backgroundColor: '#ef4444', color: 'white', borderRadius: '50%', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold',
                              cursor: 'pointer', border: '1px solid #1e293b'
                            }}
                            title="Remove color from selection"
                          >✕</div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setIsMerging(false)} style={{ marginTop: '0.75rem', fontSize: '0.7rem', padding: '0.3rem 0.5rem', backgroundColor: 'transparent', border: '1px solid #64748b', width: '100%' }}>
                      Cancel Merge
                    </button>
                  </div>
                )}
                {isFusingSelection && (
                  <div style={{ marginTop: '0.75rem', backgroundColor: 'rgba(51,65,85,0.5)', padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: '0.75rem', marginBottom: '0.75rem', color: '#cbd5e1' }}>Select color for the fused part:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                      {selectedUniqueColors.map(colorHex => (
                        <div key={`fuse-target-${colorHex}`} style={{ position: 'relative' }}>
                          <div
                            onClick={() => executeFuse(colorHex)}
                            style={{
                              width: '32px', height: '32px', backgroundColor: `#${colorHex}`, borderRadius: '50%',
                              cursor: 'pointer', border: '2px solid rgba(255,255,255,0.2)', transition: 'transform 0.1s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            title={`Make fused part #${colorHex}`}
                          />
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setIsFusingSelection(false)} style={{ marginTop: '0.75rem', fontSize: '0.7rem', padding: '0.3rem 0.5rem', backgroundColor: 'transparent', border: '1px solid #64748b', width: '100%' }}>
                      Cancel Fuse
                    </button>
                  </div>
                )}

              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header"><Droplet size={14} style={{ marginRight: '6px' }} /> Highlight Style</div>
            <div className="card-body">
              <div className="segmented-control">
                <label>
                  <input type="radio" name="highlightStyle" checked={highlightStyle === 'dashed'} onChange={() => setHighlightStyle('dashed')} />
                  <span>Dashed</span>
                </label>
                <label>
                  <input type="radio" name="highlightStyle" checked={highlightStyle === 'solid'} onChange={() => setHighlightStyle('solid')} />
                  <span>Striped</span>
                </label>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 'auto' }}>
            <div className="card-header"><Download size={14} style={{ marginRight: '6px' }} /> Export Options</div>
            <div className="card-body">
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <div style={{ flex: 1 }}>
                  <label className="checkbox-label" style={{ fontSize: '0.75rem', marginBottom: '0.35rem', color: '#94a3b8' }}>Printer Profile</label>
                  <select className="custom-select" value={printerProfile} onChange={(e) => setPrinterProfile(e.target.value as any)}>
                    <option value="A1 Mini (180x180)">A1 Mini (180x180)</option>
                    <option value="X1/P1/A1 (256x256)">X1/P1/A1 (256x256)</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="checkbox-label" style={{ fontSize: '0.75rem', marginBottom: '0.35rem', color: '#94a3b8' }}>Export Layout</label>
                  <select className="custom-select" value={gridSize} onChange={(e) => setGridSize(e.target.value)}>
                    <option value="auto">Auto (Max 2x2)</option>
                    <option value="1x1">1x1 Plate</option>
                    <option value="2x2">2x2 Plates</option>
                    <option value="1x2">1x2 (Vertical)</option>
                    <option value="2x1">2x1 (Horizontal)</option>
                  </select>
                </div>
              </div>

              {gridSize === 'auto' && (
                <div>
                  <label className="checkbox-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem' }}>Scale Multiplier (%)</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}><HoverSlider min="10" max="500" step="10" value={customScale} onChange={(e: any) => setCustomScale(Number(e.target.value))} displayFormat={(v: number) => `${Math.round(v)}%`} /></div>
                    <span style={{ fontSize: '0.75rem', width: '40px', color: 'white', textAlign: 'right' }}>{customScale}%</span>
                  </div>
                  <label className="checkbox-label" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                    <input type="checkbox" checked={scaleZProportionally} onChange={(e) => setScaleZProportionally(e.target.checked)} />
                    Scale Depth Proportionally
                  </label>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>
                  <input type="checkbox" checked={mergeColors3MF} onChange={(e) => setMergeColors3MF(e.target.checked)} />
                  Join objects by color for 3MF
                </label>

                {!mergeColors3MF && (
                  <div style={{ paddingLeft: '1.5rem', marginTop: '-0.25rem', marginBottom: '0.25rem' }}>
                    <label className="checkbox-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem', color: '#94a3b8' }}>Assembly Clearance (mm)</label>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}><HoverSlider min="0" max="0.5" step="0.05" value={clearance} onChange={(e: any) => setClearance(Number(e.target.value))} displayFormat={(v: number) => v.toFixed(2)} /></div>
                      <span style={{ fontSize: '0.75rem', width: '30px', color: 'white', textAlign: 'right' }}>{clearance.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>
                  <input type="checkbox" checked={mergeBeforeExport} onChange={(e) => setMergeBeforeExport(e.target.checked)} />
                  Join objects for STL (Single Mesh)
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button disabled={!svgUrl || !!exportStatus} style={{ width: '100%', backgroundColor: '#ec4899' }} onClick={handleExport3MF}>
                  <Download size={16} /> Export 3MF (Multi-Plate)
                </button>
                <button disabled={!svgUrl} style={{ width: '100%', backgroundColor: '#475569', fontSize: '0.8rem', padding: '0.5rem' }} onClick={handleExport}>
                  <Download size={14} /> Export STL (Raw)
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* MAIN CONTENT */}
        <div className="main-content" style={{ position: 'relative' }}>
          {(isTracing || fuseStatus || exportStatus) && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.8)', zIndex: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
            }}>
              <div className="spinner" style={{
                width: '40px', height: '40px', border: '4px solid #334155',
                borderTop: '4px solid #3b82f6', borderRadius: '50%',
                animation: 'spin 1s linear infinite', marginBottom: '1rem'
              }} />
              <div style={{ color: '#f8fafc', fontSize: '1.2rem', fontWeight: 'bold', textAlign: 'center' }}>
                {exportStatus || fuseStatus || isTracing}
              </div>
              <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {!svgUrl && !isTracing && !fuseStatus && (
            <div className="empty-state">
              Upload an SVG or Image to get started
            </div>
          )}

          {svgUrl && (
            <Canvas frameloop="demand" camera={{ position: [0, 0, 100], fov: 50 }} onPointerMissed={() => setSelectedMeshIds([])}>
              <ambientLight intensity={0.5} />
              <directionalLight position={[10, 10, 10]} intensity={1} castShadow />
              <OrbitControls makeDefault />
              <Suspense fallback={null}>
                <Center>
                  <group ref={sceneRef}>
                    <SvgModel
                      ref={svgModelRef}
                      svgUrl={svgUrl}
                      highlightStyle={highlightStyle}
                      sealGaps={sealGaps}
                      cutOverlaps={cutOverlaps}
                      selectedMeshIds={selectedMeshIds}
                      previewMeshIds={previewMeshIds}
                      meshDepths={meshDepths}
                      meshColorOverrides={meshColorOverrides}
                      onSelect={(ids, shiftKey) => {
                        setSelectedMeshIds(prev => {
                          if (shiftKey) {
                            const isAdding = !prev.includes(ids[0]);
                            if (isAdding) {
                              return [...new Set([...prev, ...ids])];
                            } else {
                              return prev.filter(i => !ids.includes(i));
                            }
                          } else {
                            if (prev.length === ids.length && ids.every(i => prev.includes(i))) {
                              return [];
                            }
                          }
                          return ids;
                        });
                      }}
                      onVerticesCalculated={setVertexCount}
                      onParseProgress={(msg) => setIsTracing(msg)}
                      onParseComplete={(extractedColors) => {
                        setIsTracing(null);
                        if (extractedColors) setMeshColors(extractedColors);
                      }}
                    />
                  </group>
                </Center>
              </Suspense>
            </Canvas>
          )}
        </div>

        {/* RIGHT SIDEBAR (Contextual) */}
        <div className="right-sidebar">
          {selectedMeshIds.length > 0 ? (
            <>
              <div className="card" style={{ border: '1px solid #3b82f6', boxShadow: '0 0 15px rgba(59, 130, 246, 0.15)' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center' }}><Settings size={14} style={{ marginRight: '6px' }} /> Properties</span>
                  <button
                    style={{ padding: '0.2rem', backgroundColor: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                    onClick={handleDeleteSelected}
                    title="Delete Selected Parts"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="card-body">
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <label htmlFor="depth-slider" style={{ fontSize: '0.8rem', fontWeight: 600, color: '#60a5fa' }}>Extrusion Depth</label>
                      <span style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>{currentDepth.toFixed(1)}</span>
                    </div>
                    <HoverSlider id="depth-slider" min="0" max="20" step="0.1" value={currentDepth} onChange={handleDepthChange} onPointerDown={handleDepthPointerDown} disabled={selectedMeshIds.length === 0} />
                  </div>




                </div>
              </div>

              <div className="card">
                <div className="card-header"><Zap size={14} style={{ marginRight: '6px' }} /> Quick Actions</div>
                <div className="card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>

                    <button
                      onClick={handleExtractInner}
                      disabled={isExtracting}
                      style={{ flexDirection: 'column', fontSize: '0.7rem', padding: '0.5rem', gap: '0.25rem', backgroundColor: '#334155', color: '#06b6d4' }}
                      title={isExtracting ? (extractStatus || "Working...") : "Fill Enclosed Holes"}
                    >
                      <Combine size={18} />
                      <span>{isExtracting ? "Working..." : "Fill Holes"}</span>
                    </button>

                    <button
                      onClick={handleCreateBasePlate}
                      disabled={isBasePlating}
                      style={{ flexDirection: 'column', fontSize: '0.7rem', padding: '0.5rem', gap: '0.25rem', backgroundColor: '#334155', color: '#8b5cf6' }}
                      title={isBasePlating ? (basePlateStatus || "Working...") : "Fill Body (Base Plate)"}
                    >
                      <LayoutTemplate size={18} />
                      <span>{isBasePlating ? "Working..." : "Fill Body"}</span>
                    </button>

                    <button
                      onClick={handleSplitDisjoint}
                      disabled={isSplitting}
                      style={{ flexDirection: 'column', fontSize: '0.7rem', padding: '0.5rem', gap: '0.25rem', backgroundColor: '#334155', color: '#a855f7' }}
                      title={isSplitting ? (splitStatus || "Working...") : "Separate Disjoint Parts"}
                    >
                      <SplitSquareHorizontal size={18} />
                      <span>{isSplitting ? "Working..." : "Separate"}</span>
                    </button>

                    <button
                      onClick={handlePreviewShards}
                      disabled={isAbsorbingShards}
                      style={{ flexDirection: 'column', fontSize: '0.7rem', padding: '0.5rem', gap: '0.25rem', backgroundColor: '#334155', color: '#4f46e5' }}
                      title="Clean Edge Shards"
                    >
                      <Network size={18} />
                      <span>{isAbsorbingShards ? "Scanning..." : "Clean Shards"}</span>
                    </button>



                  </div>

                  {pendingShards && (
                    <div style={{ marginTop: '0.75rem', backgroundColor: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '6px' }}>
                      <div style={{ fontSize: '0.65rem', marginBottom: '0.25rem', color: '#cbd5e1' }}>Select colors to absorb:</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '100px', overflowY: 'auto' }}>
                        {Object.entries(pendingShards).map(([colorHex, ids]) => (
                          <label key={colorHex} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: 'white' }}>
                            <input
                              type="checkbox"
                              checked={!ignoredShardColors.includes(colorHex)}
                              onChange={(e) => {
                                if (e.target.checked) setIgnoredShardColors(prev => prev.filter(c => c !== colorHex));
                                else setIgnoredShardColors(prev => [...prev, colorHex]);
                              }}
                            />
                            <div style={{ width: '10px', height: '10px', backgroundColor: `#${colorHex}` }} />
                            {ids.length} pieces
                          </label>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                        <button onClick={() => setPendingShards(null)} style={{ flex: 1, fontSize: '0.65rem', padding: '0.25rem', borderRadius: '4px', backgroundColor: '#64748b', color: 'white', border: 'none' }}>Cancel</button>
                        <button onClick={confirmAbsorbShards} disabled={isAbsorbingShards} style={{ flex: 1, fontSize: '0.65rem', padding: '0.25rem', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '4px' }}>Confirm</button>
                      </div>
                    </div>
                  )}




                </div>
              </div>

              <div className="card">
                <div className="card-header"><MoveVertical size={14} style={{ marginRight: '6px' }} /> Precision Modifiers</div>
                <div className="card-body" style={{ gap: '1rem' }}>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '4px', color: '#cbd5e1' }}>
                      <span>Outline Border Width</span>
                      <span>{borderWidth.toFixed(1)}px</span>
                    </div>
                    <HoverSlider min="0.1" max="5" step="0.1" value={borderWidth} onChange={(e: any) => setBorderWidth(parseFloat(e.target.value))} />
                    <button
                      style={{ width: '100%', fontSize: '0.75rem', padding: '0.4rem', backgroundColor: '#eab308', marginTop: '6px', border: 'none', color: 'white', borderRadius: '4px', cursor: isBordering ? 'not-allowed' : 'pointer' }}
                      onClick={handleCreateBorder}
                      disabled={isBordering}
                    >
                      {isBordering ? borderStatus || "Working..." : "Generate Border"}
                    </button>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)' }} />

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '4px', color: '#cbd5e1' }}>
                      <span>Expand Size (Fill Gaps)</span>
                      <span>{expandAmount.toFixed(1)}px</span>
                    </div>
                    <HoverSlider min="0.1" max="5" step="0.1" value={expandAmount} onChange={(e: any) => setExpandAmount(parseFloat(e.target.value))} />
                    <button
                      style={{ width: '100%', fontSize: '0.75rem', padding: '0.4rem', backgroundColor: '#6366f1', marginTop: '6px', border: 'none', color: 'white', borderRadius: '4px', cursor: isExpanding ? 'not-allowed' : 'pointer' }}
                      onClick={handleExpandSelected}
                      disabled={isExpanding}
                    >
                      {isExpanding ? expandStatus || "Working..." : "Expand Selected"}
                    </button>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)' }} />

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '4px', color: '#cbd5e1' }}>
                      <span>Smooth Intensity</span>
                      <span>{smoothAmount.toFixed(1)}</span>
                    </div>
                    <HoverSlider min="0.1" max="5" step="0.1" value={smoothAmount} onChange={(e: any) => setSmoothAmount(parseFloat(e.target.value))} />
                    <button
                      style={{ width: '100%', fontSize: '0.75rem', padding: '0.4rem', backgroundColor: '#ec4899', marginTop: '6px', border: 'none', color: 'white', borderRadius: '4px', cursor: isSmoothing ? 'not-allowed' : 'pointer' }}
                      onClick={handleSmoothSelected}
                      disabled={isSmoothing}
                    >
                      {isSmoothing ? smoothStatus || "Working..." : "Smooth Selected"}
                    </button>
                  </div>

                </div>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.5 }}>
              <LayoutGrid size={48} style={{ marginBottom: '1rem', color: '#64748b' }} />
              <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#94a3b8' }}>No Parts Selected</div>
              <p style={{ fontSize: '0.8rem', color: '#64748b', textAlign: 'center', marginTop: '0.5rem', padding: '0 1rem' }}>
                Click on any part of the 3D model to edit its extrusion depth, color, and apply advanced shape modifiers.
              </p>


            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default App;
