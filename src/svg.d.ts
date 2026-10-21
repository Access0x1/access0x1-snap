/** SVG files are bundled as their source text (the Snaps build and the test config both do this). */
declare module '*.svg' {
  const source: string;
  export default source;
}
