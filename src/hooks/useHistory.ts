import type { ShapeItem } from '../types';
import { useState, useCallback, useEffect } from 'react';

export interface HistoryState {
  meshDepths: Record<string, number>;
  meshColorOverrides: Record<string, string>;
  meshColors: { id: string; colorHex: string }[];
  shapes?: ShapeItem[];
  selectedMeshIds: string[];
  /** SVG-stage content (Step 1 merges). Optional for older mesh-only snapshots. */
  rawSvgContent?: string | null;
}

export function useHistory(
  getCurrentState: () => HistoryState,
  applyState: (state: HistoryState) => void
) {
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [redoHistory, setRedoHistory] = useState<HistoryState[]>([]);

  const pushToHistory = useCallback(() => {
    setHistory(prev => {
      const newHistory = [...prev, getCurrentState()];
      if (newHistory.length > 20) return newHistory.slice(1);
      return newHistory;
    });
    setRedoHistory([]);
  }, [getCurrentState]);

  const handleUndo = useCallback(() => {
    if (history.length === 0) return;

    const currentState = getCurrentState();
    const snapshot = history[history.length - 1];

    setRedoHistory(prev => [...prev, currentState]);
    setHistory(prev => prev.slice(0, -1));

    applyState(snapshot);
  }, [history, getCurrentState, applyState]);

  const handleRedo = useCallback(() => {
    if (redoHistory.length === 0) return;

    const currentState = getCurrentState();
    const snapshot = redoHistory[redoHistory.length - 1];

    setHistory(prev => [...prev, currentState]);
    setRedoHistory(prev => prev.slice(0, -1));

    applyState(snapshot);
  }, [redoHistory, getCurrentState, applyState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  return {
    pushToHistory,
    handleUndo,
    handleRedo,
    canUndo: history.length > 0,
    canRedo: redoHistory.length > 0,
    clearHistory: useCallback(() => {
      setHistory([]);
      setRedoHistory([]);
    }, [])
  };
}
