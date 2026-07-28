declare module "*.svg" {
  const source: string;
  export default source;
}

declare module "*.png" {
  const source: ArrayBuffer;
  export default source;
}
