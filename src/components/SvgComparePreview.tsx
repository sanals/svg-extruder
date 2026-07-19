import React, { useCallback, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

export interface SvgComparePreviewProps {
  sourceUrl: string | null;
  svgUrl: string;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

/**
 * Full-size before/after wipe: source underneath, SVG clipped by a drag slider.
 * Fills the viewport area; optional zoom for inspecting edges.
 */
export const SvgComparePreview: React.FC<SvgComparePreviewProps> = ({
  sourceUrl,
  svgUrl,
}) => {
  const [pct, setPct] = useState(50);
  const [zoom, setZoom] = useState(1);
  const dragging = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);

  const setFromClientX = useCallback((clientX: number) => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPct(Math.min(100, Math.max(0, next)));
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // Don't steal pointer from zoom buttons
    if ((e.target as HTMLElement).closest('[data-zoom-controls]')) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setFromClientX(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setFromClientX(e.clientX);
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  const bumpZoom = (delta: number) => {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)));
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    bumpZoom(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  };

  const mediaStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    pointerEvents: 'none',
    transform: zoom > 1 ? `scale(${zoom})` : undefined,
    transformOrigin: 'center center',
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: '0.75rem',
        boxSizing: 'border-box',
        background: 'radial-gradient(ellipse at center, #1e293b 0%, #0f172a 70%)',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexShrink: 0,
        }}
      >
        <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
          Step 1 — Review SVG (drag slider to compare · then continue to 3D)
        </div>
        <div
          data-zoom-controls
          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
        >
          <button
            type="button"
            onClick={() => bumpZoom(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            title="Zoom out"
            aria-label="Zoom out"
            style={zoomBtnStyle(zoom <= ZOOM_MIN)}
          >
            <ZoomOut size={14} />
          </button>
          <span style={{ color: '#cbd5e1', fontSize: '0.75rem', minWidth: '2.5rem', textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => bumpZoom(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            title="Zoom in"
            aria-label="Zoom in"
            style={zoomBtnStyle(zoom >= ZOOM_MAX)}
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            disabled={zoom === 1}
            title="Fit to view"
            aria-label="Fit to view"
            style={zoomBtnStyle(zoom === 1)}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          width: '100%',
          borderRadius: '10px',
          border: '1px solid #334155',
          overflow: 'hidden',
          background: '#fff',
          cursor: 'ew-resize',
          touchAction: 'none',
          userSelect: 'none',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        }}
      >
        {sourceUrl ? (
          <img src={sourceUrl} alt="Source" draggable={false} style={mediaStyle} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: '#e2e8f0' }} />
        )}

        <div
          style={{
            position: 'absolute',
            inset: 0,
            clipPath: `inset(0 0 0 ${pct}%)`,
            background: '#fff',
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          <img
            src={svgUrl}
            alt="Vectorized SVG"
            draggable={false}
            style={{
              ...mediaStyle,
              position: 'absolute',
            }}
          />
        </div>

        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${pct}%`,
            width: 0,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '50%',
              width: '2px',
              background: '#3b82f6',
              boxShadow: '0 0 0 1px rgba(15,23,42,0.4)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: '#3b82f6',
              border: '3px solid #fff',
              boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: '0.7rem',
              fontWeight: 700,
              letterSpacing: '-0.05em',
            }}
          >
            ||
          </div>
        </div>

        <div style={labelStyle('left')}>Source</div>
        <div style={labelStyle('right')}>SVG</div>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        aria-label="Compare source and SVG"
        style={{ width: '100%', flexShrink: 0, accentColor: '#3b82f6' }}
      />
    </div>
  );
};

function zoomBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    padding: 0,
    borderRadius: 6,
    border: '1px solid #475569',
    background: disabled ? '#1e293b' : '#334155',
    color: disabled ? '#64748b' : '#e2e8f0',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };
}

function labelStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    top: 10,
    [side]: 12,
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#0f172a',
    background: 'rgba(255,255,255,0.85)',
    padding: '2px 8px',
    borderRadius: 4,
    pointerEvents: 'none',
    zIndex: 3,
  };
}
