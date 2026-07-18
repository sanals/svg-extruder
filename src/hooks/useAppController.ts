import { useState, useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import ImageTracer from 'imagetracerjs';
import { type SvgModelRef } from '../components/SvgModel';
import { useHistory } from './useHistory';
import { exportToSTL } from '../lib/export-utils';
import { computeAutoExtrudeDepths, calculateLineArtParams, generateSVGFromShapes } from '../lib/app-logic';

export function useAppController() {
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [rawSvgContent, setRawSvgContent] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [colorCount, setColorCount] = useState<number>(8);
  const [selectedMeshIds, setSelectedMeshIds] = useState<string[]>([]);

  const [vertexCount, setVertexCount] = useState<number>(0);
  const [isTracing, setIsTracing] = useState<string | null>(null);
  const [highlightStyle, setHighlightStyle] = useState<'dashed' | 'solid'>('dashed');
  const [sealGaps, setSealGaps] = useState<boolean>(true);
  const [backingDepth, setBackingDepth] = useState<number>(2);
  const [cutOverlaps, setCutOverlaps] = useState<boolean>(true);
  const [selectSizeThreshold, setSelectSizeThreshold] = useState<number>(0);
  const [shapeAreasCache, setShapeAreasCache] = useState<{ id: string, area: number }[] | null>(null);
  const [mergeBeforeExport, setMergeBeforeExport] = useState<boolean>(false);

  const [meshColors, setMeshColors] = useState<{ id: string, colorHex: string }[]>([]);
  const [meshColorOverrides, setMeshColorOverrides] = useState<Record<string, string>>({});
  const [meshDepths, setMeshDepths] = useState<Record<string, number>>({});

  const sceneRef = useRef<THREE.Group>(null);
  const svgModelRef = useRef<SvgModelRef>(null);

  const getCurrentState = useCallback(() => ({
    meshDepths: { ...meshDepths },
    meshColorOverrides: { ...meshColorOverrides },
    meshColors: [...meshColors],
    shapes: svgModelRef.current?.getShapes(),
    selectedMeshIds: [...selectedMeshIds]
  }), [meshDepths, meshColorOverrides, meshColors, selectedMeshIds]);

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

  const [printerProfile, setPrinterProfile] = useState<'A1 Mini (180x180)' | 'X1/P1/A1 (256x256)'>('X1/P1/A1 (256x256)');
  const [gridSize, setGridSize] = useState<string>("auto");
  const buildPlateSize = printerProfile === 'A1 Mini (180x180)' ? 180 : 256;
  const printerModel = printerProfile === 'A1 Mini (180x180)' ? 'a1_mini' : 'x1c';
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [customScale, setCustomScale] = useState<number>(100);
  const [scaleZProportionally, setScaleZProportionally] = useState<boolean>(false);
  const [clearance, setClearance] = useState<number>(0.0);

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

    const { newDepths, newColors, lightShapeIds, darkShapeIds, targetWidth } = calculateLineArtParams(allShapes, meshColorOverrides, borderWidth);

    setIsBordering(true);
    setBorderStatus("Generating uniform line art...");

    try {
      const newIds = await svgModelRef.current.generateUniformLineArt(targetWidth, lightShapeIds, darkShapeIds, (msg: string) => setBorderStatus(msg));
      if (newIds && newIds.length > 0) {
        newIds.forEach(id => {
          newDepths[id] = 3;
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

    const newIds = await svgModelRef.current.fuseSelected(selectedMeshIds, targetColorHex, false, (msg: string) => {
      setFuseStatus(msg);
    });

    if (newIds && newIds.length > 0) {
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

  const handleExportSTLAction = () => {
    if (!sceneRef.current) return;
    try {
      exportToSTL(sceneRef.current, customScale, scaleZProportionally, mergeBeforeExport);
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
      rawSvgContent, colorCount, meshDepths, meshColorOverrides, selectedMeshIds,
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
          setColorCount(projectData.colorCount || 8); setMeshDepths(projectData.meshDepths || {});
          setMeshColorOverrides(projectData.meshColorOverrides || {}); setSelectedMeshIds(projectData.selectedMeshIds || []);
          setHighlightStyle(projectData.highlightStyle || 'dashed'); setSealGaps(projectData.sealGaps ?? true);
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
  const [borderOuterOnly, setBorderOuterOnly] = useState(true);
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
      const newIds = await svgModelRef.current.createUniformBorder(selectedMeshIds, borderWidth, borderOuterOnly, (msg: string) => setBorderStatus(msg));
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
          clearHistory();
          setMeshColors([]);
          setMeshColorOverrides({});
          setIsMerging(false);
          setImageDataUrl(dataUrl);
        },
        {
          numberofcolors: colors,
          colorquantcycles: 15,
          mincolorratio: 0.005,
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
        setIsTracing("Loading SVG Geometry...");
        const reader = new FileReader();
        reader.onload = (evt) => {
          const svgText = evt.target?.result as string;
          const blob = new Blob([svgText], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          setTimeout(() => {
            setRawSvgContent(svgText);
            setSvgUrl(url);
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
        setIsTracing("Step 1/3: Loading Image...");
        setSvgUrl(null);

        const img = new Image();
        img.onload = () => {
          setIsTracing("Step 1/3: Optimizing Image Resolution...");
          setTimeout(() => {
            let width = img.width;
            let height = img.height;
            const maxDim = 400;

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

  return {
    svgUrl, setSvgUrl, fitTrigger, setFitTrigger, rawSvgContent, setRawSvgContent, imageDataUrl, setImageDataUrl,
    colorCount, setColorCount, selectedMeshIds, setSelectedMeshIds, vertexCount, setVertexCount, isTracing, setIsTracing,
    highlightStyle, setHighlightStyle, sealGaps, setSealGaps, backingDepth, setBackingDepth, cutOverlaps, setCutOverlaps,
    selectSizeThreshold, setSelectSizeThreshold, shapeAreasCache, setShapeAreasCache, mergeBeforeExport, setMergeBeforeExport,
    meshColors, setMeshColors, meshColorOverrides, setMeshColorOverrides, meshDepths, setMeshDepths,
    mergeColors3MF, setMergeColors3MF, isMerging, setIsMerging, isFusingSelection, setIsFusingSelection,
    fuseStatus, setFuseStatus, isExtracting, setIsExtracting, extractStatus, setExtractStatus,
    isBasePlating, setIsBasePlating, basePlateStatus, setBasePlateStatus, showExportOptions, setShowExportOptions,
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
    isBordering, setIsBordering, borderWidth, setBorderWidth, borderOuterOnly, setBorderOuterOnly,
    borderStatus, setBorderStatus, handlePreviewShards, confirmAbsorbShards,
    handleSplitDisjoint, handleExtractInner, handleCreateBasePlate, inheritProperties,
    handleExpandSelected, handleSmoothSelected, handleCreateBorder, traceImage,
    handleFileUpload, handleDepthChange, handleDepthPointerDown, handleDeleteSelected,
    handleCustomColorChange, previewMeshIds, handleColorCountChange, handleSelectBySizeChange,
    currentDepth, shardSizeSlider, colorChangeTimeout
  };
}
