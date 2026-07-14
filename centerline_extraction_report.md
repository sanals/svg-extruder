# Centerline & Line Art Extraction: Engineering Report

This document outlines the technical challenges, debugging process, and implementations attempted to resolve the polygon offsetting and centerline extraction issues in the SVG Extruder application.

## 1. Line Art (Clipper Offset) Challenges

The initial goal was to extract a uniform border (line art) from the SVG shapes using geometric offsetting via `ClipperLib.ClipperOffset`.

### Issue: Overlapping & Self-Intersecting Boundaries
- **Cause**: SVGs use `evenodd` or `nonzero` winding rules to render complex paths with self-intersections. When we extracted the raw paths and passed them to Clipper to offset outwards, the expanded boundaries of adjacent shapes collided and overlapped, creating jagged "jumbled intersections".
- **Attempted Fix**: We attempted a pre-processing step using boolean union (`ClipperLib.Clipper`) to merge all dark shapes together *before* offsetting them. 
- **Result**: While this stopped external overlapping, it introduced a new issue. The SVG contained tiny, jagged gaps between adjacent shapes. The boolean union preserved these gaps as internal holes. When we offset the merged shape outwards, the boundaries pushed *into* these tiny holes, causing them to collapse topologically and form massive, chaotic artifacts. 
- **Negative Offsetting**: We attempted to offset the shapes outwards to fuse the gaps, and then inwards to restore the original size. However, negative offsets cause thin topological features to collapse and disappear entirely, destroying fine details like the bird's hair or thin strokes.

---

## 2. OpenCV (Medial Axis Transform) Challenges

To bypass the mathematical nightmare of polygon topology collapsing during offsetting, we implemented a pixel-based approach: render the shapes to an HTML5 Canvas, and use OpenCV's computer vision algorithms to extract the true centerline (Medial Axis) of the pixels.

### Challenge A: ViewBox Coordinate Mapping (The "Giant Blob" Bug)
- **Symptom**: Generating centerlines resulted in a massive, tangled web of black lines concentrated entirely on the left side of the 3D model.
- **Cause**: The SVG utilized negative `viewBox` coordinates (e.g., `-500` to `500`). During the `canvas.getContext('2d').lineTo()` rasterization phase, the negative coordinates caused the left half of the bird to be drawn completely off-screen, while the right half was drawn on the left side of the canvas. The centerlines were extracted from this displaced, half-drawn image and then projected back onto the original 3D coordinates.
- **Resolution**: Implemented precise parsing of `viewBoxMinX` and `viewBoxMinY`. These offsets were mathematically subtracted during the canvas drawing phase (to center the image on the pixels) and then added back during the pixel-to-vector projection phase.

### Challenge B: Zhang-Suen Scaffolding (Spurs & Branches)
- **Symptom**: The resulting centerlines contained hundreds of tiny, dead-end "branches" or "scaffolding" inside the shapes.
- **Cause**: We utilized the Zhang-Suen Thinning Algorithm to extract the Medial Axis. A mathematical property of the Medial Axis is that it extends a branch into *every single sharp corner or bump* on the boundary of a shape. Because the SVG gaps (from the boolean intersections of the colored blobs) had highly jagged, stair-stepped boundaries, Zhang-Suen generated a massive web of branches pointing to every jagged pixel.
- **Resolution**: Implemented a custom topological pruning loop. The algorithm scanned the skeleton for "endpoints" (pixels with exactly 1 neighbor, `B === 1`) and deleted them. This loop was run for 35 iterations, systematically clipping away all dead-end branches up to 35 pixels long while preserving the main continuous spines.

### Challenge C: 8-Connected Diagonals vs. 4-Connected Contours (The "Scattered Squares" Bug)
- **Symptom**: Diagonal lines (like the cross-stitches in the blue feathers) rendered as a chaotic scatter of tiny disconnected squares and zig-zags.
- **Cause**: Zhang-Suen thinning produces a perfect 1-pixel thick skeleton. Diagonal lines in a 1-pixel skeleton are "8-connected" (pixels touching corner-to-corner). However, OpenCV's `cv.findContours` function strictly uses "4-connectivity" (pixels must touch edge-to-edge) when tracing foreground boundaries. It interpreted the diagonal lines as hundreds of isolated, disconnected 1-pixel dots. When Clipper expanded these dots by 0.2mm, they turned into tiny squares.
- **Resolution**: Introduced a 3x3 Morphological Dilation pass (`cv.dilate` using `cv.MORPH_CROSS`) *after* the skeleton was generated. This thickened the 1-pixel diagonal lines into 3-pixel wide, 4-connected shapes. `cv.findContours` could then trace them as perfectly unbroken, continuous paths.

### Challenge D: Contour Smoothing
- **Symptom**: The resulting vectors perfectly mirrored the pixel grid, resulting in severe "stair-stepping" on curves.
- **Resolution**: Applied the Douglas-Peucker algorithm (`cv.approxPolyDP` with `epsilon = 1.5`) to the extracted contours. This aggressively simplified the pixelated nodes, rounding them off into smooth vector curves.

### Challenge E: Thickness Scaling Math
- **Symptom**: Paths were either collapsing or ballooning unexpectedly based on the user's width input.
- **Cause**: The user inputs a thickness in SVG units. Because we dilated the skeleton to 3 pixels wide to fix the 8-connected bug, the baseline geometry was already `3 * scale` wide. If we applied a generic Clipper offset, the math fought the baseline thickness.
- **Resolution**: Rewrote the Clipper offset logic to accurately account for the baseline. `actualOffset = (targetWidth - 3 * canvasToSvgX) / 2`. By treating the 3-pixel dilated shape as a closed loop and expanding it outwards, we guaranteed the final thickness perfectly matched the user's input without ever requiring a negative offset.

### Challenge F: Topology of Solid Shapes (Why it looked wrong)
- **Symptom**: The blue feathers generated a complex web instead of an outline.
- **Cause**: The user expected the algorithm to generate an *outline* of the blue feathers. However, "CV Centerline" extracts the Medial Axis. The blue feathers in the SVG contained holes (where the black cross-stitches were drawn on top). The Medial Axis of a solid shape with holes is mathematically required to weave a web that maintains equidistance between the outer boundary and every single inner hole. 
- **Conclusion**: A centerline extractor cannot be used to outline solid shapes with internal holes. Centerlines are strictly for tracing paths, strokes, or gaps. 

### Challenge G: UI State Overlap
- **Symptom**: Clicking the button appeared to do nothing ("still same"), even though the lines were being generated.
- **Cause**: The newly generated black centerlines were being layered directly on top of the original colored SVG shapes. Since the user was attempting to generate a black-and-white "line art" model, the visual presence of the colored blobs underneath made it look like scribbles on a colored drawing rather than a clean extrusion map.
- **Resolution**: Updated `App.tsx` to automatically set the extrusion depth of all `lightShapeIds` (colored elements) to `0` when CV Centerlines are generated, cleanly hiding them and revealing the black-and-white result.

## Final Status
The OpenCV pipeline is mathematically sound and capable of correctly extracting, pruning, smoothing, and thickening the Medial Axis of any rasterized shape without topology collapse. The primary mismatch was utilizing a Medial Axis algorithm to attempt to generate border outlines for solid, hole-filled shapes.
