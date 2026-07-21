import React from 'react';
import { Download } from 'lucide-react';
import { HoverSlider } from './HoverSlider';
import { THIN_WALL_THRESHOLD_MM, type ThinWallPart } from '../lib/thin-wall-check';
import { EXPORT_VERTEX_SOFT_LIMIT, EXPORT_VERTEX_HARD_LIMIT } from '../lib/export-constants';
import type { RobustFailurePolicy } from '../lib/export-constants';

export type PrinterProfileType = 'A1 Mini (180x180)' | 'X1/P1/A1 (256x256)';

interface ExportDialogProps {
  setShowExportOptions: (show: boolean) => void;
  printerProfile: PrinterProfileType;
  setPrinterProfile: (val: PrinterProfileType) => void;
  gridSize: string;
  setGridSize: (val: string) => void;
  mergeColors3MF: boolean;
  setMergeColors3MF: (val: boolean) => void;
  customScale: number;
  setCustomScale: (val: number) => void;
  scaleZProportionally: boolean;
  setScaleZProportionally: (val: boolean) => void;
  clearance: number;
  setClearance: (val: number) => void;
  mergeBeforeExport: boolean;
  setMergeBeforeExport: (val: boolean) => void;
  robustExportMode: boolean;
  setRobustExportMode: (val: boolean) => void;
  robustFailurePolicy: RobustFailurePolicy;
  setRobustFailurePolicy: (val: RobustFailurePolicy) => void;
  printFaceDown: boolean;
  setPrintFaceDown: (val: boolean) => void;
  canPrintFaceDown: boolean;
  colorOnFaceOnly: boolean;
  setColorOnFaceOnly: (val: boolean) => void;
  faceColorDepthMm: number;
  setFaceColorDepthMm: (val: number) => void;
  faceBaseColorHex: string;
  setFaceBaseColorHex: (val: string) => void;
  uniqueColors: string[];
  thinWallParts: ThinWallPart[];
  thinWallStatus: string | null;
  handleSelectThinParts: () => void;
  handleExport3MF: () => void;
  handleExportSTL: () => void;
  svgUrl: string | null;
  exportStatus: string | null;
  vertexCount: number;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  setShowExportOptions,
  printerProfile,
  setPrinterProfile,
  gridSize,
  setGridSize,
  mergeColors3MF,
  setMergeColors3MF,
  customScale,
  setCustomScale,
  scaleZProportionally,
  setScaleZProportionally,
  clearance,
  setClearance,
  mergeBeforeExport,
  setMergeBeforeExport,
  robustExportMode,
  setRobustExportMode,
  robustFailurePolicy,
  setRobustFailurePolicy,
  printFaceDown,
  setPrintFaceDown,
  canPrintFaceDown,
  colorOnFaceOnly,
  setColorOnFaceOnly,
  faceColorDepthMm,
  setFaceColorDepthMm,
  faceBaseColorHex,
  setFaceBaseColorHex,
  uniqueColors,
  thinWallParts,
  thinWallStatus,
  handleSelectThinParts,
  handleExport3MF,
  handleExportSTL,
  svgUrl,
  exportStatus,
  vertexCount
}) => {
  const clearanceActive = !mergeColors3MF;
  const FACE_DEPTH_PRESETS = [0.08, 0.2, 0.4, 1.0];

  return (
    <div className="export-popup-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(3px)' }} onClick={(e) => { if (e.target === e.currentTarget) setShowExportOptions(false); }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '400px', maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto', position: 'relative', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', border: '1px solid #475569', padding: '1rem', backgroundColor: '#1e293b' }}>
        <div className="card-header" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Download size={14} style={{ marginRight: '6px' }} /> EXPORT OPTIONS
          </div>
          <button style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '-4px -4px -4px 0' }} onClick={() => setShowExportOptions(false)}>✕</button>
        </div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label className="checkbox-label" style={{ fontSize: '0.75rem', marginBottom: '0.35rem', color: '#94a3b8' }}>Printer Profile</label>
              <select className="custom-select" value={printerProfile} onChange={(e) => setPrinterProfile(e.target.value as PrinterProfileType)}>
                <option value="A1 Mini (180x180)">A1 Mini (180x180)</option>
                <option value="X1/P1/A1 (256x256)">X1/P1/A1 (256x256)</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="checkbox-label" style={{ fontSize: '0.75rem', marginBottom: '0.35rem', color: '#94a3b8' }}>Export Layout</label>
              <select className="custom-select" value={gridSize} onChange={(e) => setGridSize(e.target.value)}>
                <option value="auto">Actual Size (Auto-split)</option>
                <option value="1x1">Fill 1x1 Plate</option>
                <option value="2x2">Fill 2x2 Plates</option>
                <option value="1x2">Fill 1x2 (Vertical)</option>
                <option value="2x1">Fill 2x1 (Horizontal)</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '1rem', opacity: gridSize === 'auto' ? 1 : 0.4, pointerEvents: gridSize === 'auto' ? 'auto' : 'none' }}>
            <label className="checkbox-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem', color: '#94a3b8' }}>Scale Multiplier (%)</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <HoverSlider min={10} max={500} step={10} value={customScale} onChange={(e: any) => setCustomScale(Number(e.target.value))} displayFormat={(v: number) => `${Math.round(v)}%`} />
              </div>
              <span style={{ fontSize: '0.75rem', width: '40px', color: 'white', textAlign: 'right' }}>{customScale}%</span>
            </div>
            {gridSize !== 'auto' && (
              <div style={{ fontSize: '0.65rem', color: '#fbbf24', marginTop: '0.25rem' }}>Scale Multiplier is only used when "Actual Size" is selected.</div>
            )}
          </div>

          <div style={{ marginBottom: '1rem', opacity: clearanceActive ? 1 : 0.4, pointerEvents: clearanceActive ? 'auto' : 'none' }}>
            <label className="checkbox-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem', color: '#94a3b8' }}>Assembly Clearance (mm)</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <HoverSlider min={0} max={1} step={0.05} value={clearance} onChange={(e: any) => setClearance(Number(e.target.value))} displayFormat={(v: number) => v.toFixed(2)} />
              </div>
              <span style={{ fontSize: '0.75rem', width: '40px', color: 'white', textAlign: 'right' }}>{clearance.toFixed(2)}</span>
            </div>
            {!clearanceActive && (
              <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                Clearance is ignored when joining objects by color.
              </div>
            )}
          </div>

          {thinWallStatus && (
            <div style={{ marginBottom: '1rem', padding: '0.65rem 0.75rem', borderRadius: '6px', backgroundColor: 'rgba(148, 163, 184, 0.12)', border: '1px solid rgba(148, 163, 184, 0.35)' }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', lineHeight: 1.4 }}>
                {thinWallStatus}
              </div>
            </div>
          )}

          {thinWallParts.length > 0 && (
            <div style={{ marginBottom: '1rem', padding: '0.65rem 0.75rem', borderRadius: '6px', backgroundColor: 'rgba(251, 191, 36, 0.12)', border: '1px solid rgba(251, 191, 36, 0.35)' }}>
              <div style={{ fontSize: '0.75rem', color: '#fbbf24', lineHeight: 1.4, marginBottom: '0.5rem' }}>
                {thinWallParts.length} part{thinWallParts.length === 1 ? '' : 's'} may be too thin to print (&lt; {THIN_WALL_THRESHOLD_MM}mm).
                Scale up, reduce clearance, or simplify the SVG.
              </div>
              <button
                type="button"
                onClick={handleSelectThinParts}
                style={{ fontSize: '0.7rem', padding: '4px 8px', borderRadius: '4px', border: '1px solid #fbbf24', background: 'transparent', color: '#fbbf24', cursor: 'pointer' }}
              >
                Select thin parts
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>
              <input type="checkbox" checked={scaleZProportionally} onChange={(e) => setScaleZProportionally(e.target.checked)} />
              Scale Depth Proportionally
            </label>

            <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>
              <input type="checkbox" checked={mergeColors3MF} onChange={(e) => setMergeColors3MF(e.target.checked)} />
              Join objects by color for 3MF
            </label>

            <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>
              <input type="checkbox" checked={mergeBeforeExport} onChange={(e) => setMergeBeforeExport(e.target.checked)} />
              Join objects for STL (Single Mesh)
            </label>

            <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>
              <input type="checkbox" checked={robustExportMode} onChange={(e) => setRobustExportMode(e.target.checked)} />
              Robust export mode (slower, safer)
            </label>
            {robustExportMode && (
              <div style={{ paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <label className="checkbox-label" style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                  On validation failure
                </label>
                <select
                  className="custom-select"
                  value={robustFailurePolicy}
                  onChange={(e) => setRobustFailurePolicy(e.target.value as RobustFailurePolicy)}
                  style={{ fontSize: '0.75rem' }}
                >
                  <option value="fail-fast">Stop export (fail-fast)</option>
                  <option value="skip-invalid">Skip bad objects and continue</option>
                </select>
                <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0, lineHeight: 1.35 }}>
                  Normalizes 2D contours, uses manifold-only extrusion, validates watertight topology before writing 3MF/STL.
                  Recommended for dense multi-color SVGs with slicer repair warnings.
                </p>
              </div>
            )}

            <label className="checkbox-label" style={{ fontSize: '0.75rem', opacity: canPrintFaceDown ? 1 : 0.45, cursor: canPrintFaceDown ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={printFaceDown && canPrintFaceDown}
                disabled={!canPrintFaceDown}
                onChange={(e) => setPrintFaceDown(e.target.checked)}
              />
              Print face down
            </label>
            {!canPrintFaceDown && (
              <span style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: '-0.25rem', paddingLeft: '1.5rem' }}>
                Only available when all faces share the same height
              </span>
            )}

            <label className="checkbox-label" style={{ fontSize: '0.75rem' }}>
              <input type="checkbox" checked={colorOnFaceOnly} onChange={(e) => setColorOnFaceOnly(e.target.checked)} />
              Color on face only (3MF)
            </label>

            {colorOnFaceOnly && (
              <div style={{ paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div>
                  <label className="checkbox-label" style={{ fontSize: '0.7rem', marginBottom: '0.25rem', color: '#94a3b8' }}>
                    Face color depth (mm)
                  </label>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                    {FACE_DEPTH_PRESETS.map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setFaceColorDepthMm(p)}
                        style={{
                          fontSize: '0.65rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: `1px solid ${Math.abs(faceColorDepthMm - p) < 1e-6 ? '#ec4899' : '#475569'}`,
                          background: Math.abs(faceColorDepthMm - p) < 1e-6 ? 'rgba(236,72,153,0.2)' : 'transparent',
                          color: '#e2e8f0',
                          cursor: 'pointer',
                        }}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <HoverSlider
                        min={0.02}
                        max={1}
                        step={0.02}
                        value={faceColorDepthMm}
                        onChange={(e: any) => setFaceColorDepthMm(Number(e.target.value))}
                        displayFormat={(v: number) => v.toFixed(2)}
                      />
                    </div>
                    <span style={{ fontSize: '0.75rem', width: '44px', color: 'white', textAlign: 'right' }}>{faceColorDepthMm.toFixed(2)}</span>
                  </div>
                  {faceColorDepthMm < 0.08 && (
                    <div style={{ fontSize: '0.65rem', color: '#fbbf24', marginTop: '0.25rem' }}>
                      Below typical layer height — the slicer will quantize to its layer height.
                    </div>
                  )}
                </div>
                <div>
                  <label className="checkbox-label" style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '0.35rem', display: 'block' }}>
                    Base filament
                  </label>
                  {uniqueColors.length > 0 && (
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                      {uniqueColors.map((colorHex) => {
                        const selected = faceBaseColorHex.replace('#', '').toLowerCase() === colorHex.toLowerCase();
                        return (
                          <button
                            key={colorHex}
                            type="button"
                            onClick={() => setFaceBaseColorHex(colorHex.toLowerCase())}
                            style={{
                              width: '24px',
                              height: '24px',
                              backgroundColor: `#${colorHex}`,
                              borderRadius: '4px',
                              cursor: 'pointer',
                              padding: 0,
                              border: selected ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                              boxShadow: selected ? '0 0 0 2px rgba(59,130,246,0.5)' : 'none',
                              flexShrink: 0,
                            }}
                            title={`#${colorHex}`}
                          />
                        );
                      })}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Custom</span>
                    <input
                      type="color"
                      value={`#${faceBaseColorHex.replace('#', '')}`}
                      onChange={(e) => setFaceBaseColorHex(e.target.value.replace('#', '').toLowerCase())}
                      style={{ width: '28px', height: '28px', border: 'none', padding: 0, background: 'transparent', cursor: 'pointer' }}
                      title="Custom base filament color (e.g. white for body under faces)"
                    />
                  </div>
                </div>
                <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: 0, lineHeight: 1.35 }}>
                  Builds one shared base solid plus thin face shells per color (saves AMS filament).
                  Keep <strong style={{ color: '#cbd5e1' }}>Cut overlaps</strong> on when loading so face shells do not overlap in XY.
                  Use with Print face down so color prints on the bed.
                </p>
              </div>
            )}

            <p style={{ fontSize: '0.65rem', color: '#94a3b8', margin: '0.25rem 0 0', lineHeight: 1.4 }}>
              For cleaner slicer results: keep <strong style={{ color: '#cbd5e1' }}>Cut overlaps</strong> on when loading.
              Seal Gaps is a preview bevel only and is not applied to 3MF export.
              Face-only color applies to 3MF, not STL. STL now uses the same manifold solids as 3MF (not the preview mesh).
            </p>
          </div>

          {vertexCount > EXPORT_VERTEX_SOFT_LIMIT && (
            <div style={{ marginBottom: '1rem', padding: '0.65rem 0.75rem', borderRadius: '6px', backgroundColor: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)' }}>
              <div style={{ fontSize: '0.75rem', color: '#fca5a5', lineHeight: 1.4 }}>
                {vertexCount > EXPORT_VERTEX_HARD_LIMIT ? (
                  <>
                    Very large model ({vertexCount.toLocaleString()} preview vertices). Same-color fuse may not get dense SVGs under the usual limit — outline complexity still drives the count.
                    You can still <strong style={{ color: '#fecaca' }}>Export anyway</strong>; it may take many minutes or crash the tab (cancel is available).
                  </>
                ) : (
                  <>Large model ({vertexCount.toLocaleString()} vertices). Export may be slow — enable &quot;Join objects by color&quot; and fuse same-color shards first.</>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button disabled={!svgUrl || !!exportStatus} style={{ width: '100%', backgroundColor: '#ec4899', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} onClick={handleExport3MF}>
              <Download size={16} /> {vertexCount > EXPORT_VERTEX_HARD_LIMIT ? 'Export 3MF anyway' : 'Export 3MF (Multi-Plate)'}
            </button>
            <button disabled={!svgUrl} style={{ width: '100%', backgroundColor: '#475569', color: 'white', border: 'none', padding: '8px', borderRadius: '6px', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }} onClick={handleExportSTL}>
              <Download size={14} /> Export STL (Raw)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
