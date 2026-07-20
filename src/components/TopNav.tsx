import React from 'react';
import { Download, Undo, Redo } from 'lucide-react';
import { HoverSlider } from './HoverSlider';

interface TopNavProps {
  selectedMeshIds: string[];
  currentDepth: number;
  isDepthMixed: boolean;
  handleDepthChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleDepthPointerDown: () => void;
  setShowExportOptions: (show: boolean) => void;
  vertexCount: number;
  canUndo: boolean;
  canRedo: boolean;
  handleUndo: () => void;
  handleRedo: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  selectedMeshIds,
  currentDepth,
  isDepthMixed,
  handleDepthChange,
  handleDepthPointerDown,
  setShowExportOptions,
  vertexCount,
  canUndo,
  canRedo,
  handleUndo,
  handleRedo
}) => {
  return (
    <div className="top-nav" style={{ position: 'relative' }}>
      <h1 className="sidebar-header" style={{ margin: 0, fontSize: '1.25rem' }}>SVG Extruder 3D</h1>

      {selectedMeshIds.length > 0 && (
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: '1rem', width: '600px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#60a5fa', whiteSpace: 'nowrap' }}>Extrusion Depth</span>
          <div style={{ flex: 1, padding: '0 0.5rem' }}>
              <HoverSlider id="depth-slider" min={0} max={20} step={0.1} value={currentDepth} onChange={handleDepthChange} onPointerDown={handleDepthPointerDown} disabled={selectedMeshIds.length === 0} displayFormat={(val) => `${val.toFixed(1)} mm`} />
          </div>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', width: '60px', textAlign: 'right' }}>
            {isDepthMixed ? (
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Mixed</span>
            ) : (
              <>{currentDepth.toFixed(1)} <span style={{fontSize: '0.7rem', color: '#94a3b8', fontWeight: 'normal'}}>mm</span></>
            )}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => setShowExportOptions(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#ec4899', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}>
          <Download size={14} /> Export Options
        </button>
        {vertexCount > 0 && (
          <div style={{ padding: '0.25rem 0.75rem', borderRadius: '6px', backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: vertexCount > 100000 ? '#ef4444' : '#e2e8f0' }}>{vertexCount.toLocaleString()} Vertices</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            style={{
              padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem',
              backgroundColor: canUndo ? '#3b82f6' : 'transparent',
              color: canUndo ? 'white' : '#64748b',
              border: canUndo ? 'none' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px', cursor: canUndo ? 'pointer' : 'not-allowed'
            }}
            title="Undo last change (Ctrl+Z)"
          >
            <Undo size={14} /> Undo
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            style={{
              padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem',
              backgroundColor: canRedo ? '#3b82f6' : 'transparent',
              color: canRedo ? 'white' : '#64748b',
              border: canRedo ? 'none' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '6px', cursor: canRedo ? 'pointer' : 'not-allowed'
            }}
            title="Redo (Ctrl+Y or Ctrl+Shift+Z)"
          >
            <Redo size={14} /> Redo
          </button>
        </div>
      </div>
    </div>
  );
};
