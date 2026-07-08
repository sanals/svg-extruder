import { useState, useRef, Suspense, useEffect, useCallback } from 'react';
import { Upload, Download, Undo } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import ImageTracer from 'imagetracerjs';
import { SvgModel, type SvgModelRef } from './components/SvgModel';
import './index.css';

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
      const absorbedIds = await svgModelRef.current.absorbShards(selectedMeshIds, shardSizeSlider, () => {});
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

  return (
    <>
      <div className="sidebar" style={{ padding: '1rem', gap: '1rem', width: '320px' }}>
        <h1 className="sidebar-header" style={{ marginBottom: '0.5rem' }}>SVG Extruder 3D</h1>

        {/* GROUP 1: INPUT & SETUP */}
        <div className="card">
          <div className="card-header">Input & Setup</div>
          <div className="card-body">
            
            {/* SAVE AND LOAD */}
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
                   const link = document.createElement('a');
                   link.href = svgUrl;
                   link.download = 'vectorized.svg';
                   link.click();
                 }}
                 style={{
                   width: '100%', padding: '0.4rem', backgroundColor: '#334155', color: 'white', border: '1px solid rgba(255,255,255,0.1)',
                   borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center',
                   justifyContent: 'center', gap: '0.4rem', transition: 'background-color 0.2s'
                 }}
                 onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#475569'}
                 onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#334155'}
              >
                <Download size={14} /> Download 2D SVG
              </button>
            )}

            {imageDataUrl && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                  <label htmlFor="color-count">Image Colors To Extract</label>
                  <span>{colorCount}</span>
                </div>
                <input id="color-count" type="range" min="2" max="256" step="1" value={colorCount} onChange={handleColorCountChange} style={{ width: '100%' }} />
              </div>
            )}

            {vertexCount > 0 && (
              <div style={{ padding: '0.75rem', borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Model Complexity</div>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: '#e2e8f0', marginTop: '0.25rem' }}>{vertexCount.toLocaleString()} Vertices</div>
                {vertexCount > 100000 && (
                  <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '0.25rem' }}>High vertex count may cause performance issues.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* GROUP 2: GEOMETRY SETTINGS */}
        <div className="card">
          <div className="card-header">Geometry Settings</div>
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
          </div>
        </div>

        {/* GROUP 3: SELECTION & EDITING */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Selection & Editing
            <button
              onClick={handleUndo}
              disabled={history.length === 0}
              style={{
                padding: '0.2rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem',
                backgroundColor: history.length > 0 ? '#3b82f6' : 'transparent',
                color: history.length > 0 ? 'white' : '#64748b',
                border: history.length > 0 ? 'none' : '1px solid rgba(255,255,255,0.1)',
                borderRadius: '4px', cursor: history.length > 0 ? 'pointer' : 'not-allowed'
              }}
              title="Undo last change (Ctrl+Z)"
            >
              <Undo size={10} /> Undo
            </button>
          </div>
          <div className="card-body" style={{ gap: '1.25rem' }}>
            
            {/* SECTION 1: SELECTION TOOLS */}
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.5rem' }}>1. Selection Tools</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.25rem' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.2rem' }}>Highlight Style:</span>
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

              <div style={{ marginTop: '0.5rem', padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px', color: '#cbd5e1' }}>
                  <span>Select by Size (Max Area)</span>
                  <span>{selectSizeThreshold}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="10000" 
                  step="10" 
                  value={selectSizeThreshold} 
                  onChange={(e) => handleSelectBySizeChange(parseFloat(e.target.value))} 
                  style={{ width: '100%' }} 
                />
              </div>
              
              {uniqueColors.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <label style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>
                    Select By Image Colors
                  </label>
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
                </div>
              )}
              
              {selectedUniqueColors.length === 1 && !isMerging && (
                <button onClick={handleAutoSelectSimilar} style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#10b981', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }}>
                  Auto-Select Similar Colors
                </button>
              )}

              {selectedMeshIds.length > 1 && !isMerging && !isFusingSelection && (
                <button onClick={initiateFuse} style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#f97316', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }} title="Mathematically fuse touching parts into a single seamless polygon">
                  Fuse Touching Parts
                </button>
              )}

              <button
                style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.5)', color: '#fca5a5', borderRadius: '4px', cursor: 'pointer', transition: 'all 0.2s' }}
                onClick={handleDeleteSelected}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#ef4444'; e.currentTarget.style.color = 'white'; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)'; e.currentTarget.style.color = '#fca5a5'; }}
              >
                Delete Selected Parts
              </button>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '0.5rem 0' }} />

            {/* SECTION 2: BASIC PROPERTIES */}
            <div style={{ opacity: selectedMeshIds.length > 0 ? 1 : 0.5, pointerEvents: selectedMeshIds.length > 0 ? 'auto' : 'none' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.5rem' }}>2. Basic Properties</div>
              
              <div style={{ marginBottom: '1.25rem', padding: '1rem', backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label htmlFor="depth-slider" style={{ fontSize: '0.9rem', fontWeight: 600, color: '#60a5fa', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Extrusion Depth</label>
                  <span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc' }}>{currentDepth.toFixed(1)}</span>
                </div>
                <input id="depth-slider" type="range" min="0" max="20" step="0.1" value={currentDepth} onChange={handleDepthChange} onPointerDown={handleDepthPointerDown} disabled={selectedMeshIds.length === 0} style={{ width: '100%' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Custom Color Override:</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input 
                    type="color" 
                    value={`#${selectedUniqueColors.length === 1 ? selectedUniqueColors[0] : 'ffffff'}`} 
                    onBlur={handleCustomColorChange}
                    onChange={() => {}} // React controlled input needs an onChange, but we'll apply it onBlur to avoid lag
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

            </div>

            <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '0.5rem 0' }} />

            {/* SECTION 3: SHAPE GENERATION */}
            <div style={{ opacity: selectedMeshIds.length > 0 ? 1 : 0.5, pointerEvents: selectedMeshIds.length > 0 ? 'auto' : 'none' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.5rem' }}>3. Shape Generation</div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {/* EXTRACT INNER PARTS */}
                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                  <button
                    style={{ width: '100%', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#06b6d4', border: 'none', color: 'white', borderRadius: '4px', cursor: isExtracting ? 'not-allowed' : 'pointer' }}
                    onClick={handleExtractInner}
                    disabled={isExtracting}
                    title="If this shape has enclosed holes inside it, this will extract them into solid pieces"
                  >
                    {isExtracting ? extractStatus || "Working..." : "Fill Enclosed Holes"}
                  </button>
                </div>

                {/* CREATE UNIFORM BORDER */}
                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '4px', color: '#cbd5e1' }}>
                    <span>Create Outline Border</span>
                    <span>{borderWidth.toFixed(1)}px</span>
                  </div>
                  <input type="range" min="0.1" max="5" step="0.1" value={borderWidth} onChange={(e) => setBorderWidth(parseFloat(e.target.value))} style={{ width: '100%' }} />
                  <button
                    style={{ width: '100%', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#eab308', marginTop: '6px', border: 'none', color: 'white', borderRadius: '4px', cursor: isBordering ? 'not-allowed' : 'pointer' }}
                    onClick={handleCreateBorder}
                    disabled={isBordering}
                  >
                    {isBordering ? borderStatus || "Working..." : "Generate Border"}
                  </button>
                </div>
              </div>
            </div>

            {/* SECTION 4: ADVANCED TOOLS */}
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', cursor: 'pointer', padding: '0.5rem 0', userSelect: 'none' }}>
                4. Advanced Tools
              </summary>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', opacity: selectedMeshIds.length > 0 ? 1 : 0.5, pointerEvents: selectedMeshIds.length > 0 ? 'auto' : 'none' }}>
                
                {/* CREATE BASE PLATE */}
                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                  <button
                    style={{ width: '100%', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#8b5cf6', border: 'none', color: 'white', borderRadius: '4px', cursor: isBasePlating ? 'not-allowed' : 'pointer' }}
                    onClick={handleCreateBasePlate}
                    disabled={isBasePlating}
                    title="Generate a perfectly fitted solid puzzle-piece base that sits beneath these strokes"
                  >
                    {isBasePlating ? basePlateStatus || "Working..." : "Fill Body (Base Plate)"}
                  </button>
                </div>

                {selectedUniqueColors.length > 1 && !isMerging && (
                  <button onClick={() => setIsMerging(true)} style={{ fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#8b5cf6' }}>
                    Merge Selected Colors
                  </button>
                )}
                
                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                  <button
                    style={{ width: '100%', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#8b5cf6', border: 'none', color: 'white', borderRadius: '4px', cursor: isSplitting ? 'not-allowed' : 'pointer' }}
                    onClick={handleSplitDisjoint}
                    disabled={isSplitting}
                  >
                    {isSplitting ? splitStatus || "Working..." : "Separate Disjoint Parts"}
                  </button>
                </div>

                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                  <button
                    style={{ width: '100%', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#4f46e5', border: 'none', color: 'white', borderRadius: '4px', cursor: isAbsorbingShards ? 'not-allowed' : 'pointer' }}
                    onClick={handlePreviewShards}
                    disabled={isAbsorbingShards}
                  >
                    {isAbsorbingShards ? "Scanning..." : "Clean Edge Shards"}
                  </button>
                  {pendingShards && (
                    <div style={{ marginTop: '0.5rem' }}>
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

                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '4px', color: '#cbd5e1' }}>
                    <span>Expand (Fill Gaps)</span>
                    <span>{expandAmount.toFixed(1)}px</span>
                  </div>
                  <input type="range" min="0.1" max="5" step="0.1" value={expandAmount} onChange={(e) => setExpandAmount(parseFloat(e.target.value))} style={{ width: '100%' }} />
                  <button
                    style={{ width: '100%', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#6366f1', marginTop: '6px', border: 'none', color: 'white', borderRadius: '4px', cursor: isExpanding ? 'not-allowed' : 'pointer' }}
                    onClick={handleExpandSelected}
                    disabled={isExpanding}
                  >
                    {isExpanding ? expandStatus || "Working..." : "Expand Selected"}
                  </button>
                </div>

                <div style={{ padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '4px', color: '#cbd5e1' }}>
                    <span>Smooth Selected</span>
                    <span>{smoothAmount.toFixed(1)}</span>
                  </div>
                  <input type="range" min="0.1" max="5" step="0.1" value={smoothAmount} onChange={(e) => setSmoothAmount(parseFloat(e.target.value))} style={{ width: '100%' }} />
                  <button
                    style={{ width: '100%', fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#ec4899', marginTop: '6px', border: 'none', color: 'white', borderRadius: '4px', cursor: isSmoothing ? 'not-allowed' : 'pointer' }}
                    onClick={handleSmoothSelected}
                    disabled={isSmoothing}
                  >
                    {isSmoothing ? smoothStatus || "Working..." : "Smooth Selected"}
                  </button>
                </div>

              </div>

              {isMerging && (
                <div style={{ marginTop: '0.75rem', backgroundColor: 'rgba(51,65,85,0.5)', padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.75rem', marginBottom: '0.75rem', color: '#cbd5e1' }}>Select target color to merge into:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                    {selectedUniqueColors.map(colorHex => (
                      <div key={`target-${colorHex}`} style={{ position: 'relative' }}>
                        <div
                          onClick={() => executeFuse(colorHex)}
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
            </details>
          </div>
        </div>

        {/* GROUP 4: EXPORT OPTIONS */}
        <div className="card" style={{ marginTop: 'auto' }}>
          <div className="card-header">Export & Print Options</div>
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
                  <input type="range" min="10" max="500" step="10" value={customScale} onChange={(e) => setCustomScale(Number(e.target.value))} style={{ flex: 1 }} />
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
                    <input type="range" min="0" max="0.5" step="0.05" value={clearance} onChange={(e) => setClearance(Number(e.target.value))} style={{ flex: 1 }} />
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

      <div className="main-content" style={{ position: 'relative' }}>
        {/* Loading Overlay */}
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
                          // Unselect if clicking the exact same selection again
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
    </>
  );
}

export default App;
