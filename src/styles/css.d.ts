// CSS files are imported as raw strings by esbuild's text loader and injected
// into the drawer's shadow root.
declare module "*.css" {
  const content: string;
  export default content;
}
