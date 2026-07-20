import React, { useEffect, useMemo, useState } from 'react';
import { Settings, Upload, Download, Wand2, Palette, Droplet, Combine, WrapText } from 'lucide-react';
import { HoverSlider } from './HoverSlider';
import { extractUniqueSvgFills } from '../lib/svg-preview';

export interface LeftPanelProps {
  handleLoadProject: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSaveProject: () => void;
  rawSvgContent: string | null;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  svgUrl: string | null;
  pipelinePhase: 'idle' | 'svgPreview' | 'extrudeReady';
  previewSvgUrl: string | null;
  handlePromoteTo3D: () => void;
  handleBackToSvgPreview: () => void;
  handleMergeSvgFills: (fromHexes: string[], toHex: string) => void;
  generateSVGFromCurrentShapes: () => string | null;
  uniqueColors: string[];
  handleAutoExtrude: () => void;
  handleConvertToLineArt: () => void;
  lineArtWidth: number;
  setLineArtWidth: (v: number) => void;
  imageDataUrl: string | null;
  colorCount: number;
  handleColorCountChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  tracerId: string;
  tracerBackends: { id: string; label: string; description: string }[];
  handleTracerChange: (id: string) => void;
  vtracerPreset: 'logo' | 'sketch' | 'photo';
  handleVtracerPresetChange: (preset: 'logo' | 'sketch' | 'photo') => void;
  vtracerFilterSpeckle: number;
  handleVtracerFilterSpeckleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  vtracerColorPrecisionBits: number;
  handleVtracerColorPrecisionChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  viColorPrecision: number;
  handleViColorPrecisionChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  viFilterSpeckle: number;
  handleViFilterSpeckleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  viPathPrecision: number;
  handleViPathPrecisionChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  viMaxColors: number;
  handleViMaxColorsChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
  handleCustomColorPointerDown: () => void;
  setMeshColorOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  pushToHistory: () => void;
}

