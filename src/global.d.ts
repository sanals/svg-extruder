declare module 'imagetracerjs' {
  const ImageTracer: {
    imageToSVG: (
      url: string,
      callback: (svgStr: string) => void,
      options?: Record<string, unknown>,
    ) => void;
    imagedataToSVG: (
      imgd: { width: number; height: number; data: Uint8ClampedArray },
      options?: Record<string, unknown>,
    ) => string;
  };
  export default ImageTracer;
}

declare module 'vtracer-wasm/vtracer.wasm?url' {
  const wasmUrl: string;
  export default wasmUrl;
}

declare module 'manifold-3d/manifold.wasm?url' {
  const wasmUrl: string;
  export default wasmUrl;
}
