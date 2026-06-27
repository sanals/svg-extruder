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
