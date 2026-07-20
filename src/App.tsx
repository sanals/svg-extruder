import { Suspense, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds, useBounds } from '@react-three/drei';

import { SvgModel } from './components/SvgModel';
import { SvgComparePreview } from './components/SvgComparePreview';
import { TopNav } from './components/TopNav';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { ExportDialog } from './components/ExportDialog';
import { useAppController } from './hooks/useAppController';
import './index.css';

function AutoFit({ trigger }: { trigger: number }) {
  const bounds = useBounds();
  useEffect(() => {
    if (trigger > 0) {
      setTimeout(() => bounds.refresh().clip().fit(), 100);
    }
  }, [trigger, bounds]);
  return null;
}

function App() {
  const ctrl = useAppController();
  const orbitDragRef = useRef(false);
  const suppressClickRef = useRef(false);
  const {
    svgUrl,
    previewSvgUrl,
    pipelinePhase,
    handlePromoteTo3D,
    handleBackToSvgPreview,
    handleMergeSvgFills,
    fitTrigger,
    rawSvgContent,
    imageDataUrl,
    colorCount,
    tracerId,
    tracerBackends,
    handleTracerChange,
    vtracerPreset,
    handleVtracerPresetChange,
    vtracerFilterSpeckle,
    handleVtracerFilterSpeckleChange,
    vtracerColorPrecisionBits,
    handleVtracerColorPrecisionChange,
    viColorPrecision,
    handleViColorPrecisionChange,
    viFilterSpeckle,
    handleViFilterSpeckleChange,
    viPathPrecision,
    handleViPathPrecisionChange,
    viMaxColors,
    handleViMaxColorsChange,
    selectedMeshIds,
    vertexCount,
    isTracing,
    highlightStyle,
    sealGaps,
    backingDepth,
    cutOverlaps,
    selectSizeThreshold,
    mergeBeforeExport,
    printFaceDown,
    canPrintFaceDown,
    colorOnFaceOnly,
    faceColorDepthMm,
    faceBaseColorHex,
    meshColorOverrides,
    meshDepths,
    mergeColors3MF,
    isMerging,
    isFusingSelection,
    fuseStatus,
    isExtracting,
    extractStatus,
    isBasePlating,
    basePlateStatus,
    showExportOptions,
    printerProfile,
    gridSize,
    exportStatus,
    customScale,
    scaleZProportionally,
    clearance,
    thinWallParts,
    thinWallStatus,
    pendingShards,
    ignoredShardColors,
    isAbsorbingShards,
    isSplitting,
    splitStatus,
    isExpanding,
    expandAmount,
    expandStatus,
    isSmoothing,
    smoothAmount,
    smoothStatus,
    isBordering,
    borderWidth,
    lineArtWidth,
    setLineArtWidth,
    borderMode,
    customBorderColor,
    adjacentColors,
    borderStatus,
    handleAutoSelectSimilar,
    handleAutoExtrude,
    initiateFuse,
    executeMergeColors,
    handleExportSTLAction,
    handleSelectThinParts,
    generateSVGFromCurrentShapes,
    handleSaveProject,
    handleLoadProject,
    handleFileUpload,
    handleDepthChange,
    handleDepthPointerDown,
    handleCustomColorChange,
    handleCustomColorPointerDown,
    handleColorCountChange,
    handleSelectBySizeChange,
    sceneRef,
    shapes,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
    setHighlightStyle,
    setSealGaps,
    setBackingDepth,
    setCutOverlaps,
    setSelectedMeshIds,
    setVertexCount,
    setMeshColorOverrides,
    setIsMerging,
    setIsFusingSelection,
    setShowExportOptions,
    setPrinterProfile,
    setGridSize,
    setMergeColors3MF,
    setCustomScale,
    setScaleZProportionally,
    setClearance,
    setMergeBeforeExport,
    setPrintFaceDown,
    setColorOnFaceOnly,
    setFaceColorDepthMm,
    setFaceBaseColorHex,
    setIgnoredShardColors,
    setPendingShards,
    setBorderWidth,
    setBorderMode,
    setCustomBorderColor,
    setExpandAmount,
    setSmoothAmount,
    handleConvertToLineArt,
    executeFuse,
    handleExport3MF,
    handlePreviewShards,
    confirmAbsorbShards,
    handleSplitDisjoint,
    handleExtractInner,
    handleCreateBasePlate,
    handleExpandSelected,
    handleSmoothSelected,
    handleCreateBorder,
    currentDepth,
    isDepthMixed,
    currentMeshColors,
    uniqueColors,
    selectedUniqueColors,
    previewMeshIds,
    toggleColorSelection,
    removeColorFromSelection,
    pushToHistory
  } = ctrl;

  return (
    <>
      <TopNav
        selectedMeshIds={selectedMeshIds}
        currentDepth={currentDepth}
        isDepthMixed={isDepthMixed}
        handleDepthChange={handleDepthChange}
        handleDepthPointerDown={handleDepthPointerDown}
        setShowExportOptions={setShowExportOptions}
        vertexCount={vertexCount}
        canUndo={canUndo}
        canRedo={canRedo}
        handleUndo={handleUndo}
        handleRedo={handleRedo}
      />

      <div className="app-main">
        <LeftPanel
          handleLoadProject={handleLoadProject}
          handleSaveProject={handleSaveProject}
          rawSvgContent={rawSvgContent}
          handleFileUpload={handleFileUpload}
          svgUrl={svgUrl}
          pipelinePhase={pipelinePhase}
          previewSvgUrl={previewSvgUrl}
          handlePromoteTo3D={handlePromoteTo3D}
          handleBackToSvgPreview={handleBackToSvgPreview}
          handleMergeSvgFills={handleMergeSvgFills}
          generateSVGFromCurrentShapes={generateSVGFromCurrentShapes}
          uniqueColors={uniqueColors}
          handleAutoExtrude={handleAutoExtrude}
          handleConvertToLineArt={handleConvertToLineArt}
          lineArtWidth={lineArtWidth}
          setLineArtWidth={setLineArtWidth}
          imageDataUrl={imageDataUrl}
          colorCount={colorCount}
          handleColorCountChange={handleColorCountChange}
          tracerId={tracerId}
          tracerBackends={tracerBackends}
          handleTracerChange={handleTracerChange}
          vtracerPreset={vtracerPreset}
          handleVtracerPresetChange={handleVtracerPresetChange}
          vtracerFilterSpeckle={vtracerFilterSpeckle}
          handleVtracerFilterSpeckleChange={handleVtracerFilterSpeckleChange}
          vtracerColorPrecisionBits={vtracerColorPrecisionBits}
          handleVtracerColorPrecisionChange={handleVtracerColorPrecisionChange}
          viColorPrecision={viColorPrecision}
          handleViColorPrecisionChange={handleViColorPrecisionChange}
          viFilterSpeckle={viFilterSpeckle}
          handleViFilterSpeckleChange={handleViFilterSpeckleChange}
          viPathPrecision={viPathPrecision}
          handleViPathPrecisionChange={handleViPathPrecisionChange}
          viMaxColors={viMaxColors}
          handleViMaxColorsChange={handleViMaxColorsChange}
          highlightStyle={highlightStyle}
          setHighlightStyle={setHighlightStyle}
          currentMeshColors={currentMeshColors}
          selectedMeshIds={selectedMeshIds}
          setSelectedMeshIds={setSelectedMeshIds}
          selectedUniqueColors={selectedUniqueColors}
          isMerging={isMerging}
          handleAutoSelectSimilar={handleAutoSelectSimilar}
          toggleColorSelection={toggleColorSelection}
          initiateFuse={initiateFuse}
          isFusingSelection={isFusingSelection}
          setIsMerging={setIsMerging}
          executeMergeColors={executeMergeColors}
          removeColorFromSelection={removeColorFromSelection}
          executeFuse={executeFuse}
          setIsFusingSelection={setIsFusingSelection}
          handleCustomColorChange={handleCustomColorChange}
          handleCustomColorPointerDown={handleCustomColorPointerDown}
          setMeshColorOverrides={setMeshColorOverrides}
          pushToHistory={pushToHistory}
        />

        <div className="main-content" style={{ position: 'relative' }}>
          {(isTracing || fuseStatus || exportStatus) && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.8)', zIndex: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
            }}>
              <div className="spinner" style={{
                width: '40px', height: '40px', border: '4px solid #334155',
                borderTop: '4px solid #3b82f6', borderRadius: '50%',
                animation: 'spin 1s linear infinite', marginBottom: '1rem'
              }} />
              <div style={{ color: '#f8fafc', fontSize: '1.2rem', fontWeight: 'bold', textAlign: 'center' }}>
                {exportStatus || fuseStatus || isTracing}
              </div>
              <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
            </div>
          )}

          {!svgUrl && !previewSvgUrl && !isTracing && !fuseStatus && (
            <div className="empty-state">
              Upload an SVG or Image to get started
            </div>
          )}

          {pipelinePhase === 'svgPreview' && previewSvgUrl && (
            <div style={{ position: 'absolute', inset: 0 }}>
              <SvgComparePreview sourceUrl={imageDataUrl} svgUrl={previewSvgUrl} />
            </div>
          )}

          {pipelinePhase === 'extrudeReady' && svgUrl && (
            <Canvas frameloop="demand" camera={{ position: [0, 0, 100], fov: 50 }} onPointerMissed={() => setSelectedMeshIds([])}>
              <ambientLight intensity={0.5} />
              <directionalLight position={[10, 10, 10]} intensity={1} castShadow />
              <OrbitControls
                makeDefault
                enableDamping={false}
                onStart={() => { orbitDragRef.current = false; }}
                onChange={() => { orbitDragRef.current = true; }}
                onEnd={() => {
                  suppressClickRef.current = orbitDragRef.current;
                  orbitDragRef.current = false;
                }}
              />
              <Suspense fallback={null}>
                <Bounds fit={false} clip={false} observe={false} margin={1.2}>
                  <AutoFit trigger={fitTrigger} />
                  <group ref={sceneRef}>
                    <SvgModel
                      shapes={shapes}
                      highlightStyle={highlightStyle}
                      backingDepth={backingDepth}
                      sealGaps={sealGaps}
                      selectedMeshIds={selectedMeshIds}
                      previewMeshIds={previewMeshIds}
                      meshDepths={meshDepths}
                      meshColorOverrides={meshColorOverrides}
                      onSelect={(ids, shiftKey) => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        setSelectedMeshIds(prev => {
                          if (shiftKey) {
                            const isAdding = !prev.includes(ids[0]);
                            if (isAdding) {
                              return [...new Set([...prev, ...ids])];
                            } else {
                              return prev.filter(i => !ids.includes(i));
                            }
                          } else {
                            if (prev.length === ids.length && ids.every(i => prev.includes(i))) {
                              return [];
                            }
                          }
                          return ids;
                        });
                      }}
                      onVerticesCalculated={setVertexCount}
                    />
                  </group>
                </Bounds>
              </Suspense>
            </Canvas>
          )}
        </div>

        <RightPanel
          sealGaps={sealGaps}
          setSealGaps={setSealGaps}
          cutOverlaps={cutOverlaps}
          setCutOverlaps={setCutOverlaps}
          svgUrl={svgUrl}
          backingDepth={backingDepth}
          setBackingDepth={setBackingDepth}
          selectSizeThreshold={selectSizeThreshold}
          handleSelectBySizeChange={handleSelectBySizeChange}
          selectedMeshIds={selectedMeshIds}
          handleExtractInner={handleExtractInner}
          isExtracting={isExtracting}
          extractStatus={extractStatus}
          handleCreateBasePlate={handleCreateBasePlate}
          isBasePlating={isBasePlating}
          basePlateStatus={basePlateStatus}
          handleSplitDisjoint={handleSplitDisjoint}
          isSplitting={isSplitting}
          splitStatus={splitStatus}
          handlePreviewShards={handlePreviewShards}
          isAbsorbingShards={isAbsorbingShards}
          pendingShards={pendingShards}
          ignoredShardColors={ignoredShardColors}
          setIgnoredShardColors={setIgnoredShardColors}
          setPendingShards={setPendingShards}
          confirmAbsorbShards={confirmAbsorbShards}
          borderWidth={borderWidth}
          setBorderWidth={setBorderWidth}
          handleCreateBorder={handleCreateBorder}
          isBordering={isBordering}
          borderStatus={borderStatus}
          borderMode={borderMode}
          setBorderMode={setBorderMode}
          customBorderColor={customBorderColor}
          setCustomBorderColor={setCustomBorderColor}
          adjacentColors={adjacentColors}
          expandAmount={expandAmount}
          setExpandAmount={setExpandAmount}
          handleExpandSelected={handleExpandSelected}
          isExpanding={isExpanding}
          expandStatus={expandStatus}
          smoothAmount={smoothAmount}
          setSmoothAmount={setSmoothAmount}
          handleSmoothSelected={handleSmoothSelected}
          isSmoothing={isSmoothing}
          smoothStatus={smoothStatus}
        />
      </div>

      {showExportOptions && (
        <ExportDialog
          setShowExportOptions={setShowExportOptions}
          printerProfile={printerProfile}
          setPrinterProfile={setPrinterProfile}
          gridSize={gridSize}
          setGridSize={setGridSize}
          mergeColors3MF={mergeColors3MF}
          setMergeColors3MF={setMergeColors3MF}
          customScale={customScale}
          setCustomScale={setCustomScale}
          scaleZProportionally={scaleZProportionally}
          setScaleZProportionally={setScaleZProportionally}
          clearance={clearance}
          setClearance={setClearance}
          mergeBeforeExport={mergeBeforeExport}
          setMergeBeforeExport={setMergeBeforeExport}
          printFaceDown={printFaceDown}
          setPrintFaceDown={setPrintFaceDown}
          canPrintFaceDown={canPrintFaceDown}
          colorOnFaceOnly={colorOnFaceOnly}
          setColorOnFaceOnly={setColorOnFaceOnly}
          faceColorDepthMm={faceColorDepthMm}
          setFaceColorDepthMm={setFaceColorDepthMm}
          faceBaseColorHex={faceBaseColorHex}
          setFaceBaseColorHex={setFaceBaseColorHex}
          uniqueColors={uniqueColors}
          thinWallParts={thinWallParts}
          thinWallStatus={thinWallStatus}
          handleSelectThinParts={handleSelectThinParts}
          handleExport3MF={handleExport3MF}
          handleExportSTL={handleExportSTLAction}
          svgUrl={svgUrl}
          exportStatus={exportStatus}
          vertexCount={vertexCount}
        />
      )}
    </>
  );
}

export default App;
