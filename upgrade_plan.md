# Future Upgrade Plan: Interlocking Tray Architecture

## Overview
Currently, the SVG Extruder slices large vector designs into square quadrants based on the selected printer's bed dimensions. While this allows large models to be printed across multiple beds, the user is left with flat pieces that must be manually glued or aligned together.

The next major architectural upgrade will introduce **Procedural Interlocking Trays**.

## Core Features
1. **Procedural Geometry Generation**: Instead of importing static STLs, the engine will use `THREE.Shape` and `THREE.ExtrudeGeometry` to procedurally generate backing plates on the fly.
2. **Snap-Fit Joinery**: The perimeter of each tray will feature mathematically generated dovetail tabs and slots (or biscuit connector slots) depending on their position in the grid (e.g., inner edges get connectors, outer perimeter stays smooth).
3. **Automated Alignment**: The sliced SVG chunks will be perfectly centered and placed resting flush on top of these backing trays.
4. **3MF Component Grouping**: The tray and its corresponding SVG slices will be grouped as `<components>` within a single `<object>` in the Bambu Studio 3MF export, ensuring they are treated as a single cohesive unit per bed.

## Implementation Steps
- Add `tray-generator.ts` to procedurally build the interlocking plates with parameters for thickness, tolerance, and connector style.
- Update `SvgModel.tsx` to insert the generated tray mesh into `itemsForPlate` before 3MF packaging.
- Update `App.tsx` to allow users to select "Include Interlocking Backing" and configure the thickness.

## Color Quantization & Image Pre-processing
In addition to physical architecture, improving the initial image-to-SVG vectorization pipeline is critical.

### 1. Optimal Color Selection
Currently, users manually specify the number of colors to extract. For automatic optimal palette extraction:
- **Heuristic Approach**: Run the Median Cut algorithm (via a library like `color-thief` or `node-vibrant`) or K-Means clustering (via `RgbQuant.js` or `image-q`) targeting ~16 colors.
- Compare the perceptual distance (using CIEDE2000) of the resulting colors and merge those that are visually indistinguishable. The remaining count provides a smart default for the extraction slider.

### 2. Edge Smoothing & Noise Reduction
Low-quality or pixelated images produce jagged, "shattered" artifacts along color boundaries during vectorization due to anti-aliasing pixels and compression noise. To solve this, image data should be pre-processed on a hidden `<canvas>` before vectorization:

- **Bilateral Filtering (Edge-Preserving Blur)**: The industry standard for blurring flat regions to destroy JPEG noise while keeping color boundaries razor-sharp. 
  - *Recommended Repo:* **`opencv.js`** (`cv.bilateralFilter()`) which provides WebAssembly-powered speed.
- **Kuwahara Filter (Painterly Effect)**: Flattens textures into solid color blocks while protecting sharp edges, making it ideal for preparing images for vectorization.
  - *Recommended Repo:* **`pixels.js`** or custom WebGL shaders for lighter-weight processing.
- **Morphological Operations**: Applying "Erosion" followed by "Dilation" mathematically deletes tiny noise pixels and jagged "shrapnel" artifacts along borders without shrinking the main shapes.
  - *Recommended Repo:* **`opencv.js`** (`cv.erode` and `cv.dilate`).
- **Smart Pixel Upscaling**: For low-resolution pixel art, standard scaling causes blur. Specialized emulator algorithms logically guess where smooth curves should be based on pixel staircases.
  - *Recommended Repos:* **`xbrz-js`** or **`hqx`**.
