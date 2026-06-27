import { useState, useRef, Suspense, useEffect } from 'react';
import { Upload, Download, Undo } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import ImageTracer from 'imagetracerjs';
import { SvgModel } from './components/SvgModel';
import './index.css';

function App() {
  const [svgUrl, setSvgUrl] = useState<string | null>(null);
  const [selectedMeshIndices, setSelectedMeshIndices] = useState<number[]>([]);
  const [meshDepths, setMeshDepths] = useState<Record<number, number>>({});
  const [vertexCount, setVertexCount] = useState<number>(0);
  const [isTracing, setIsTracing] = useState<string | null>(null);
  const [selectByColor, setSelectByColor] = useState<boolean>(false);
  const [sealGaps, setSealGaps] = useState<boolean>(true);
  const [cutOverlaps, setCutOverlaps] = useState<boolean>(false);
  const [history, setHistory] = useState<Record<number, number>[]>([]);
  
  const sceneRef = useRef<THREE.Group>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type === 'image/svg+xml') {
        const url = URL.createObjectURL(file);
        setIsTracing("Loading SVG Geometry...");
        
        // Yield to allow React to paint the loading screen before blocking the thread
        setTimeout(() => {
          setSvgUrl(url);
          setSelectedMeshIndices([]);
          setMeshDepths({});
          setVertexCount(0); // Reset vertices
          setHistory([]); // Reset history
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
                    setSelectedMeshIndices([]);
                    setMeshDepths({});
                    setVertexCount(0);
                    setHistory([]);
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
      selectedMeshIndices.forEach(index => {
        newDepths[index] = depth;
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
  // Keyboard shortcut for Undo (Ctrl+Z / Cmd+Z)
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
    
    const exporter = new GLTFExporter();
    exporter.parse(
      sceneRef.current,
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
  const currentDepth = selectedMeshIndices.length > 0 
    ? selectedMeshIndices.reduce((sum, idx) => sum + (meshDepths[idx] ?? 0), 0) / selectedMeshIndices.length 
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
            disabled={selectedMeshIndices.length === 0}
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

        <div style={{ marginTop: 'auto' }}>
          <button 
            disabled={!svgUrl} 
            style={{ width: '100%' }}
            onClick={handleExport}
          >
            <Download size={18} />
            Export GLTF
          </button>
        </div>
      </div>

      <div className="main-content" style={{ position: 'relative' }}>
        {isTracing && (
          <div className="empty-state" style={{ 
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem',
            backgroundColor: '#0f172a'
          }}>
            <div className="spinner" style={{ 
              width: '40px', height: '40px', border: '4px solid #334155', borderTopColor: '#60a5fa', borderRadius: '50%', animation: 'spin 1s linear infinite' 
            }} />
            <span style={{ fontWeight: 'bold' }}>{isTracing}</span>
            <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          </div>
        )}
        
        {!svgUrl && !isTracing && (
          <div className="empty-state">
            Upload an SVG or Image to get started
          </div>
        )}

        {svgUrl && (
          <Canvas camera={{ position: [0, 0, 100], fov: 50 }}>
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 10]} intensity={1} castShadow />
            <OrbitControls makeDefault />
            <Suspense fallback={null}>
              <Center>
                <group ref={sceneRef}>
                  <SvgModel 
                    svgUrl={svgUrl} 
                    selectByColor={selectByColor}
                    sealGaps={sealGaps}
                    cutOverlaps={cutOverlaps}
                    selectedMeshIndices={selectedMeshIndices}
                    meshDepths={meshDepths}
                    onSelect={(indices, shiftKey) => {
                      setSelectedMeshIndices(prev => {
                        if (shiftKey) {
                          const isAdding = !prev.includes(indices[0]);
                          if (isAdding) {
                            return [...new Set([...prev, ...indices])];
                          } else {
                            return prev.filter(i => !indices.includes(i));
                          }
                        }
                        return indices;
                      });
                    }}
                    onVerticesCalculated={setVertexCount}
                    onParseProgress={(msg) => setIsTracing(msg)}
                    onParseComplete={() => setIsTracing(null)}
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
