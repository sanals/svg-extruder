# Future Plans

## 1. Thin Wall & Printability Failsafe Warning
- **The Issue**: SVGs frequently contain very thin parts or sharp corners that are smaller than a standard 3D printer nozzle diameter (typically 0.4mm), making them difficult or impossible to print successfully.
- **Clearance Exacerbation**: When the user applies an "Assembly Clearance (mm)" (which mathematically shrinks/insets the geometry to allow parts to fit together), already-thin parts can become even thinner, or disappear entirely, leading to broken geometry or unprintable slivers.
- **Proposed Solution**: 
  - Implement a geometric analysis pass (potentially using `clipper-lib` polygon offsets) to detect areas where the wall thickness falls below a safe printable threshold.
  - Display a clear UI warning to the user, ideally highlighting the problematic thin areas in the 3D viewer.
  - Advise the user to either: scale up the overall model, reduce the assembly clearance, or simplify the source SVG.

## 2. Purpose-Built Generators
Most people extrude SVGs for specific reasons. Adding quick-action templates will streamline the workflow and make the tool incredibly sticky.

### Keychain Generator
**The Goal:** Automatically create a solid backing for the SVG and attach a loop for a keyring. 
**How to implement it:**
- **Generate the Base Silhouette:** We take all the shapes in the SVG, convert them to Clipper paths, and run a massive `ClipperLib.ClipType.ctUnion` to merge them into a single solid blob. We then use `ClipperLib.ClipperOffset` to expand this blob outwards by a few millimeters to create a nice border.
- **Generate the Keyring Loop:** We programmatically generate a 2D shape of a ring (an outer circle path and an inner hole path).
- **Positioning:** We calculate the `THREE.Box2` bounding box of the base silhouette. We automatically translate the 2D coordinates of the keyring loop so it sits at the top-center (or top-left) of the bounding box.
- **Final Merge:** We use Clipper one last time to union the base silhouette and the keyring loop into a single polygon. We extrude this at `depth=2`, and place the original colored SVG shapes on top at `depth=4`.

### Stencil / Cookie Cutter Mode
**The Goal:** Create a hollow cutter that perfectly matches the outer perimeter of the design, with a wider base flange for structural support. 
**How to implement it:**
- **Extract the Silhouette:** Just like the keychain, we union all shapes to get the outer perimeter polygon.
- **Generate the Cutting Wall:** We take the silhouette and offset it outwards by the user's nozzle width (e.g., 0.8mm) using `ClipperOffset`. We then use a boolean `ctDifference` to subtract the original silhouette from this expanded silhouette. This results in a hollow ring. We extrude this hollow ring to a tall height (e.g., 15mm).
- **Generate the Flange (Handle):** We offset the silhouette outwards by a much larger amount (e.g., 5mm) and subtract the original silhouette. We extrude this at a short height (e.g., 2mm).
- **Result:** When both meshes are rendered, you get a perfect 3D printable cookie cutter or stencil frame, completely bypassing the internal colored SVG geometry.

### Signage / Nameplate Maker
**The Goal:** Mount the SVG onto a clean, geometric backing board. 
**How to implement it:**
- **Calculate Bounds:** Use `THREE.Box2` to find the exact width and height of the entire imported SVG.
- **Generate Primitive Paths:**
  - **Rectangle:** Generate 4 coordinates based on the bounding box (plus user-defined padding).
  - **Rounded Rectangle:** Generate the 4 coordinates of a rectangle, and run it through `ClipperOffset` with `jtRound`—this automatically rounds the corners mathematically perfectly.
  - **Circle:** Calculate the center of the bounding box and the maximum radius, then generate a circular polygon.
- **Extrusion:** Extrude this primitive shape at `depth=0` to `2mm`, and offset the SVG shapes in the Z-axis so they sit perfectly on top of it.

## 3. Premium Edge Bevels & Chamfers
**The Goal:** Round off the sharp 90-degree top edges of the extruded shapes. 
**How to implement it:** You are currently using `THREE.ExtrudeGeometry` to turn the 2D shapes into 3D meshes. By default, you likely have `bevelEnabled: false` in your extrusion settings.
- **UI Controls:** We add sliders in the UI for Bevel Size (width), Bevel Thickness (height), and Bevel Segments (how round it is).
- **ExtrudeGeometry Settings:** We pass these variables directly into the `THREE.ExtrudeGeometry` configuration.
  - Setting `bevelSegments: 1` creates a sharp 45-degree chamfer.
  - Setting `bevelSegments: 5` creates a smooth rounded fillet.
- **The Challenge (Self-Intersection):** `THREE.ExtrudeGeometry`'s native beveling can sometimes mathematically break or explode if the SVG path has extremely sharp internal corners or overlapping vertices. If this happens, we would need to implement an "Inset Bevel" where we use `ClipperOffset` to physically shrink the polygon on the top layers to simulate a chamfer. However, turning on the native Three.js bevel is the first and easiest step.

## 4. Fridge Magnet Generator
Add an automated workflow to create 3D printed magnets from any SVG.

### The "Press-Fit / Glued" Magnet (Exposed)
This is the most common approach. The tool generates a solid base plate for the SVG, but creates a precisely sized circular "pocket" on the back.
- **How it works:** We add a dropdown for standard neodymium magnet sizes (e.g., 6x2mm, 8x3mm, 10x2mm).
- **The 3D Magic:** Instead of using complex 3D boolean subtractions (CSG), we simply generate the base plate in two stacked layers.
  - **Layer 1 (Bottom 1mm):** A solid footprint of the SVG.
  - **Layer 2 (Next 2mm):** The exact same footprint, but we mathematically insert a circular hole into the 2D `THREE.Shape` before extruding it.
- **Result:** When exported, the slicer sees a perfect pocket on the back. The user prints it, adds a drop of superglue, and presses the magnet in.

### The "Embedded / Hidden" Magnet (The Premium Option)
This feels like absolute magic to non-3D printers. The magnet is completely trapped inside the plastic, invisible from the outside, and can never fall out.
- **How it works:** We generate a hollow cavity inside the base plate.
- **The 3D Magic:** We stack three meshes:
  - **Floor (0.6mm):** Solid footprint.
  - **Cavity (2.2mm):** Footprint with a magnet hole.
  - **Roof (0.6mm+):** Solid footprint to seal it in.
- **The User Workflow:** The user slices the 3MF file and adds a "Pause at height" right before the roof prints. During the print, the printer pauses, the user drops the magnet into the cavity, and the printer resumes, permanently sealing the magnet inside!

### Smart Magnet Enhancements
If you want to make this feature truly stand out as a premium tool, we can add some algorithmic intelligence to it:
- **Auto-Centroid Placement:** Instead of just putting the magnet in the middle of the bounding box, we can calculate the true 2D Center of Mass (Centroid) of the SVG silhouette. This ensures that asymmetrical magnets don't rotate or hang lopsided on the fridge!
- **Multi-Magnet Distribution:** If a user uploads a long, wide logo (like a horizontal wordmark), one magnet in the center will make it wobbly. We can check the aspect ratio of the bounding box; if it's very wide, the app automatically generates 2 or 3 magnet holes distributed evenly along the back.
- **Tolerance Slider:** 3D printers vary in accuracy. We can add a "Hole Tolerance" slider (e.g., +0.1mm to +0.3mm) so users can perfectly tune the pocket size to ensure their specific magnets snap-fit perfectly without cracking the plastic.
