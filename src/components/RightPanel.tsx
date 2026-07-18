import React from 'react';
import { LayoutGrid, Zap, Combine, LayoutTemplate, SplitSquareHorizontal, Network, MoveVertical } from 'lucide-react';
import { HoverSlider } from './HoverSlider';

export interface RightPanelProps {
  sealGaps: boolean;
  setSealGaps: (v: boolean) => void;
  cutOverlaps: boolean;
  setCutOverlaps: (v: boolean) => void;
  svgUrl: string | null;
  backingDepth: number;
  setBackingDepth: (v: number) => void;
  selectSizeThreshold: number;
  handleSelectBySizeChange: (v: number) => void;
  selectedMeshIds: string[];
  handleExtractInner: () => void;
  isExtracting: boolean;
  extractStatus: string | null;
  handleCreateBasePlate: () => void;
  isBasePlating: boolean;
  basePlateStatus: string | null;
  handleSplitDisjoint: () => void;
  isSplitting: boolean;
  splitStatus: string | null;
  handlePreviewShards: () => void;
  isAbsorbingShards: boolean;
  pendingShards: Record<string, string[]> | null;
  ignoredShardColors: string[];
  setIgnoredShardColors: React.Dispatch<React.SetStateAction<string[]>>;
  setPendingShards: React.Dispatch<React.SetStateAction<Record<string, string[]> | null>>;
  confirmAbsorbShards: () => void;
  borderWidth: number;
  setBorderWidth: (v: number) => void;
  handleCreateBorder: () => void;
  isBordering: boolean;
  borderStatus: string | null;
  borderOuterOnly: boolean;
  setBorderOuterOnly: (v: boolean) => void;
  expandAmount: number;
  setExpandAmount: (v: number) => void;
  handleExpandSelected: () => void;
  isExpanding: boolean;
  expandStatus: string | null;
  smoothAmount: number;
  setSmoothAmount: (v: number) => void;
  handleSmoothSelected: () => void;
  isSmoothing: boolean;
  smoothStatus: string | null;
}

export const RightPanel: React.FC<RightPanelProps> = (props) => {
  const {
    sealGaps, setSealGaps, cutOverlaps, setCutOverlaps, svgUrl, backingDepth, setBackingDepth,
    selectSizeThreshold, handleSelectBySizeChange, selectedMeshIds, handleExtractInner,
    isExtracting, extractStatus, handleCreateBasePlate, isBasePlating, basePlateStatus,
    handleSplitDisjoint, isSplitting, splitStatus, handlePreviewShards, isAbsorbingShards,
    pendingShards, ignoredShardColors, setIgnoredShardColors, setPendingShards, confirmAbsorbShards,
    borderWidth, setBorderWidth, handleCreateBorder, isBordering, borderStatus, borderOuterOnly,
    setBorderOuterOnly, expandAmount, setExpandAmount, handleExpandSelected, isExpanding,
    expandStatus, smoothAmount, setSmoothAmount, handleSmoothSelected, isSmoothing, smoothStatus
  } = props;

  return (
    <div className="right-sidebar">
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#cbd5e1' }}>
              <span>Backing Thickness (mm)</span>
              <span>{backingDepth}</span>
            </div>
            <HoverSlider
              min={0} max={10} step={1}
              value={backingDepth}
              onChange={(e: any) => setBackingDepth(parseFloat(e.target.value))}
              displayFormat={(v: number) => v.toString()}
            />
          </div>
          <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '0.5rem 0' }} />
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px', color: '#cbd5e1' }}>
              <span>Quick Select by Size</span>
              <span>{selectSizeThreshold}</span>
            </div>
            <HoverSlider
              min={0}
              max={10000}
              step={10}
              value={selectSizeThreshold}
              onChange={(e: any) => handleSelectBySizeChange(parseFloat(e.target.value))}
              displayFormat={(v: number) => Math.round(v).toString()}
            />
          </div>
        </div>
      </div>

      {selectedMeshIds.length > 0 ? (
        <>
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
            <div className="card-body" style={{ gap: '0.75rem', padding: '0.75rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '4px', color: '#cbd5e1' }}>
                  <span>Outline Border Width</span>
                  <span>{borderWidth.toFixed(1)}px</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}><HoverSlider min={0.1} max={20} step={0.1} value={borderWidth} onChange={(e: any) => setBorderWidth(parseFloat(e.target.value))} /></div>
                  <button style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', backgroundColor: '#eab308', border: 'none', color: 'white', borderRadius: '4px', cursor: isBordering ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', minWidth: '60px' }} onClick={handleCreateBorder} disabled={isBordering}>{isBordering ? borderStatus || "Working..." : "Generate"}</button>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.65rem', color: '#cbd5e1', marginTop: '4px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={borderOuterOnly} onChange={(e) => setBorderOuterOnly(e.target.checked)} style={{ marginRight: '4px' }} />
                  Outer Edges Only
                </label>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '4px', color: '#cbd5e1' }}>
                  <span>Expand Size (Fill Gaps)</span>
                  <span>{expandAmount.toFixed(1)}px</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}><HoverSlider min={0.1} max={5} step={0.1} value={expandAmount} onChange={(e: any) => setExpandAmount(parseFloat(e.target.value))} /></div>
                  <button style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', backgroundColor: '#6366f1', border: 'none', color: 'white', borderRadius: '4px', cursor: isExpanding ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', minWidth: '60px' }} onClick={handleExpandSelected} disabled={isExpanding}>{isExpanding ? expandStatus || "Working..." : "Expand"}</button>
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '4px', color: '#cbd5e1' }}>
                  <span>Smooth Intensity</span>
                  <span>{smoothAmount.toFixed(1)}</span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}><HoverSlider min={0.1} max={5} step={0.1} value={smoothAmount} onChange={(e: any) => setSmoothAmount(parseFloat(e.target.value))} /></div>
                  <button style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem', backgroundColor: '#ec4899', border: 'none', color: 'white', borderRadius: '4px', cursor: isSmoothing ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', minWidth: '60px' }} onClick={handleSmoothSelected} disabled={isSmoothing}>{isSmoothing ? smoothStatus || "Working..." : "Smooth"}</button>
                </div>
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
  );
};
