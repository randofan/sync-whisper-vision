declare module "react-katex" {
  import type { ComponentType } from "react";
  export const InlineMath: ComponentType<{ math: string; errorColor?: string }>;
  export const BlockMath: ComponentType<{ math: string; errorColor?: string }>;
}

declare module "pdfjs-dist/build/pdf.worker.mjs?url" {
  const url: string;
  export default url;
}
