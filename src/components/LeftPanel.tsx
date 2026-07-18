import React from 'react';
import { Settings, Upload, Download, Wand2, Palette, Droplet, Combine, WrapText } from 'lucide-react';
import { HoverSlider } from './HoverSlider';

export interface LeftPanelProps {
  handleLoadProject: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSaveProject: () => void;
  rawSvgContent: string | null;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  svgUrl: string | null;
  generateSVGFromCurrentShapes: () => string | null;
  uniqueColors: string[];
  handleAutoExtrude: () => void;
  handleConvertToLineArt: () => void;
  imageDataUrl: string | null;
  colorCount: number;
  handleColorCountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  highlightStyle: 'dashed' | 'solid';
  setHighlightStyle: (style: 'dashed' | 'solid') => void;
  currentMeshColors: { id: string; colorHex: string }[];
  selectedMeshIds: string[];
  setSelectedMeshIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedUniqueColors: string[];
  isMerging: boolean;
  handleAutoSelectSimilar: () => void;
  toggleColorSelection: (colorHex: string) => void;
  initiateFuse: () => void;
  isFusingSelection: boolean;
  setIsMerging: (v: boolean) => void;
  executeMergeColors: (colorHex: string) => void;
  removeColorFromSelection: (colorHex: string) => void;
  executeFuse: (colorHex: string) => void;
  setIsFusingSelection: (v: boolean) => void;
  handleCustomColorChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setMeshColorOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  pushToHistory: () => void;
}

export const LeftPanel: React.FC<LeftPanelProps> = (props) => {
  const {
    handleLoadProject, handleSaveProject, rawSvgContent, handleFileUpload, svgUrl,
    generateSVGFromCurrentShapes, uniqueColors, handleAutoExtrude, handleConvertToLineArt,
    imageDataUrl, colorCount, handleColorCountChange, highlightStyle, setHighlightStyle,
    currentMeshColors, selectedMeshIds, setSelectedMeshIds, selectedUniqueColors,
    isMerging, handleAutoSelectSimilar, toggleColorSelection, initiateFuse,
    isFusingSelection, setIsMerging, executeMergeColors, removeColorFromSelection,
    executeFuse, setIsFusingSelection, handleCustomColorChange, setMeshColorOverrides, pushToHistory
  } = props;

  return (
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
            <>
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

              <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                <button
                  onClick={handleAutoExtrude}
                  disabled={uniqueColors.length === 0}
                  style={{
                    flex: 1, padding: '0.5rem',
                    background: uniqueColors.length > 0
                      ? 'linear-gradient(135deg, #d97706, #f59e0b)'
                      : 'rgba(255,255,255,0.05)',
                    color: uniqueColors.length > 0 ? 'white' : '#64748b',
                    border: 'none', borderRadius: '6px',
                    cursor: uniqueColors.length > 0 ? 'pointer' : 'not-allowed',
                    fontSize: '0.8rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                    transition: 'opacity 0.2s',
                    boxShadow: uniqueColors.length > 0 ? '0 2px 8px rgba(245,158,11,0.35)' : 'none',
                  }}
                  title="Automatically extrude outlines high and fill colors low (one-click 3D-ready)"
                >
                  <Wand2 size={14} /> Auto-Extrude
                </button>

                <button
                  onClick={handleConvertToLineArt}
                  disabled={uniqueColors.length === 0}
                  style={{
                    flex: 1, padding: '0.5rem',
                    background: uniqueColors.length > 0
                      ? 'linear-gradient(135deg, #475569, #1e293b)'
                      : 'rgba(255,255,255,0.05)',
                    color: uniqueColors.length > 0 ? 'white' : '#64748b',
                    border: '1px solid #64748b', borderRadius: '6px',
                    cursor: uniqueColors.length > 0 ? 'pointer' : 'not-allowed',
                    fontSize: '0.8rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                    transition: 'opacity 0.2s',
                  }}
                  title="Convert to Black & White line art (strokes black, fills white)"
                >
                  <Palette size={14} /> Line Art
                </button>
              </div>
            </>
          )}

          {imageDataUrl && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                <label htmlFor="color-count">Image Colors To Extract</label>
                <span>{colorCount}</span>
              </div>
              <HoverSlider id="color-count" min={2} max={256} step={1} value={colorCount} onChange={handleColorCountChange} displayFormat={(v: number) => Math.round(v).toString()} />
            </div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}><Droplet size={12} style={{ marginRight: '4px' }} /> Highlight Style</div>
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

      {uniqueColors.length > 0 && (
        <div className="card">
          <div className="card-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label className="checkbox-label" style={{ fontSize: '0.75rem', fontWeight: 'bold', margin: 0, gap: '6px' }}>
                <input 
                  type="checkbox" 
                  checked={uniqueColors.length > 0 && uniqueColors.every(c => currentMeshColors.filter(m => m.colorHex === c).every(m => selectedMeshIds.includes(m.id)))} 
                  onChange={(e) => {
                    if (e.target.checked) setSelectedMeshIds(currentMeshColors.map(m => m.id));
                    else setSelectedMeshIds([]);
                  }} 
                />
                Select All Colors
              </label>
              {selectedUniqueColors.length === 1 && !isMerging && (
                <button onClick={handleAutoSelectSimilar} style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', backgroundColor: '#10b981', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }}>
                  Auto-Select Similar
                </button>
              )}
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
          </div>
        </div>
      )}
    </div>
  );
};
