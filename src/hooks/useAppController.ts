import { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { type SvgModelRef } from '../components/SvgModel';
import { useHistory } from './useHistory';
import { exportToSTL, areExtrusionHeightsUniform } from '../lib/export-utils';
import {
  estimateExportScaleFactor,
  findThinWallParts,
  THIN_WALL_THRESHOLD_MM,
  type ThinWallPart,
} from '../lib/thin-wall-check';
import { computeAutoExtrudeDepths, calculateLineArtParams, generateSVGFromShapes, LINE_ART_DEPTH } from '../lib/app-logic';
import { prepareCanvasForVtracer, quantizePreparedImage, snapSvgColorsToPalette } from '../lib/image-preprocess';
import { sealAndStraightenSvg } from '../lib/svg-path-cleanup';
import { mergeSvgFills, normalizeSvgForPreview } from '../lib/svg-preview';
import { getWebsitePresetAdvancedDefaults } from '../lib/vtracer-trace';
import {
  DEFAULT_TRACER_ID,
  isTracerId,
  isWebsiteTracer,
  listTracerBackends,
  traceRasterToSvg,
  type TracerId,
  type VTracerPresetId,
} from '../lib/tracers';

export type PipelinePhase = 'idle' | 'svgPreview' | 'extrudeReady';

export function useAppController() {
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  /** Blob URL for 2D SVG preview before promoting to 3D (SvgModel). */
  const [previewSvgUrl, setPreviewSvgUrl] = useState<string | null>(null);
  const [pipelinePhase, setPipelinePhase] = useState<PipelinePhase>('idle');
  const [fitTrigger, setFitTrigger] = useState(0);
  const [rawSvgContent, setRawSvgContent] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [colorCount, setColorCount] = useState<number>(8);
  const [tracerId, setTracerId] = useState<TracerId>(DEFAULT_TRACER_ID);
  const [vtracerPreset, setVtracerPreset] = useState<VTracerPresetId>('logo');
  /** Print-path filter_speckle UI (area = n²). Default 12 matches prior hardcoded 144. */
  const [vtracerFilterSpeckle, setVtracerFilterSpeckle] = useState(12);
  /** Print-path color precision bits (1–8). 0 = auto from color-count tiers. */
  const [vtracerColorPrecisionBits, setVtracerColorPrecisionBits] = useState(0);
  /** Vectorize Image advanced (site UI bits / speck / path). */
  const [viColorPrecision, setViColorPrecision] = useState(6);
  const [viFilterSpeckle, setViFilterSpeckle] = useState(4);
  const [viPathPrecision, setViPathPrecision] = useState(2);
  /** Cap unique SVG fills after VI trace (snap only; no pre-posterize). */
  const [viMaxColors, setViMaxColors] = useState(24);
  const [selectedMeshIds, setSelectedMeshIds] = useState<string[]>([]);

  const [vertexCount, setVertexCount] = useState<number>(0);
  const [isTracing, setIsTracing] = useState<string | null>(null);
  const [highlightStyle, setHighlightStyle] = useState<'dashed' | 'solid'>('solid');
  const [sealGaps, setSealGaps] = useState<boolean>(true);
  const [backingDepth, setBackingDepth] = useState<number>(2);
  const [cutOverlaps, setCutOverlaps] = useState<boolean>(true);
  const [selectSizeThreshold, setSelectSizeThreshold] = useState<number>(0);
  const [shapeAreasCache, setShapeAreasCache] = useState<{ id: string, area: number }[] | null>(null);
  const [mergeBeforeExport, setMergeBeforeExport] = useState<boolean>(false);
  const [printFaceDown, setPrintFaceDown] = useState<boolean>(false);
  const [colorOnFaceOnly, setColorOnFaceOnly] = useState<boolean>(false);
  const [faceColorDepthMm, setFaceColorDepthMm] = useState<number>(0.2);
  const [faceBaseColorHex, setFaceBaseColorHex] = useState<string>('ffffff');

  const [meshColors, setMeshColors] = useState<{ id: string, colorHex: string }[]>([]);
  const [meshColorOverrides, setMeshColorOverrides] = useState<Record<string, string>>({});
  const [meshDepths, setMeshDepths] = useState<Record<string, number>>({});

  const canPrintFaceDown = areExtrusionHeightsUniform(
    meshColors.map(m => m.id),
    meshDepths
  );

  useEffect(() => {
    if (!canPrintFaceDown && printFaceDown) {
      setPrintFaceDown(false);
    }
  }, [canPrintFaceDown, printFaceDown]);

  const sceneRef = useRef<THREE.Group>(null);
  const svgModelRef = useRef<SvgModelRef>(null);
  const pipelinePhaseRef = useRef<PipelinePhase>('idle');
  useEffect(() => {
    pipelinePhaseRef.current = pipelinePhase;
  }, [pipelinePhase]);

  const getCurrentState = useCallback(() => ({
    meshDepths: { ...meshDepths },
    meshColorOverrides: { ...meshColorOverrides },
    meshColors: [...meshColors],
    shapes: svgModelRef.current?.getShapes(),
    selectedMeshIds: [...selectedMeshIds],
    rawSvgContent,
  }), [meshDepths, meshColorOverrides, meshColors, selectedMeshIds, rawSvgContent]);

  const applyState = useCallback((state: any) => {
    setMeshDepths(state.meshDepths);
    setMeshColorOverrides(state.meshColorOverrides);
    setMeshColors(state.meshColors);
    if (svgModelRef.current && state.shapes) {
      svgModelRef.current.setShapes(state.shapes);
    }
    if (state.selectedMeshIds) {
      setSelectedMeshIds(state.selectedMeshIds);
    } else {
      setSelectedMeshIds([]);
    }
    if (state.rawSvgContent !== undefined) {
      setRawSvgContent(state.rawSvgContent);
      if (typeof state.rawSvgContent === 'string' && pipelinePhaseRef.current === 'svgPreview') {
        setPreviewSvgUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(
            new Blob([normalizeSvgForPreview(state.rawSvgContent)], { type: 'image/svg+xml' }),
          );
        });
      }
    }
  }, []);

  const { pushToHistory, handleUndo, handleRedo, canUndo, canRedo, clearHistory } = useHistory(getCurrentState, applyState);

  const [mergeColors3MF, setMergeColors3MF] = useState<boolean>(true);
  const [isMerging, setIsMerging] = useState(false);
  const [isFusingSelection, setIsFusingSelection] = useState(false);
  const [fuseStatus, setFuseStatus] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState<string | null>(null);
  const [isBasePlating, setIsBasePlating] = useState(false);
  const [basePlateStatus, setBasePlateStatus] = useState<string | null>(null);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [thinWallParts, setThinWallParts] = useState<ThinWallPart[]>([]);

  const [printerProfile, setPrinterProfile] = useState<'A1 Mini (180x180)' | 'X1/P1/A1 (256x256)'>('X1/P1/A1 (256x256)');
  const [gridSize, setGridSize] = useState<string>("auto");
  const buildPlateSize = printerProfile === 'A1 Mini (180x180)' ? 180 : 256;
  const printerModel = printerProfile === 'A1 Mini (180x180)' ? 'a1_mini' : 'x1c';
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [customScale, setCustomScale] = useState<number>(100);
  const [scaleZProportionally, setScaleZProportionally] = useState<boolean>(false);
  const [clearance, setClearance] = useState<number>(0.0);

  useEffect(() => {
    if (!showExportOptions) {
      setThinWallParts([]);
      return;
    }

    const timer = window.setTimeout(() => {
      const shapes = svgModelRef.current?.getShapes() ?? [];
      if (shapes.length === 0) {
        setThinWallParts([]);
        return;
      }
      const scaleFactor = estimateExportScaleFactor({
        shapes,
        buildPlateSize,
        gridSize,
        customScale: customScale / 100.0,
      });
      const effectiveClearance = mergeColors3MF ? 0 : clearance;
      const thin = findThinWallParts(shapes, {
        scaleFactor,
        clearanceMm: effectiveClearance,
        thresholdMm: THIN_WALL_THRESHOLD_MM,
      });
      setThinWallParts(thin);
    }, 150);

    return () => window.clearTimeout(timer);
  }, [
    showExportOptions,
    buildPlateSize,
    gridSize,
    customScale,
    clearance,
    mergeColors3MF,
    meshColors,
    meshDepths,
  ]);

  const handleSelectThinParts = useCallback(() => {
    if (thinWallParts.length === 0) return;
    setSelectedMeshIds(thinWallParts.map(p => p.id));
    setShowExportOptions(false);
  }, [thinWallParts]);

  const colorChangeTimeout = useRef<number | null>(null);
  const traceIdRef = useRef<number>(0);
  /** Prepared RGBA snapshot for re-trace when the color slider changes (no PNG roundtrip). */
  const sourceRgbaRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);

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
    const allSelected = idsOfColor.every(id => selectedMeshIds.includes(id));
    if (allSelected) {
      setSelectedMeshIds(prev => prev.filter(id => !idsOfColor.includes(id)));
    } else {
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
    const threshold = 2500;
    const similarColors = uniqueColors.filter(c => getColorDistance(baseColor, c) < threshold);
    const idsToSelect = currentMeshColors
      .filter(m => similarColors.includes(m.colorHex))
      .map(m => m.id);
    setSelectedMeshIds(prev => [...new Set([...prev, ...idsToSelect])]);
  };

  const handleAutoExtrude = () => {
    if (!svgModelRef.current) return;
    const allShapes = svgModelRef.current.getShapes();
    if (allShapes.length === 0) return;
    pushToHistory();
    const newDepths = computeAutoExtrudeDepths(allShapes, meshColorOverrides);
    setMeshDepths(prev => ({ ...prev, ...newDepths }));
  };

  const handleConvertToLineArt = async () => {
    if (!svgModelRef.current) return;
    const allShapes = svgModelRef.current.getShapes();
    if (allShapes.length === 0) return;
    pushToHistory();

    const { newDepths, newColors, lightShapeIds, darkShapeIds, targetWidth } = calculateLineArtParams(allShapes, meshColorOverrides, lineArtWidth);

    setIsBordering(true);
    setBorderStatus("Generating uniform line art...");

    try {
      const newIds = await svgModelRef.current.generateUniformLineArt(targetWidth, lightShapeIds, darkShapeIds, (msg: string) => setBorderStatus(msg));
      if (newIds && newIds.length > 0) {
        newIds.forEach(id => {
          newDepths[id] = LINE_ART_DEPTH;
          newColors[id] = '000000';
        });
      }
      setMeshDepths(prev => ({ ...prev, ...newDepths }));
      setMeshColorOverrides(prev => ({ ...prev, ...newColors }));
    } catch (e) {
      alert("Failed to generate line art.");
    } finally {
      setIsBordering(false);
      setBorderStatus(null);
    }
  };

  const executeFuse = async (targetColorHex: string) => {
    setIsFusingSelection(false);
    setIsMerging(false);
    if (!svgModelRef.current) return;

    pushToHistory();
    setFuseStatus("Initializing fusion...");
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    const maxDepth = Math.max(0, ...selectedMeshIds.map(id => meshDepths[id] ?? 0));
    const newIds = await svgModelRef.current.fuseSelected(selectedMeshIds, targetColorHex, false, (msg: string) => {
      setFuseStatus(msg);
    });

    if (newIds && newIds.length > 0) {
      setMeshDepths(prev => {
        const next = { ...prev };
        newIds.forEach(id => { next[id] = maxDepth; });
        return next;
      });
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
  
  const initiateFuse = () => {
    if (selectedUniqueColors.length > 1) {
      setIsFusingSelection(true);
    } else {
      executeFuse(selectedUniqueColors[0] || "000000");
    }
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

    setShowExportOptions(false);
    try {
      const zipBlob = await svgModelRef.current.sliceAndExport(
        buildPlateSize, gridSize, printerModel, mergeColors3MF, customScale / 100.0, mergeColors3MF ? 0 : clearance, scaleZProportionally,
        (msg) => setExportStatus(msg),
        printFaceDown && canPrintFaceDown,
        colorOnFaceOnly ? faceColorDepthMm : 0,
        faceBaseColorHex
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

  const handleExportSTLAction = () => {
    if (!sceneRef.current) return;
    setShowExportOptions(false);
    try {
      exportToSTL(sceneRef.current, customScale, scaleZProportionally, mergeBeforeExport, printFaceDown && canPrintFaceDown);
    } catch (e) {
      alert("Failed to export STL. Check console for details.");
    }
  };

  const generateSVGFromCurrentShapes = () => {
    if (!svgModelRef.current) return rawSvgContent;
    const shapesData = svgModelRef.current.getShapes();
    return generateSVGFromShapes(shapesData, meshColorOverrides) || rawSvgContent;
  };

  const handleSaveProject = () => {
    if (!rawSvgContent) { alert("No active model to save."); return; }
    const projectData = {
      rawSvgContent, colorCount, tracerId, vtracerPreset, meshDepths, meshColorOverrides, selectedMeshIds,
      highlightStyle, sealGaps, backingDepth, cutOverlaps, customScale, clearance, printerProfile, gridSize, mergeColors3MF
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
          setPreviewSvgUrl(svgBlobUrl);
          setPipelinePhase('extrudeReady');
          setColorCount(Math.min(64, Math.max(2, projectData.colorCount || 8)));
          if (isTracerId(projectData.tracerId)) setTracerId(projectData.tracerId);
          if (projectData.vtracerPreset === 'logo' || projectData.vtracerPreset === 'sketch' || projectData.vtracerPreset === 'photo') {
            setVtracerPreset(projectData.vtracerPreset);
          }
          setMeshDepths(projectData.meshDepths || {});
          setMeshColorOverrides(projectData.meshColorOverrides || {}); setSelectedMeshIds(projectData.selectedMeshIds || []);
          setHighlightStyle(projectData.highlightStyle || 'solid'); setSealGaps(projectData.sealGaps ?? true);
          setBackingDepth(projectData.backingDepth ?? 2);
          setCutOverlaps(projectData.cutOverlaps ?? true);
          if (projectData.customScale) setCustomScale(projectData.customScale);
          if (projectData.clearance !== undefined) setClearance(projectData.clearance);
          if (projectData.printerProfile) setPrinterProfile(projectData.printerProfile);
          if (projectData.gridSize) setGridSize(projectData.gridSize);
          if (projectData.mergeColors3MF !== undefined) setMergeColors3MF(projectData.mergeColors3MF);
          clearHistory(); setMeshColors([]); setVertexCount(0); setIsMerging(false); setIsTracing(null);
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
  /** Thickness for LeftPanel Line Art (independent of Create Border). */
  const [lineArtWidth, setLineArtWidth] = useState(2.0);
  const [borderMode, setBorderMode] = useState<'inner' | 'outer' | 'both' | 'custom'>('outer');
  const [customBorderColor, setCustomBorderColor] = useState<string | null>(null);
  const [adjacentColors, setAdjacentColors] = useState<string[]>([]);
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
        const maxDepth = Math.max(0, ...allIdsToFuse.map(id => meshDepths[id] ?? 0));
        const newIds = await svgModelRef.current.fuseSelected(allIdsToFuse, targetColorHex, true, (msg: string) => setFuseStatus(msg));
        if (newIds && newIds.length > 0) {
          setMeshDepths(prev => {
            const next = { ...prev };
            newIds.forEach(id => { next[id] = maxDepth; });
            return next;
          });
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
      const newIds = await svgModelRef.current.createUniformBorder(selectedMeshIds, borderWidth, borderMode, customBorderColor, (msg: string) => setBorderStatus(msg));
      if (newIds && newIds.length > 0) {
        const avgDepth = selectedMeshIds.reduce((sum, id) => sum + (meshDepths[id] ?? 0), 0) / selectedMeshIds.length;
        setMeshDepths(prev => {
          const next = { ...prev };
          newIds.forEach(id => next[id] = avgDepth || 0);
          return next;
        });
        setMeshColorOverrides(prev => {
          const next = { ...prev };
          newIds.forEach(id => next[id] = "000000");
          return next;
        });
        setSelectedMeshIds(newIds);
      }
    } catch (e) { alert("Failed to create border."); } finally { setIsBordering(false); setBorderStatus(null); }
  };

  const traceImage = (
    rgba: { data: Uint8ClampedArray; width: number; height: number },
    colors: number,
    previewDataUrl?: string | null,
    backend: TracerId = tracerId,
    options?: {
      preset?: VTracerPresetId;
      filterSpeckle?: number;
      colorPrecisionBits?: number;
      viColorPrecision?: number;
      viFilterSpeckle?: number;
      viPathPrecision?: number;
      viMaxColors?: number;
    },
  ) => {
    // Cache raw RGBA so color slider / preset / backend can re-trace cleanly.
    sourceRgbaRef.current = {
      data: new Uint8ClampedArray(rgba.data),
      width: rgba.width,
      height: rgba.height,
    };

    const clampedColors = Math.min(64, Math.max(2, Math.round(colors)));
    const websiteMode = isWebsiteTracer(backend);
    const useLock = !websiteMode && backend === 'vtracer';
    const preset = options?.preset ?? vtracerPreset;
    const filterSpeckle = options?.filterSpeckle ?? vtracerFilterSpeckle;
    const colorPrecisionBits =
      options?.colorPrecisionBits !== undefined
        ? options.colorPrecisionBits
        : vtracerColorPrecisionBits;
    const viColor = options?.viColorPrecision ?? viColorPrecision;
    const viSpeck = options?.viFilterSpeckle ?? viFilterSpeckle;
    const viPath = options?.viPathPrecision ?? viPathPrecision;
    const viMax = Math.min(
      64,
      Math.max(2, Math.round(options?.viMaxColors ?? viMaxColors)),
    );

    let traceData: Uint8ClampedArray = rgba.data;
    let palette: Array<{ r: number; g: number; b: number }> = [];
    if (useLock) {
      // Print path only: fringe/snap, then posterize to ≤N.
      const canvas = document.createElement('canvas');
      canvas.width = rgba.width;
      canvas.height = rgba.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height), 0, 0);
        try {
          const prepared = prepareCanvasForVtracer(canvas);
          const quantized = quantizePreparedImage(
            prepared.imageData.data,
            prepared.imageData.width,
            prepared.imageData.height,
            clampedColors,
          );
          traceData = quantized.data;
          palette = quantized.palette;
        } catch {
          const quantized = quantizePreparedImage(
            rgba.data,
            rgba.width,
            rgba.height,
            clampedColors,
          );
          traceData = quantized.data;
          palette = quantized.palette;
        }
      } else {
        const quantized = quantizePreparedImage(
          rgba.data,
          rgba.width,
          rgba.height,
          clampedColors,
        );
        traceData = quantized.data;
        palette = quantized.palette;
      }
    }

    const currentTraceId = ++traceIdRef.current;
    setIsTracing("Step 3/4: Vectorizing Pixels to SVG...");
    setTimeout(async () => {
      try {
        const svgStr = await traceRasterToSvg(backend, {
          data: traceData,
          width: rgba.width,
          height: rgba.height,
          colorCount: clampedColors,
          palette,
          lockPalette: useLock,
          preset,
          filterSpeckle: useLock ? filterSpeckle : undefined,
          colorPrecisionBits: useLock && colorPrecisionBits > 0
            ? colorPrecisionBits
            : undefined,
          viColorPrecision: websiteMode ? viColor : undefined,
          viFilterSpeckle: websiteMode ? viSpeck : undefined,
          viPathPrecision: websiteMode ? viPath : undefined,
        });
        if (currentTraceId !== traceIdRef.current) return;

        // Print: seal + snap. VI: keep raw curves, snap fills to ≤viMaxColors (no seal).
        let finalSvg = svgStr;
        if (useLock) {
          finalSvg = sealAndStraightenSvg(svgStr);
          if (palette.length > 0) {
            finalSvg = snapSvgColorsToPalette(finalSvg, palette);
          }
        } else if (websiteMode) {
          try {
            const { palette: viPalette } = quantizePreparedImage(
              rgba.data,
              rgba.width,
              rgba.height,
              viMax,
            );
            if (viPalette.length > 0) {
              finalSvg = snapSvgColorsToPalette(svgStr, viPalette);
            }
          } catch {
            // Keep raw SVG if palette build fails.
          }
        }
        const blob = new Blob([finalSvg], { type: 'image/svg+xml' });
        // Display-only normalize so ImageTracer / viewBox SVGs fill the compare frame.
        const previewBlob = new Blob([normalizeSvgForPreview(finalSvg)], { type: 'image/svg+xml' });
        const previewUrl = URL.createObjectURL(previewBlob);

        setIsTracing(null);
        setRawSvgContent(finalSvg);
        setPreviewSvgUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return previewUrl;
        });
        if (previewDataUrl) setImageDataUrl(previewDataUrl);

        setSelectedMeshIds([]);
        setMeshDepths({});
        setVertexCount(0);
        clearHistory();
        setMeshColors([]);
        setMeshColorOverrides({});
        setIsMerging(false);

        if (pipelinePhaseRef.current === 'extrudeReady') {
          // Re-trace while already in 3D — refresh SvgModel from raw (un-normalized) SVG.
          const extrudeUrl = URL.createObjectURL(blob);
          setSvgUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return extrudeUrl;
          });
          setIsTracing('Step 4/4: Parsing 2D Geometry...');
        } else {
          // First convert (or preview) — show 2D SVG only until Promote.
          setSvgUrl((old) => {
            if (old) URL.revokeObjectURL(old);
            return null;
          });
          setPipelinePhase('svgPreview');
        }
      } catch (err) {
        if (currentTraceId !== traceIdRef.current) return;
        console.error('Vectorization failed', err);
        setIsTracing(null);
        alert('Vectorization failed. Please try another image, tracer, or color count.');
      }
    }, 0);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type === 'image/svg+xml') {
        setIsTracing("Loading SVG Geometry...");
        const reader = new FileReader();
        reader.onload = (evt) => {
          const svgText = evt.target?.result as string;
          const blob = new Blob([svgText], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          setTimeout(() => {
            setRawSvgContent(svgText);
            setSvgUrl(url);
            setPreviewSvgUrl(url);
            setPipelinePhase('extrudeReady');
            setImageDataUrl(null);
            setSelectedMeshIds([]);
            setMeshDepths({});
            setVertexCount(0);
            clearHistory();
            setMeshColors([]);
            setMeshColorOverrides({});
            setIsMerging(false);
          }, 50);
        };
        reader.readAsText(file);
      } else if (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp') {
        const url = URL.createObjectURL(file);
        setIsTracing("Step 1/4: Loading Image...");
        setSvgUrl(null);
        setPipelinePhase('idle');

        const img = new Image();
        img.onload = () => {
          setIsTracing("Step 1/4: Optimizing Image Resolution...");
          setTimeout(() => {
            let width = img.width;
            let height = img.height;
            // Vectorize Image keeps more resolution; VTracer print path stays lighter.
            const maxDim = isWebsiteTracer(tracerId) ? 3000 : 2000;
            const wasDownscaled = width > maxDim || height > maxDim;

            if (wasDownscaled) {
              const ratio = Math.min(maxDim / width, maxDim / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              // Smooth when downscaling so curves stay clean; nearest-neighbor makes stair-steps.
              ctx.imageSmoothingEnabled = wasDownscaled;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(img, 0, 0, width, height);
              // Preview-only PNG; tracing uses ImageData (no encode/decode roundtrip).
              const previewDataUrl = canvas.toDataURL('image/png');
              setIsTracing("Step 2/4: Preparing image for vectorizer...");
              setTimeout(() => {
                // Always cache raw pixels; VTracer print applies fringe/posterize at trace time.
                const imageData = ctx.getImageData(0, 0, width, height);
                if (tracerId === 'vtracer') {
                  try {
                    const { suggestedColorCount } = prepareCanvasForVtracer(canvas);
                    setColorCount(suggestedColorCount);
                    traceImage(
                      { data: imageData.data, width, height },
                      suggestedColorCount,
                      previewDataUrl,
                      tracerId,
                      { preset: vtracerPreset },
                    );
                  } catch {
                    traceImage(
                      { data: imageData.data, width, height },
                      colorCount,
                      previewDataUrl,
                      tracerId,
                      { preset: vtracerPreset },
                    );
                  }
                } else {
                  traceImage(
                    { data: imageData.data, width, height },
                    colorCount,
                    previewDataUrl,
                    tracerId,
                    { preset: vtracerPreset },
                  );
                }
              }, 0);
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

  const handleDeleteSelected = useCallback(() => {
    if (selectedMeshIds.length === 0 || !svgModelRef.current) return;
    pushToHistory();
    const currentShapes = svgModelRef.current.getShapes();
    const newShapes = currentShapes.filter(item => !selectedMeshIds.includes(item.id));
    svgModelRef.current.setShapes(newShapes);
    setSelectedMeshIds([]);
  }, [selectedMeshIds, pushToHistory]);

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (selectedMeshIds.length === 0) return;
    const newColorHex = e.target.value.replace('#', '').toLowerCase();
    setMeshColorOverrides(prev => {
      const next = { ...prev };
      selectedMeshIds.forEach(id => { next[id] = newColorHex; });
      return next;
    });
  };

  const handleCustomColorPointerDown = () => {
    if (selectedMeshIds.length === 0) return;
    pushToHistory();
  };

  const previewMeshIds = pendingShards
    ? Object.entries(pendingShards)
      .filter(([colorHex]) => !ignoredShardColors.includes(colorHex))
      .flatMap(([_, ids]) => ids)
    : [];

  const handleColorCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColors = Math.min(64, Math.max(2, parseInt(e.target.value, 10) || 2));
    setColorCount(newColors);

    if (colorChangeTimeout.current) {
      window.clearTimeout(colorChangeTimeout.current);
    }

    colorChangeTimeout.current = window.setTimeout(() => {
      const source = sourceRgbaRef.current;
      if (!source || tracerId !== 'vtracer') return;
      setIsTracing("Step 3/4: Re-vectorizing with new color count...");
      traceImage(source, newColors, imageDataUrl, tracerId, {
        preset: vtracerPreset,
        filterSpeckle: vtracerFilterSpeckle,
        colorPrecisionBits: vtracerColorPrecisionBits,
      });
    }, 400);
  };

  const handleVtracerFilterSpeckleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(20, Math.max(0, parseInt(e.target.value, 10) || 0));
    setVtracerFilterSpeckle(next);
    if (colorChangeTimeout.current) {
      window.clearTimeout(colorChangeTimeout.current);
    }
    colorChangeTimeout.current = window.setTimeout(() => {
      const source = sourceRgbaRef.current;
      if (!source || tracerId !== 'vtracer') return;
      setIsTracing("Step 3/4: Re-vectorizing with new print settings...");
      traceImage(source, colorCount, imageDataUrl, tracerId, {
        preset: vtracerPreset,
        filterSpeckle: next,
        colorPrecisionBits: vtracerColorPrecisionBits,
      });
    }, 400);
  };

  const handleVtracerColorPrecisionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(8, Math.max(0, parseInt(e.target.value, 10) || 0));
    setVtracerColorPrecisionBits(next);
    if (colorChangeTimeout.current) {
      window.clearTimeout(colorChangeTimeout.current);
    }
    colorChangeTimeout.current = window.setTimeout(() => {
      const source = sourceRgbaRef.current;
      if (!source || tracerId !== 'vtracer') return;
      setIsTracing("Step 3/4: Re-vectorizing with new print settings...");
      traceImage(source, colorCount, imageDataUrl, tracerId, {
        preset: vtracerPreset,
        filterSpeckle: vtracerFilterSpeckle,
        colorPrecisionBits: next,
      });
    }, 400);
  };

  const handleTracerChange = (next: string) => {
    if (!isTracerId(next) || next === tracerId) return;
    setTracerId(next);
    const source = sourceRgbaRef.current;
    if (!source || !imageDataUrl) return;
    const label = listTracerBackends().find((b) => b.id === next)?.label ?? next;
    setIsTracing(`Step 3/4: Re-vectorizing with ${label}...`);
    if (isWebsiteTracer(next)) {
      traceImage(source, colorCount, imageDataUrl, next, {
        preset: vtracerPreset,
        viColorPrecision,
        viFilterSpeckle,
        viPathPrecision,
        viMaxColors,
      });
    } else {
      traceImage(source, colorCount, imageDataUrl, next, {
        preset: vtracerPreset,
        filterSpeckle: vtracerFilterSpeckle,
        colorPrecisionBits: vtracerColorPrecisionBits,
      });
    }
  };

  const handleVtracerPresetChange = (next: VTracerPresetId) => {
    if (next === vtracerPreset) return;
    setVtracerPreset(next);
    const defaults = getWebsitePresetAdvancedDefaults(next);
    setViColorPrecision(defaults.colorPrecision);
    setViFilterSpeckle(defaults.filterSpeckle);
    setViPathPrecision(defaults.pathPrecision);
    setViMaxColors(defaults.maxColors);
    if (!isWebsiteTracer(tracerId)) return;
    const source = sourceRgbaRef.current;
    if (!source || !imageDataUrl) return;
    setIsTracing("Step 3/4: Re-vectorizing with new preset...");
    traceImage(source, colorCount, imageDataUrl, tracerId, {
      preset: next,
      viColorPrecision: defaults.colorPrecision,
      viFilterSpeckle: defaults.filterSpeckle,
      viPathPrecision: defaults.pathPrecision,
      viMaxColors: defaults.maxColors,
    });
  };

  const scheduleWebsiteRetrace = (overrides: {
    viColorPrecision?: number;
    viFilterSpeckle?: number;
    viPathPrecision?: number;
    viMaxColors?: number;
  }) => {
    if (colorChangeTimeout.current) {
      window.clearTimeout(colorChangeTimeout.current);
    }
    colorChangeTimeout.current = window.setTimeout(() => {
      const source = sourceRgbaRef.current;
      if (!source || !isWebsiteTracer(tracerId)) return;
      setIsTracing("Step 3/4: Re-vectorizing with advanced settings...");
      traceImage(source, colorCount, imageDataUrl, tracerId, {
        preset: vtracerPreset,
        viColorPrecision: overrides.viColorPrecision ?? viColorPrecision,
        viFilterSpeckle: overrides.viFilterSpeckle ?? viFilterSpeckle,
        viPathPrecision: overrides.viPathPrecision ?? viPathPrecision,
        viMaxColors: overrides.viMaxColors ?? viMaxColors,
      });
    }, 400);
  };

  const handleViColorPrecisionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(8, Math.max(1, parseInt(e.target.value, 10) || 1));
    setViColorPrecision(next);
    scheduleWebsiteRetrace({ viColorPrecision: next });
  };

  const handleViFilterSpeckleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(20, Math.max(0, parseInt(e.target.value, 10) || 0));
    setViFilterSpeckle(next);
    scheduleWebsiteRetrace({ viFilterSpeckle: next });
  };

  const handleViPathPrecisionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(8, Math.max(0, parseInt(e.target.value, 10) || 0));
    setViPathPrecision(next);
    scheduleWebsiteRetrace({ viPathPrecision: next });
  };

  const handleViMaxColorsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Math.min(64, Math.max(2, parseInt(e.target.value, 10) || 2));
    setViMaxColors(next);
    scheduleWebsiteRetrace({ viMaxColors: next });
  };

  const handlePromoteTo3D = () => {
    if (!rawSvgContent) return;
    // Seal seams for extrusion only — Step 1 preview stays on unsealed rawSvgContent.
    const sealedSvg = sealAndStraightenSvg(rawSvgContent);
    const extrudeUrl = URL.createObjectURL(new Blob([sealedSvg], { type: 'image/svg+xml' }));
    setSvgUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return extrudeUrl;
    });
    setSelectedMeshIds([]);
    setMeshDepths({});
    setVertexCount(0);
    clearHistory();
    setMeshColors([]);
    setMeshColorOverrides({});
    setIsMerging(false);
    setPipelinePhase('extrudeReady');
    setIsTracing('Step 4/4: Parsing 2D Geometry...');
  };

  const refreshPreviewFromRaw = (svg: string) => {
    setPreviewSvgUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(
        new Blob([normalizeSvgForPreview(svg)], { type: 'image/svg+xml' }),
      );
    });
  };

  const handleMergeSvgFills = (fromHexes: string[], toHex: string) => {
    if (!rawSvgContent || fromHexes.length === 0) return;
    pushToHistory();
    const next = mergeSvgFills(rawSvgContent, fromHexes, toHex);
    setRawSvgContent(next);
    refreshPreviewFromRaw(next);
  };

  const handleBackToSvgPreview = () => {
    if (!previewSvgUrl && !rawSvgContent) return;
    setSvgUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setSelectedMeshIds([]);
    setMeshDepths({});
    setVertexCount(0);
    setMeshColors([]);
    setMeshColorOverrides({});
    setIsMerging(false);
    setIsTracing(null);
    clearHistory();
    setPipelinePhase('svgPreview');
    if (!previewSvgUrl && rawSvgContent) {
      setPreviewSvgUrl(
        URL.createObjectURL(
          new Blob([normalizeSvgForPreview(rawSvgContent)], { type: 'image/svg+xml' }),
        ),
      );
    }
  };

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

  const currentDepth = selectedMeshIds.length > 0
    ? selectedMeshIds.reduce((sum, id) => sum + (meshDepths[id] ?? 0), 0) / selectedMeshIds.length
    : 0;

  const isDepthMixed = selectedMeshIds.length > 0
    && !areExtrusionHeightsUniform(selectedMeshIds, meshDepths);
    
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeElement = document.activeElement as HTMLElement;
        const isTextInput = 
          activeElement?.tagName === 'TEXTAREA' || 
          (activeElement?.tagName === 'INPUT' && !['radio', 'checkbox', 'color', 'range', 'button', 'file'].includes((activeElement as HTMLInputElement).type)) || 
          activeElement?.tagName === 'SELECT';
        
        if (!isTextInput && selectedMeshIds.length > 0) {
          handleDeleteSelected();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMeshIds, handleDeleteSelected]);

  // Handle border mode changes and custom adjacencies
  useEffect(() => {
    if (borderMode === 'custom' && selectedMeshIds.length > 0 && svgModelRef.current) {
      svgModelRef.current.getAdjacentColors(selectedMeshIds).then(colors => {
        setAdjacentColors(colors);
        if (colors.length > 0 && (!customBorderColor || !colors.includes(customBorderColor))) {
          setCustomBorderColor(colors[0]);
        } else if (colors.length === 0) {
          setCustomBorderColor(null);
        }
      });
    } else {
      setAdjacentColors([]);
    }
  }, [borderMode, selectedMeshIds]);

  return {
    svgUrl, setSvgUrl, previewSvgUrl, pipelinePhase, handlePromoteTo3D, handleBackToSvgPreview, handleMergeSvgFills,
    fitTrigger, setFitTrigger, rawSvgContent, setRawSvgContent, imageDataUrl, setImageDataUrl,
    colorCount, setColorCount, tracerId, setTracerId, handleTracerChange, tracerBackends: listTracerBackends(),
    vtracerPreset, handleVtracerPresetChange,
    vtracerFilterSpeckle, handleVtracerFilterSpeckleChange,
    vtracerColorPrecisionBits, handleVtracerColorPrecisionChange,
    viColorPrecision, handleViColorPrecisionChange,
    viFilterSpeckle, handleViFilterSpeckleChange,
    viPathPrecision, handleViPathPrecisionChange,
    viMaxColors, handleViMaxColorsChange,
    selectedMeshIds, setSelectedMeshIds, vertexCount, setVertexCount, isTracing, setIsTracing,
    highlightStyle, setHighlightStyle, sealGaps, setSealGaps, backingDepth, setBackingDepth, cutOverlaps, setCutOverlaps,
    selectSizeThreshold, setSelectSizeThreshold, shapeAreasCache, setShapeAreasCache, mergeBeforeExport, setMergeBeforeExport,
    printFaceDown, setPrintFaceDown, canPrintFaceDown,
    colorOnFaceOnly, setColorOnFaceOnly, faceColorDepthMm, setFaceColorDepthMm,
    faceBaseColorHex, setFaceBaseColorHex,
    meshColors, setMeshColors, meshColorOverrides, setMeshColorOverrides, meshDepths, setMeshDepths,
    mergeColors3MF, setMergeColors3MF, isMerging, setIsMerging, isFusingSelection, setIsFusingSelection,
    fuseStatus, setFuseStatus, isExtracting, setIsExtracting, extractStatus, setExtractStatus,
    isBasePlating, setIsBasePlating, basePlateStatus, setBasePlateStatus, showExportOptions, setShowExportOptions,
    thinWallParts, handleSelectThinParts,
    printerProfile, setPrinterProfile, gridSize, setGridSize, exportStatus, setExportStatus,
    customScale, setCustomScale, scaleZProportionally, setScaleZProportionally, clearance, setClearance,
    sceneRef, svgModelRef, pushToHistory, handleUndo, handleRedo, canUndo, canRedo, clearHistory,
    currentMeshColors, uniqueColors, selectedUniqueColors, toggleColorSelection, removeColorFromSelection,
    getColorDistance, handleAutoSelectSimilar, handleAutoExtrude, handleConvertToLineArt,
    initiateFuse, executeFuse, executeMergeColors, handleExport3MF, handleExportSTLAction,
    generateSVGFromCurrentShapes, handleSaveProject, handleLoadProject,
    pendingShards, setPendingShards, ignoredShardColors, setIgnoredShardColors,
    isAbsorbingShards, setIsAbsorbingShards, isSplitting, setIsSplitting, splitStatus, setSplitStatus,
    isExpanding, setIsExpanding, expandAmount, setExpandAmount, expandStatus, setExpandStatus,
    isSmoothing, setIsSmoothing, smoothAmount, setSmoothAmount, smoothStatus, setSmoothStatus,
    isBordering, setIsBordering, borderWidth, setBorderWidth, lineArtWidth, setLineArtWidth, borderMode, setBorderMode,
    customBorderColor, setCustomBorderColor, adjacentColors,
    borderStatus, setBorderStatus, handlePreviewShards, confirmAbsorbShards,
    handleSplitDisjoint, handleExtractInner, handleCreateBasePlate, inheritProperties,
    handleExpandSelected, handleSmoothSelected, handleCreateBorder, traceImage,
    handleFileUpload, handleDepthChange, handleDepthPointerDown, handleDeleteSelected,
    handleCustomColorChange, handleCustomColorPointerDown, previewMeshIds, handleColorCountChange, handleSelectBySizeChange,
    currentDepth, isDepthMixed, shardSizeSlider, colorChangeTimeout
  };
}
