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
  const [selectedMeshIds, setSelectedMeshIds] = useState<string[]>([]);
  const [meshDepths, setMeshDepths] = useState<Record<string, number>>({});
  const [vertexCount, setVertexCount] = useState<number>(0);
  const [isTracing, setIsTracing] = useState<string | null>(null);
  const [selectByColor, setSelectByColor] = useState<boolean>(false);
  const [sealGaps, setSealGaps] = useState<boolean>(true);
  const [cutOverlaps, setCutOverlaps] = useState<boolean>(true);
  const [mergeBeforeExport, setMergeBeforeExport] = useState<boolean>(false);
  const [history, setHistory] = useState<Record<string, number>[]>([]);
  const [meshColors, setMeshColors] = useState<{ id: string, colorHex: string }[]>([]);
  const [meshColorOverrides, setMeshColorOverrides] = useState<Record<string, string>>({});
  const [mergeColors3MF, setMergeColors3MF] = useState<boolean>(true);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeMatching, setMergeMatching] = useState(true);
  const [fuseStatus, setFuseStatus] = useState<string | null>(null);

  const [printerProfile, setPrinterProfile] = useState<'A1 Mini (180x180)' | 'X1/P1/A1 (256x256)'>('X1/P1/A1 (256x256)');
  const [gridSize, setGridSize] = useState<string>("auto");
  const buildPlateSize = printerProfile === 'A1 Mini (180x180)' ? 180 : 256;
  const printerModel = printerProfile === 'A1 Mini (180x180)' ? 'a1_mini' : 'x1c';
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [customScale, setCustomScale] = useState<number>(100);
  const [clearance, setClearance] = useState<number>(0.0);

  const sceneRef = useRef<THREE.Group>(null);
  const svgModelRef = useRef<SvgModelRef>(null);

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

  const handleMergeColors = (targetColorHex: string) => {
    let idsToUpdate = selectedMeshIds;

    if (mergeMatching) {
      // Find all unique colors represented in the current selection
      const colorsToMerge = Array.from(new Set(
        selectedMeshIds.map(id => currentMeshColors.find(m => m.id === id)?.colorHex).filter(Boolean) as string[]
      ));

      // Find ALL meshes in the entire model that share those colors
      idsToUpdate = currentMeshColors
        .filter(m => colorsToMerge.includes(m.colorHex))
        .map(m => m.id);
    }

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
      const blob = await svgModelRef.current.sliceAndExport(
        buildPlateSize,
        gridSize,
        printerModel,
        mergeColors3MF,
        customScale / 100.0,
        mergeColors3MF ? 0 : clearance,
        (msg) => setExportStatus(msg)
      );

      if (blob) {
        const url = URL.createObjectURL(blob);
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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type === 'image/svg+xml') {
        const url = URL.createObjectURL(file);
        setIsTracing("Loading SVG Geometry...");

        // Yield to allow React to paint the loading screen before blocking the thread
        setTimeout(() => {
          setSvgUrl(url);
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
                  },
                  {
                    numberofcolors: 8, // Reduced from 16 to keep geometry simpler
                    strokewidth: 0,
                    viewbox: true,
                    blurradius: 2, // Blur to remove noise which creates thousands of tiny polygons
                    blurdelta: 20
                  }
                );
              }, 50);
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

  const handleUndo = () => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const previousState = newHistory.pop()!;
      setMeshDepths(previousState);
      return newHistory;
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
      <div className="sidebar">
        <h1 className="sidebar-header">SVG Extruder 3D</h1>

        <div className="control-group" style={{ display: 'flex', gap: '0.5rem' }}>
          <label htmlFor="image-upload" style={{ flex: 1, cursor: 'pointer' }}>
            <div role="button" className="btn-upload" style={{
              backgroundColor: '#3b82f6',
              color: 'white',
              padding: '0.6em 0',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              fontWeight: 500,
              fontSize: '0.85rem'
            }}>
              <Upload size={16} />
              Image
            </div>
            <input
              id="image-upload"
              type="file"
              accept=".png, .jpg, .jpeg"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>

          <label htmlFor="svg-upload" style={{ flex: 1, cursor: 'pointer' }}>
            <div role="button" className="btn-upload" style={{
              backgroundColor: '#10b981',
              color: 'white',
              padding: '0.6em 0',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              fontWeight: 500,
              fontSize: '0.85rem'
            }}>
              <Upload size={16} />
              SVG
            </div>
            <input
              id="svg-upload"
              type="file"
              accept=".svg"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>

        {vertexCount > 0 && (
          <div className="control-group" style={{
            backgroundColor: '#1e293b',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid #334155'
          }}>
            <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Model Complexity</label>
            <div style={{ fontSize: '1.25rem', fontWeight: 600, color: '#e2e8f0', marginTop: '0.25rem' }}>
              {vertexCount.toLocaleString()} Vertices
            </div>
            {vertexCount > 100000 && (
              <div style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.5rem' }}>
                High vertex count may cause performance issues.
              </div>
            )}
          </div>
        )}

        <div className="control-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <label htmlFor="depth-slider" style={{ margin: 0 }}>
              Extrusion Depth: {currentDepth.toFixed(1)}
            </label>
            <button
              onClick={handleUndo}
              disabled={history.length === 0}
              style={{
                padding: '0.2rem 0.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.75rem',
                backgroundColor: history.length > 0 ? '#3b82f6' : '#334155',
                color: history.length > 0 ? 'white' : '#94a3b8',
                border: 'none',
                borderRadius: '4px',
                cursor: history.length > 0 ? 'pointer' : 'not-allowed'
              }}
              title="Undo depth change (Ctrl+Z)"
            >
              <Undo size={12} />
              Undo
            </button>
          </div>
          <input
            id="depth-slider"
            type="range"
            min="0"
            max="20"
            step="0.1"
            value={currentDepth}
            onPointerDown={() => {
              setHistory(prev => [...prev, meshDepths]);
            }}
            onChange={handleDepthChange}
            disabled={selectedMeshIds.length === 0}
          />
        </div>

        <div className="control-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            id="select-by-color"
            type="checkbox"
            checked={selectByColor}
            onChange={(e) => setSelectByColor(e.target.checked)}
          />
          <label htmlFor="select-by-color" style={{ cursor: 'pointer' }}>
            Select matching colors
          </label>
        </div>

        <div className="control-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '-0.5rem' }}>
          <input
            id="seal-gaps"
            type="checkbox"
            checked={sealGaps}
            onChange={(e) => setSealGaps(e.target.checked)}
          />
          <label htmlFor="seal-gaps" style={{ cursor: 'pointer' }}>
            Seal gaps (adds slight bevel)
          </label>
        </div>

        <div className="control-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '-0.5rem' }}>
          <input
            id="cut-overlaps"
            type="checkbox"
            checked={cutOverlaps}
            onChange={(e) => setCutOverlaps(e.target.checked)}
          />
          <label htmlFor="cut-overlaps" style={{ cursor: 'pointer' }}>
            Cut overlaps (puzzle pieces)
          </label>
        </div>

        {uniqueColors.length > 0 && (
          <div className="control-group" style={{ marginTop: '0.5rem' }}>
            <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '0.5rem' }}>
              Colors Used <span style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 'normal', float: 'right' }}>(Drag corner to expand)</span>
            </label>
            <div className="colors-scroll-container" style={{
              display: 'flex', flexWrap: 'wrap', gap: '0.5rem',
              height: '160px', minHeight: '80px', maxHeight: '60vh', overflowY: 'auto', alignContent: 'flex-start',
              paddingRight: '4px', resize: 'vertical', border: '1px solid #1e293b'
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
                      width: '24px',
                      height: '24px',
                      backgroundColor: `#${colorHex}`,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      border: isAllSelected ? '2px solid #fff' : isPartiallySelected ? '2px solid #60a5fa' : '1px solid #334155',
                      boxShadow: (isAllSelected || isPartiallySelected) ? '0 0 0 1px #3b82f6' : 'none',
                      position: 'relative',
                      boxSizing: 'border-box'
                    }}
                    title={`#${colorHex}`}
                  >
                    {isAllSelected && (
                      <div style={{
                        position: 'absolute', top: '-6px', right: '-6px',
                        background: '#3b82f6', color: 'white', borderRadius: '50%',
                        width: '14px', height: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '9px', fontWeight: 'bold'
                      }}>
                        ✓
                      </div>
                    )}
                    {isPartiallySelected && (
                      <div style={{
                        position: 'absolute', top: '-6px', right: '-6px',
                        background: '#64748b', color: 'white', borderRadius: '50%',
                        width: '14px', height: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '12px', fontWeight: 'bold', lineHeight: 1
                      }}>
                        -
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedUniqueColors.length === 1 && !isMerging && (
              <button
                onClick={handleAutoSelectSimilar}
                style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.4rem', backgroundColor: '#10b981' }}
              >
                Auto-Select Similar
              </button>
            )}

            {selectedUniqueColors.length > 1 && !isMerging && (
              <button
                onClick={() => setIsMerging(true)}
                style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.4rem', backgroundColor: '#8b5cf6', width: '100%' }}
              >
                Merge Selected Colors
              </button>
            )}

            {selectedMeshIds.length > 1 && !isMerging && (
              <button
                onClick={handleFuseParts}
                style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.4rem', backgroundColor: '#f97316', width: '100%' }}
                title="Mathematically fuse touching parts into a single seamless polygon"
              >
                Fuse Touching Parts
              </button>
            )}

            {isMerging && (
              <div style={{ marginTop: '0.5rem', backgroundColor: '#334155', padding: '0.5rem', borderRadius: '4px' }}>
                <div style={{ fontSize: '0.75rem', marginBottom: '0.5rem', color: '#cbd5e1' }}>Select target color:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', padding: '0.25rem 0' }}>
                  {selectedUniqueColors.map(colorHex => (
                    <div key={`target-${colorHex}`} style={{ position: 'relative' }}>
                      <div
                        onClick={() => handleMergeColors(colorHex)}
                        style={{
                          width: '32px', height: '32px', backgroundColor: `#${colorHex}`,
                          borderRadius: '50%', cursor: 'pointer', border: '2px solid #475569',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)', transition: 'transform 0.1s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        title={`Merge into #${colorHex}`}
                      />
                      <div
                        onClick={(e) => { e.stopPropagation(); removeColorFromSelection(colorHex); }}
                        style={{
                          position: 'absolute', top: '-4px', right: '-4px',
                          width: '16px', height: '16px', backgroundColor: '#ef4444',
                          color: 'white', borderRadius: '50%', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', fontSize: '10px',
                          fontWeight: 'bold', cursor: 'pointer', border: '1px solid #1e293b',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.3)'
                        }}
                        title="Remove color from selection"
                      >
                        ✕
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                  <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', color: '#94a3b8' }}>
                    <input
                      type="checkbox"
                      checked={mergeMatching}
                      onChange={(e) => setMergeMatching(e.target.checked)}
                    />
                    Also merge unselected parts of these colors
                  </label>
                </div>

                <button
                  onClick={() => setIsMerging(false)}
                  style={{ marginTop: '0.5rem', fontSize: '0.7rem', padding: '0.2rem 0.5rem', backgroundColor: 'transparent', border: '1px solid #64748b' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 'auto' }}>
          <div className="control-group">
            <h3 style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: '#94a3b8' }}>3D PRINT SETTINGS</h3>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div style={{ flex: 1 }}>
                <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>Printer Profile</label>
                <select
                  value={printerProfile}
                  onChange={(e) => setPrinterProfile(e.target.value as 'A1 Mini (180x180)' | 'X1/P1/A1 (256x256)')}
                  style={{ width: '100%', padding: '4px', borderRadius: '4px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
                >
                  <option value="A1 Mini (180x180)">A1 Mini (180x180)</option>
                  <option value="X1/P1/A1 (256x256)">X1 / P1 / A1 (256x256)</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>Export Size & Layout</label>
                <select
                  value={gridSize}
                  onChange={(e) => setGridSize(e.target.value)}
                  style={{ width: '100%', padding: '4px', borderRadius: '4px', border: '1px solid #334155', background: '#0f172a', color: 'white' }}
                >
                  <option value="auto">Original Size (Auto-Grid, Max 2x2)</option>
                  <option value="1x1">Scale to Fit: 1x1 Plate</option>
                  <option value="2x2">Scale to Fit: 2x2 Plates</option>
                  <option value="1x2">Scale to Fit: 1x2 (Vertical)</option>
                  <option value="2x1">Scale to Fit: 2x1 (Horizontal)</option>
                </select>
              </div>
            </div>

            {gridSize === 'auto' && (
              <div style={{ marginBottom: '1rem' }}>
                <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>Scale Multiplier (%)</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="range"
                    min="10"
                    max="500"
                    step="10"
                    value={customScale}
                    onChange={(e) => setCustomScale(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: '0.75rem', width: '40px', color: 'white' }}>{customScale}%</span>
                </div>
              </div>
            )}

            {!mergeColors3MF && (
              <div style={{ marginBottom: '1rem' }}>
                <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>Assembly Clearance (mm)</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.05"
                    value={clearance}
                    onChange={(e) => setClearance(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontSize: '0.75rem', width: '40px', color: 'white' }}>{clearance.toFixed(2)}</span>
                </div>
              </div>
            )}

            <button
              disabled={!svgUrl || !!exportStatus}
              style={{ width: '100%', marginBottom: '0.5rem', backgroundColor: '#ec4899' }}
              onClick={handleExport3MF}
            >
              <Download size={18} />
              Export 3MF (Multi-Plate)
            </button>

            <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={mergeColors3MF}
                onChange={(e) => setMergeColors3MF(e.target.checked)}
              />
              Join objects by color for 3MF
            </label>

            <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={mergeBeforeExport}
                onChange={(e) => setMergeBeforeExport(e.target.checked)}
              />
              Join objects for GLTF (Single Mesh)
            </label>

            <button
              disabled={!svgUrl}
              style={{ width: '100%', backgroundColor: '#475569' }}
              onClick={handleExport}
            >
              <Download size={18} />
              Export GLTF (Raw)
            </button>
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
          <Canvas camera={{ position: [0, 0, 100], fov: 50 }} onPointerMissed={() => setSelectedMeshIds([])}>
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
