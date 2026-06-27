import * as fs from 'fs';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

const svgString = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 0" fill="red" stroke="black" stroke-width="5"/></svg>';
const loader = new SVGLoader();
const svgData = loader.parse(svgString);

console.log(`Total paths: ${svgData.paths.length}`);
svgData.paths.forEach((path, i) => {
  console.log(`Path ${i}: color: ${path.color.getStyle()}`);
  console.log(`Path ${i}: userData.style:`, JSON.stringify(path.userData.style));
});
