import ClipperLib from 'clipper-lib';

const clipper = new ClipperLib.Clipper();
const clipperPath = [
  {X: 0, Y: 0},
  {X: 100, Y: 0},
  {X: 100, Y: 100},
  {X: 0, Y: 100}
];
clipper.AddPath(clipperPath, ClipperLib.PolyType.ptSubject, true);

const solutionTree = new ClipperLib.PolyTree();
const success = clipper.Execute(ClipperLib.ClipType.ctUnion, solutionTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

console.log("Success:", success);
console.log("ChildCount:", solutionTree.ChildCount());
