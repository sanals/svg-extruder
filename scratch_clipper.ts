import ClipperLib from 'clipper-lib';

const scale = 100;
const co = new ClipperLib.ClipperOffset();

// A simple square
const clipperPath = [
  {X: 0, Y: 0},
  {X: 100, Y: 0},
  {X: 100, Y: 100},
  {X: 0, Y: 100}
];

co.AddPath(clipperPath, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);

const solutionTree = new ClipperLib.PolyTree();
co.Execute(solutionTree, 10);

console.log("ChildCount:", solutionTree.ChildCount());

const children = solutionTree.Childs();
console.log("Children array:", Array.isArray(children) ? "yes" : "no");
if (Array.isArray(children) && children.length > 0) {
  const child = children[0];
  console.log("IsHole:", child.IsHole());
  console.log("Contour:", child.Contour());
}

// Test Difference
const clipper = new ClipperLib.Clipper();
clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);
clipper.AddPath([
  {X: 50, Y: 50},
  {X: 150, Y: 50},
  {X: 150, Y: 150},
  {X: 50, Y: 150}
], ClipperLib.PolyType.ptClip, true);

const diffTree = new ClipperLib.PolyTree();
clipper.Execute(ClipperLib.ClipType.ctDifference, diffTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

console.log("Diff ChildCount:", diffTree.ChildCount());
