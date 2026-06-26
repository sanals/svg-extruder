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
