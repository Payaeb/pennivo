/// <reference types="../../../packages/ui/src/env" />

// Vite asset imports
declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}
