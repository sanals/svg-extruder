import * as THREE from 'three';

export interface ShapeItem {
  id: string;
  color: THREE.Color;
  colorHex: string;
  shapes: THREE.Shape[];
}

export type Pair = [number, number];
export type Ring = Pair[];
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

export interface PrintItem {
  id: string;
  geometry: THREE.BufferGeometry;
  colorHex: string;
  name: string;
}

export interface PrintPlate {
  items: PrintItem[];
  width: number;
  height: number;
  name: string;
}