export const LeftPanel: React.FC<LeftPanelProps> = (props) => {
  const {
    handleLoadProject, handleSaveProject, rawSvgContent, handleFileUpload, svgUrl,
    pipelinePhase, previewSvgUrl, handlePromoteTo3D, handleBackToSvgPreview, handleMergeSvgFills,
    generateSVGFromCurrentShapes, uniqueColors, handleAutoExtrude, handleConvertToLineArt,
    lineArtWidth, setLineArtWidth,
    imageDataUrl, colorCount, handleColorCountChange, tracerId, tracerBackends, handleTracerChange,
    vtracerPreset, handleVtracerPresetChange,
    vtracerFilterSpeckle, handleVtracerFilterSpeckleChange,
    vtracerColorPrecisionBits, handleVtracerColorPrecisionChange,
    viColorPrecision, handleViColorPrecisionChange,
    viFilterSpeckle, handleViFilterSpeckleChange,
    viPathPrecision, handleViPathPrecisionChange,
    viMaxColors, handleViMaxColorsChange,
    highlightStyle, setHighlightStyle,
    currentMeshColors, selectedMeshIds, setSelectedMeshIds, selectedUniqueColors,
    isMerging, handleAutoSelectSimilar, toggleColorSelection, initiateFuse,
    isFusingSelection, setIsMerging, executeMergeColors, removeColorFromSelection,
    executeFuse, setIsFusingSelection, handleCustomColorChange, handleCustomColorPointerDown, setMeshColorOverrides, pushToHistory
  } = props;

  const svgStageColors = useMemo(
    () => (pipelinePhase === 'svgPreview' && rawSvgContent ? extractUniqueSvgFills(rawSvgContent) : []),
    [pipelinePhase, rawSvgContent],
  );
  const [selectedSvgFills, setSelectedSvgFills] = useState<string[]>([]);
  const [isSvgMerging, setIsSvgMerging] = useState(false);

  useEffect(() => {
    setSelectedSvgFills((prev) => prev.filter((c) => svgStageColors.includes(c)));
  }, [svgStageColors]);

  useEffect(() => {
    if (pipelinePhase !== 'svgPreview') {
      setIsSvgMerging(false);
      setSelectedSvgFills([]);
    }
  }, [pipelinePhase]);

  const toggleSvgFill = (hex: string) => {
    setSelectedSvgFills((prev) =>
      prev.includes(hex) ? prev.filter((c) => c !== hex) : [...prev, hex],
    );
  };

  const svgColorDistance = (hex1: string, hex2: string) => {
    const r1 = (parseInt(hex1, 16) >> 16) & 0xff;
    const g1 = (parseInt(hex1, 16) >> 8) & 0xff;
    const b1 = parseInt(hex1, 16) & 0xff;
    const r2 = (parseInt(hex2, 16) >> 16) & 0xff;
    const g2 = (parseInt(hex2, 16) >> 8) & 0xff;
    const b2 = parseInt(hex2, 16) & 0xff;
    return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
  };

  const handleAutoSelectSimilarSvg = () => {
    if (selectedSvgFills.length !== 1) return;
    const base = selectedSvgFills[0];
    const similar = svgStageColors.filter((c) => svgColorDistance(base, c) < 2500);
    setSelectedSvgFills(similar);
  };

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
                <span style={{ fontSize: '0.6rem', backgroundColor: '#fbbf24', color: '#78350f', padding: '1px 4px', borderRadius: '4px', fontWeight: 'bold', marginLeft: '2px' }}>Beta</span>
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

          {svgUrl && pipelinePhase === 'extrudeReady' && (
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
              <div style={{ marginTop: '0.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.2rem' }}>
                  <label htmlFor="line-art-width">Line thickness</label>
                  <span>{lineArtWidth.toFixed(1)}</span>
                </div>
                <HoverSlider
                  id="line-art-width"
                  min={0.5}
                  max={20}
                  step={0.1}
                  value={lineArtWidth}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLineArtWidth(parseFloat(e.target.value))}
                  displayFormat={(v: number) => v.toFixed(1)}
                />
              </div>
            </>
          )}

          {(pipelinePhase === 'svgPreview' || (pipelinePhase === 'extrudeReady' && imageDataUrl)) && previewSvgUrl && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {pipelinePhase === 'svgPreview' && (
                <button
                  onClick={handlePromoteTo3D}
                  style={{
                    width: '100%', padding: '0.65rem',
                    background: 'linear-gradient(135deg, #059669, #10b981)',
                    color: 'white', border: 'none', borderRadius: '8px',
                    cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                  }}
                >
                  Continue to 3D
                </button>
              )}
              {pipelinePhase === 'extrudeReady' && imageDataUrl && (
                <button
                  onClick={handleBackToSvgPreview}
                  style={{
                    width: '100%', padding: '0.45rem',
                    backgroundColor: '#334155', color: 'white',
                    border: '1px solid #475569', borderRadius: '6px',
                    cursor: 'pointer', fontSize: '0.75rem',
                  }}
                >
                  Back to SVG preview
                </button>
              )}
              {pipelinePhase === 'svgPreview' && (
                <button
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = previewSvgUrl;
                    link.download = 'vectorized_preview.svg';
                    link.click();
                  }}
                  style={{
                    width: '100%', padding: '0.4rem', backgroundColor: '#334155', color: 'white',
                    border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                    cursor: 'pointer', fontSize: '0.75rem', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                  }}
                >
                  <Download size={14} /> Download SVG
                </button>
              )}
            </div>
          )}

          {pipelinePhase === 'svgPreview' && svgStageColors.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  SVG fills ({svgStageColors.length}) — merge before 3D
                </div>
                {selectedSvgFills.length === 1 && !isSvgMerging && (
                  <button
                    type="button"
                    onClick={handleAutoSelectSimilarSvg}
                    style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', backgroundColor: '#10b981', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Auto-Select Similar
                  </button>
                )}
              </div>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '0.4rem', maxHeight: '120px',
                overflowY: 'auto', padding: '0.4rem',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
                backgroundColor: 'rgba(0,0,0,0.2)', marginBottom: '0.5rem',
              }}>
                {svgStageColors.map((hex) => {
                  const selected = selectedSvgFills.includes(hex);
                  return (
                    <div
                      key={hex}
                      onClick={() => toggleSvgFill(hex)}
                      title={`#${hex}`}
                      style={{
                        width: '26px', height: '26px', backgroundColor: `#${hex}`, borderRadius: '6px',
                        cursor: 'pointer',
                        border: selected ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                        boxShadow: selected ? '0 0 0 2px rgba(139,92,246,0.5)' : 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setIsSvgMerging(true)}
                disabled={selectedSvgFills.length <= 1 || isSvgMerging}
                style={{
                  width: '100%', padding: '0.45rem', fontSize: '0.75rem', fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                  backgroundColor: selectedSvgFills.length > 1 ? '#8b5cf6' : '#334155',
                  color: 'white', border: 'none', borderRadius: '6px',
                  cursor: selectedSvgFills.length > 1 ? 'pointer' : 'not-allowed',
                  opacity: selectedSvgFills.length > 1 ? 1 : 0.5,
                }}
              >
                <WrapText size={14} /> Merge Colors
              </button>
              {isSvgMerging && (
                <div style={{ marginTop: '0.5rem', backgroundColor: 'rgba(51,65,85,0.5)', padding: '0.75rem', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: '0.75rem', marginBottom: '0.75rem', color: '#cbd5e1' }}>
                    Select target color to merge into:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                    {selectedSvgFills.map((colorHex) => (
                      <div key={`svg-target-${colorHex}`} style={{ position: 'relative' }}>
                        <div
                          onClick={() => {
                            handleMergeSvgFills(selectedSvgFills, colorHex);
                            setSelectedSvgFills([]);
                            setIsSvgMerging(false);
                          }}
                          style={{
                            width: '32px', height: '32px', backgroundColor: `#${colorHex}`, borderRadius: '50%',
                            cursor: 'pointer', border: '2px solid rgba(255,255,255,0.2)',
                          }}
                          title={`Merge into #${colorHex}`}
                        />
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSvgFills((prev) => prev.filter((c) => c !== colorHex));
                          }}
                          style={{
                            position: 'absolute', top: '-4px', right: '-4px', width: '16px', height: '16px',
                            backgroundColor: '#ef4444', color: 'white', borderRadius: '50%', display: 'flex',
                            alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold',
                            cursor: 'pointer', border: '1px solid #1e293b',
                          }}
                          title="Remove color from selection"
                        >
                          ✕
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSvgMerging(false)}
                    style={{ marginTop: '0.75rem', fontSize: '0.7rem', padding: '0.3rem 0.5rem', backgroundColor: 'transparent', border: '1px solid #64748b', width: '100%', color: '#cbd5e1', cursor: 'pointer' }}
                  >
                    Cancel Merge
                  </button>
                </div>
              )}
            </div>
          )}

          {imageDataUrl && (
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                Vectorizer
              </div>
              <div className="segmented-control" style={{ marginBottom: '0.5rem' }}>
                {tracerBackends.map((backend) => (
                  <label key={backend.id} title={backend.description}>
                    <input
                      type="radio"
                      name="tracerBackend"
                      checked={tracerId === backend.id}
                      onChange={() => handleTracerChange(backend.id)}
                    />
                    <span>{backend.label}</span>
                  </label>
                ))}
              </div>

              {tracerId === 'vectorize-image' && (
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    Preset (website-style)
                  </div>
                  <div className="segmented-control">
                    {([
                      { id: 'logo' as const, label: 'Logo' },
                      { id: 'sketch' as const, label: 'Sketch' },
                      { id: 'photo' as const, label: 'Photo' },
                    ]).map((p) => (
                      <label key={p.id} title={`${p.label} (vectorize-image.app style)`}>
                        <input
                          type="radio"
                          name="vtracerPreset"
                          checked={vtracerPreset === p.id}
                          onChange={() => handleVtracerPresetChange(p.id)}
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', margin: '0.65rem 0 0.35rem' }}>
                    Advanced — fine-tune if too noisy, flat, or large
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    <label htmlFor="vi-max-colors">Max colors</label>
                    <span>{viMaxColors} max</span>
                  </div>
                  <HoverSlider
                    id="vi-max-colors"
                    min={2}
                    max={64}
                    step={1}
                    value={viMaxColors}
                    onChange={handleViMaxColorsChange}
                    displayFormat={(v: number) => Math.round(v).toString()}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', margin: '0.5rem 0 0.25rem' }}>
                    <label htmlFor="vi-color-precision">Color precision</label>
                    <span>{viColorPrecision}</span>
                  </div>
                  <HoverSlider
                    id="vi-color-precision"
                    min={1}
                    max={8}
                    step={1}
                    value={viColorPrecision}
                    onChange={handleViColorPrecisionChange}
                    displayFormat={(v: number) => Math.round(v).toString()}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', margin: '0.5rem 0 0.25rem' }}>
                    <label htmlFor="vi-filter-speckle">Speckle filter</label>
                    <span>{viFilterSpeckle}</span>
                  </div>
                  <HoverSlider
                    id="vi-filter-speckle"
                    min={0}
                    max={20}
                    step={1}
                    value={viFilterSpeckle}
                    onChange={handleViFilterSpeckleChange}
                    displayFormat={(v: number) => Math.round(v).toString()}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', margin: '0.5rem 0 0.25rem' }}>
                    <label htmlFor="vi-path-precision">Path precision</label>
                    <span>{viPathPrecision}</span>
                  </div>
                  <HoverSlider
                    id="vi-path-precision"
                    min={0}
                    max={8}
                    step={1}
                    value={viPathPrecision}
                    onChange={handleViPathPrecisionChange}
                    displayFormat={(v: number) => Math.round(v).toString()}
                  />
                </div>
              )}

              {tracerId === 'vtracer' && (
                <>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: '0.5rem' }}>
                    Print path — limited colors + sealed seams
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    <label htmlFor="color-count">Image Colors To Extract</label>
                    <span>{colorCount} max</span>
                  </div>
                  <HoverSlider id="color-count" min={2} max={64} step={1} value={colorCount} onChange={handleColorCountChange} displayFormat={(v: number) => Math.round(v).toString()} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', margin: '0.5rem 0 0.25rem' }}>
                    <label htmlFor="filter-speckle">Filter Speckle</label>
                    <span>{vtracerFilterSpeckle}</span>
                  </div>
                  <HoverSlider
                    id="filter-speckle"
                    min={0}
                    max={20}
                    step={1}
                    value={vtracerFilterSpeckle}
                    onChange={handleVtracerFilterSpeckleChange}
                    displayFormat={(v: number) => Math.round(v).toString()}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#94a3b8', margin: '0.5rem 0 0.25rem' }}>
                    <label htmlFor="color-precision">Color Detail</label>
                    <span>{vtracerColorPrecisionBits === 0 ? 'Auto' : `${vtracerColorPrecisionBits} bits`}</span>
                  </div>
                  <HoverSlider
                    id="color-precision"
                    min={0}
                    max={8}
                    step={1}
                    value={vtracerColorPrecisionBits}
                    onChange={handleVtracerColorPrecisionChange}
                    displayFormat={(v: number) => (Math.round(v) === 0 ? 'Auto' : Math.round(v).toString())}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {pipelinePhase === 'extrudeReady' && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}><Droplet size={12} style={{ marginRight: '4px' }} /> Highlight Style</div>
          <div className="segmented-control">
            <label>
              <input type="radio" name="highlightStyle" checked={highlightStyle === 'solid'} onChange={() => setHighlightStyle('solid')} />
              <span>Striped</span>
            </label>
            <label>
              <input type="radio" name="highlightStyle" checked={highlightStyle === 'dashed'} onChange={() => setHighlightStyle('dashed')} />
              <span>Dashed</span>
            </label>
          </div>
        </div>
      )}

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
                  onPointerDown={handleCustomColorPointerDown}
                  onChange={handleCustomColorChange}
                  style={{ width: '32px', height: '32px', border: 'none', padding: 0, background: 'transparent', cursor: 'pointer' }}
                  title="Pick a custom color"
                />
                <div style={{ flex: 1, display: 'flex', gap: '4px', overflowX: 'auto', padding: '2px 0' }}>
                  {uniqueColors.slice(0, 10).map(colorHex => (
                    <div
                      key={`palette-${colorHex}`}
                      onClick={() => {
                        if (selectedMeshIds.length === 0) return;
                        pushToHistory();
                        setMeshColorOverrides(prev => {
                          const next = { ...prev };
                          selectedMeshIds.forEach(id => next[id] = colorHex);
                          return next;
                        });
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
