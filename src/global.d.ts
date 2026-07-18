declare module 'imagetracerjs' {
  const ImageTracer: {
    imageToSVG: (
      url: string,
      callback: (svgStr: string) => void,
      options?: Record<string, any>
    ) => void;
  };
  export default ImageTracer;
}

declare module 'vtracer-wasm/vtracer.wasm?url' {
  const wasmUrl: string;
  export default wasmUrl;
}
