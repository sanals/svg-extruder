import React from 'react';
import { Download } from 'lucide-react';
import { HoverSlider } from './HoverSlider';

interface ExportDialogProps {
  setShowExportOptions: (show: boolean) => void;
  printerProfile: string;
  setPrinterProfile: (val: string) => void;
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
  handleExport3MF: () => void;
  handleExportSTL: () => void;
  svgUrl: string | null;
  exportStatus: string | null;
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
  handleExport3MF,
  handleExportSTL,
  svgUrl,
  exportStatus
}) => {
  return (
    <div className="export-popup-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(3px)' }} onClick={(e) => { if (e.target === e.currentTarget) setShowExportOptions(false); }}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '400px', maxWidth: '90vw', maxHeight: '90vh', overflowY: 'auto', position: 'relative', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', border: '1px solid #475569', padding: '1rem', backgroundColor: '#1e293b' }}>
        <button style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem', padding: '4px' }} onClick={() => setShowExportOptions(false)}>✕</button>
        <div className="card-header" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center' }}><Download size={14} style={{ marginRight: '6px' }} /> EXPORT OPTIONS</div>
        <div className="card-body">
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label className="checkbox-label" style={{ fontSize: '0.75rem', marginBottom: '0.35rem', color: '#94a3b8' }}>Printer Profile</label>
              <select className="custom-select" value={printerProfile} onChange={(e) => setPrinterProfile(e.target.value)}>
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

          <div style={{ marginBottom: '1rem' }}>
            <label className="checkbox-label" style={{ fontSize: '0.75rem', marginBottom: '0.25rem', color: '#94a3b8' }}>Scale Multiplier (%)</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <HoverSlider min={10} max={500} step={10} value={customScale} onChange={(e: any) => setCustomScale(Number(e.target.value))} displayFormat={(v: number) => `${Math.round(v)}%`} />
              </div>
              <span style={{ fontSize: '0.75rem', width: '40px', color: 'white', textAlign: 'right' }}>{customScale}%</span>
            </div>
          </div>

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
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button disabled={!svgUrl || !!exportStatus} style={{ width: '100%', backgroundColor: '#ec4899', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }} onClick={handleExport3MF}>
              <Download size={16} /> Export 3MF (Multi-Plate)
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
