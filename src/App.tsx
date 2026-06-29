import { useState, useRef, Suspense, useEffect } from 'react';
import { Upload, Download, Undo } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import ImageTracer from 'imagetracerjs';
import { SvgModel, type SvgModelRef } from './components/SvgModel';
import './index.css';

function App() {
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [colorCount, setColorCount] = useState<number>(8);
  const [selectedMeshIds, setSelectedMeshIds] = useState<string[]>([]);
  const [meshDepths, setMeshDepths] = useState<Record<string, number>>({});
  const [vertexCount, setVertexCount] = useState<number>(0);
  const [isTracing, setIsTracing] = useState<string | null>(null);
  const [selectByColor, setSelectByColor] = useState<boolean>(false);
  const [highlightStyle, setHighlightStyle] = useState<'dashed' | 'solid'>('dashed');
  const [sealGaps, setSealGaps] = useState<boolean>(true);
  const [cutOverlaps, setCutOverlaps] = useState<boolean>(true);
  const [mergeBeforeExport, setMergeBeforeExport] = useState<boolean>(false);
  const [history, setHistory] = useState<any[]>([]);
  const [meshColors, setMeshColors] = useState<{ id: string, colorHex: string }[]>([]);
  const [meshColorOverrides, setMeshColorOverrides] = useState<Record<string, string>>({});
  const [mergeColors3MF, setMergeColors3MF] = useState<boolean>(true);
  const [isMerging, setIsMerging] = useState(false);
  const [fuseStatus, setFuseStatus] = useState<string | null>(null);

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

  const handleMergeColors = (targetColorHex: string) => {
    pushToHistory();
    let idsToUpdate = selectedMeshIds;

    setMeshColorOverrides(prev => {
      const next = { ...prev };
      idsToUpdate.forEach(id => {
        next[id] = targetColorHex;
      });
      return next;
    });

    setIsMerging(false);
    setSelectedMeshIds([]);
  };

  const handleFuseParts = async () => {
    if (!svgModelRef.current) return;

    pushToHistory();
    setFuseStatus("Initializing fusion...");
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    const newId = await svgModelRef.current.fuseSelected(selectedMeshIds, (msg) => {
      setFuseStatus(msg);
    });

    if (newId) {
      // Apply the color override of the first selected part to the new fused part
      setMeshColorOverrides(prev => {
        const next = { ...prev };
        next[newId] = currentMeshColors.find(m => m.id === selectedMeshIds[0])?.colorHex || "000000";
        return next;
      });
      setSelectedMeshIds([newId]);
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

  const traceImage = (dataUrl: string, colors: number) => {
    setIsTracing("Step 2/3: Vectorizing Pixels to SVG...");
    setTimeout(() => {
      ImageTracer.imageToSVG(
        dataUrl,
        (svgStr: string) => {
          const blob = new Blob([svgStr], { type: 'image/svg+xml' });
          const svgBlobUrl = URL.createObjectURL(blob);

          setIsTracing("Step 3/3: Parsing 2D Geometry...");
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
      } else if (file.type === 'image/png' || file.type === 'image/jpeg') {
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
    pushToHistory();
    const depth = parseFloat(e.target.value);
    setMeshDepths(prev => {
      const newDepths = { ...prev };
      selectedMeshIds.forEach(id => {
        newDepths[id] = depth;
      });
      return newDepths;
    });
  };

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

  const handleUndo = () => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const snapshot = prev[prev.length - 1];
      
      setMeshDepths(snapshot.meshDepths);
      setMeshColorOverrides(snapshot.meshColorOverrides);
      setMeshColors(snapshot.meshColors);
      if (svgModelRef.current && snapshot.shapes) {
        svgModelRef.current.setShapes(snapshot.shapes);
      }
      
      return prev.slice(0, -1);
    });
  };

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

    const exporter = new GLTFExporter();
    exporter.parse(
      finalExportObject,
      (gltf) => {
        const output = JSON.stringify(gltf, null, 2);
        const blob = new Blob([output], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.style.display = 'none';
        link.href = url;
        link.download = 'extruded_model.gltf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      },
      (error) => {
        console.error('An error happened during parsing', error);
      }
    );
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
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <label htmlFor="image-upload" style={{ flex: 1, cursor: 'pointer' }}>
                <div role="button" className="btn-upload" style={{
                  backgroundColor: '#3b82f6', color: 'white', padding: '0.6em 0', borderRadius: '8px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 500, fontSize: '0.85rem',
                  transition: 'background-color 0.2s'
                }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2563eb'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}>
                  <Upload size={16} /> Image
                </div>
                <input id="image-upload" type="file" accept=".png, .jpg, .jpeg" onChange={handleFileUpload} style={{ display: 'none' }} />
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
                <input id="color-count" type="range" min="2" max="32" step="1" value={colorCount} onChange={handleColorCountChange} />
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
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label className="checkbox-label" htmlFor="select-by-color">
                <input id="select-by-color" type="checkbox" checked={selectByColor} onChange={(e) => setSelectByColor(e.target.checked)} />
                Select identical colors
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', paddingLeft: '1.75rem', marginTop: '0.25rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.2rem' }}>Highlight Style:</span>
                <div className="segmented-control">
                  <label>
                    <input type="radio" name="highlightStyle" checked={highlightStyle === 'dashed'} onChange={() => setHighlightStyle('dashed')} /> 
                    <span>Dashed Outline</span>
                  </label>
                  <label>
                    <input type="radio" name="highlightStyle" checked={highlightStyle === 'solid'} onChange={() => setHighlightStyle('solid')} /> 
                    <span>Striped Overlay</span>
                  </label>
                </div>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label htmlFor="depth-slider" style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>Extrusion Depth</label>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{currentDepth.toFixed(1)}</span>
              </div>
              <input id="depth-slider" type="range" min="0" max="20" step="0.1" value={currentDepth} onChange={handleDepthChange} disabled={selectedMeshIds.length === 0} />
            </div>

            {uniqueColors.length > 0 && (
              <div>
                <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>
                  Colors Used <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 'normal', float: 'right' }}>(Drag to expand)</span>
                </label>
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                  {selectedUniqueColors.length === 1 && !isMerging && (
                    <button onClick={handleAutoSelectSimilar} style={{ fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#10b981' }}>
                      Auto-Select Similar Colors
                    </button>
                  )}

                  {selectedUniqueColors.length > 1 && !isMerging && (
                    <button onClick={() => setIsMerging(true)} style={{ fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#8b5cf6' }}>
                      Merge Selected Colors
                    </button>
                  )}

                  {selectedMeshIds.length > 1 && !isMerging && (
                    <button onClick={handleFuseParts} style={{ fontSize: '0.75rem', padding: '0.5rem', backgroundColor: '#f97316' }} title="Mathematically fuse touching parts into a single seamless polygon">
                      Fuse Touching Parts
                    </button>
                  )}
                </div>

                {isMerging && (
                  <div style={{ marginTop: '0.75rem', backgroundColor: 'rgba(51,65,85,0.5)', padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: '0.75rem', marginBottom: '0.75rem', color: '#cbd5e1' }}>Select target color to merge into:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                      {selectedUniqueColors.map(colorHex => (
                        <div key={`target-${colorHex}`} style={{ position: 'relative' }}>
                          <div
                            onClick={() => handleMergeColors(colorHex)}
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
              </div>
            )}
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
                Join objects for GLTF (Single Mesh)
              </label>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button disabled={!svgUrl || !!exportStatus} style={{ width: '100%', backgroundColor: '#ec4899' }} onClick={handleExport3MF}>
                <Download size={16} /> Export 3MF (Multi-Plate)
              </button>
              <button disabled={!svgUrl} style={{ width: '100%', backgroundColor: '#475569', fontSize: '0.8rem', padding: '0.5rem' }} onClick={handleExport}>
                <Download size={14} /> Export GLTF (Raw)
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
                    selectByColor={selectByColor}
                    highlightStyle={highlightStyle}
                    sealGaps={sealGaps}
                    cutOverlaps={cutOverlaps}
                    selectedMeshIds={selectedMeshIds}
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
