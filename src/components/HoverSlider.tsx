import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface HoverSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPointerDown?: () => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  id?: string;
  displayFormat?: (val: number) => string;
}

export const HoverSlider: React.FC<HoverSliderProps> = ({ min, max, step, value, onChange, onPointerDown, disabled, style, id, displayFormat }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const sliderRef = useRef<HTMLInputElement>(null);

  const handleMouseMove = (_e: React.MouseEvent<HTMLInputElement>) => {
    if (sliderRef.current) {
      const rect = sliderRef.current.getBoundingClientRect();
      
      const val = parseFloat(sliderRef.current.value);
      const minVal = parseFloat(sliderRef.current.min);
      const maxVal = parseFloat(sliderRef.current.max);
      const percent = (val - minVal) / (maxVal - minVal);
      
      const thumbRadius = 9; // Approximate radius of the thumb (1.1rem / 2)
      const usableWidth = rect.width - thumbRadius * 2;
      const thumbX = rect.left + thumbRadius + (percent * usableWidth);
      const thumbY = rect.top;

      setTooltipPos({ x: thumbX, y: thumbY + 24 });
    }
  };

  useEffect(() => {
    const handleScrollOrResize = () => {
      setShowTooltip(false);
    };
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', position: 'relative' }}>
      <input
        ref={sliderRef}
        type="range"
        id={id}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        onPointerDown={onPointerDown}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseMove}
        disabled={disabled}
        className="slider-input"
        style={{ flex: 1, height: '4px', background: '#444', borderRadius: '4px', cursor: 'pointer', ...style }}
      />
      {showTooltip && !disabled && createPortal(
        <div 
          style={{
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: 50,
            backgroundColor: '#3b82f6',
            color: 'white',
            fontWeight: '600',
            fontSize: '11px',
            padding: '4px 8px',
            borderRadius: '6px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            whiteSpace: 'nowrap',
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
            transform: 'translateX(-50%)',
            transition: 'opacity 0.15s ease',
            opacity: showTooltip ? 1 : 0
          }}
        >
          <div style={{
            position: 'absolute',
            top: '-4px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '0',
            height: '0',
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderBottom: '4px solid #3b82f6'
          }} />
          {displayFormat ? displayFormat(value) : value}
        </div>,
        document.body
      )}
    </div>
  );
};
