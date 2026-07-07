/// <reference types="vite/client" />

declare module "monaco-editor/esm/vs/base/browser/ui/hover/hoverDelegate2.js" {
  export function getBaseLayerHoverDelegate(): {
    hideHover?: () => void;
  };
  export function setBaseLayerHoverDelegate(hoverDelegate: unknown): void;
}
