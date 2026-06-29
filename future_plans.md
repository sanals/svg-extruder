# Future Plans

## 1. Thin Wall & Printability Failsafe Warning
- **The Issue**: SVGs frequently contain very thin parts or sharp corners that are smaller than a standard 3D printer nozzle diameter (typically 0.4mm), making them difficult or impossible to print successfully.
- **Clearance Exacerbation**: When the user applies an "Assembly Clearance (mm)" (which mathematically shrinks/insets the geometry to allow parts to fit together), already-thin parts can become even thinner, or disappear entirely, leading to broken geometry or unprintable slivers.
- **Proposed Solution**: 
  - Implement a geometric analysis pass (potentially using `clipper-lib` polygon offsets) to detect areas where the wall thickness falls below a safe printable threshold.
  - Display a clear UI warning to the user, ideally highlighting the problematic thin areas in the 3D viewer.
  - Advise the user to either: scale up the overall model, reduce the assembly clearance, or simplify the source SVG.
